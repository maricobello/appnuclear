import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  COUNTRY_BR,
  DAY,
  OFFERING_DEFAULTS,
  ROLES,
  State,
  USDT,
  activeOfferingFixture,
  deployOffering,
  deployOfferingFixture,
  kyc,
  now,
  prng,
} from "./helpers";
import type { ReentrantERC20, UFVOffering } from "../typechain-types";

const PRICE = OFFERING_DEFAULTS.price;
const WINDOW = OFFERING_DEFAULTS.withdrawalWindow;
const GRACE = 30n * DAY;

type Fixture = Awaited<ReturnType<typeof deployOffering>>;

/** alice, bob, carol 1500 cada (4500 ≥ softcap 4000), ainda Active. */
async function softCapReachedFixture() {
  const f = await activeOfferingFixture();
  for (const s of [f.alice, f.bob, f.carol]) await f.offering.connect(s).commit(1500n);
  return f;
}

/** softcap atingido, fim da oferta e da janela de desistência: pronta para finalizar. */
async function readyToFinalizeFixture() {
  const f = await softCapReachedFixture();
  await time.increaseTo((await f.offering.withdrawalsCloseAt()) + 1n);
  return f;
}

/** finalizada com alice, bob, carol (1500 cada), dave (500) e erin (desistiu). */
async function finalizedFixture() {
  const f = await activeOfferingFixture();
  const { offering, alice, bob, carol, dave, erin, admin } = f;
  for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n);
  await offering.connect(erin).commit(100n);
  await offering.connect(dave).commit(500n);
  await offering.connect(erin).withdraw();
  await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
  await offering.connect(admin).finalize();
  return f;
}

/** Oferta com token de pagamento malicioso (hook reentrante). */
async function reentrantOfferingFixture() {
  const evil = (await ethers.deployContract("ReentrantERC20")) as unknown as ReentrantERC20;
  const f = await deployOffering({}, await evil.getAddress());
  for (const s of f.investors) {
    await evil.mint(s.address, USDT(1_000_000));
    await evil.connect(s).approve(await f.offering.getAddress(), ethers.MaxUint256);
  }
  await time.increaseTo(f.startTime);
  return { ...f, evil };
}

async function fillHardCap(f: Fixture) {
  // hardcap 10_000, teto por investidor 3_000
  const { offering, alice, bob, carol, dave } = f;
  await offering.connect(alice).commit(3000n);
  await offering.connect(bob).commit(3000n);
  await offering.connect(carol).commit(3000n);
  await offering.connect(dave).commit(1000n);
}

describe("UFVOffering", () => {
  describe("construtor", () => {
    it("expõe a configuração (getters usados pelo front)", async () => {
      const f = await loadFixture(deployOfferingFixture);
      const { offering, token, usdt, registry, treasury, admin, config } = f;
      expect(await offering.token()).to.equal(await token.getAddress());
      expect(await offering.paymentToken()).to.equal(await usdt.getAddress());
      expect(await offering.identityRegistry()).to.equal(await registry.getAddress());
      expect(await offering.treasury()).to.equal(treasury.address);
      expect(await offering.pricePerCota()).to.equal(config.pricePerCota);
      expect(await offering.minCotas()).to.equal(config.minCotas);
      expect(await offering.maxCotasPerInvestor()).to.equal(config.maxCotasPerInvestor);
      expect(await offering.softCapCotas()).to.equal(config.softCapCotas);
      expect(await offering.hardCapCotas()).to.equal(config.hardCapCotas);
      expect(await offering.startTime()).to.equal(config.startTime);
      expect(await offering.endTime()).to.equal(config.endTime);
      expect(await offering.withdrawalWindow()).to.equal(config.withdrawalWindow);
      expect(await offering.defaultAdmin()).to.equal(admin.address);
      expect(await offering.defaultAdminDelay()).to.equal(2n * DAY);
      expect(await offering.cotasSold()).to.equal(0n);
      expect(await offering.totalRaised()).to.equal(0n);
      expect(await offering.investorCount()).to.equal(0n);
      expect(await offering.remainingCotas()).to.equal(config.hardCapCotas);
    });

    it("valida todos os parâmetros", async () => {
      const f = await loadFixture(deployOfferingFixture);
      const F = await ethers.getContractFactory("UFVOffering");
      const t = await now();
      const base = { ...f.config };
      const cases: [Partial<typeof base>, string][] = [
        [{ paymentToken: base.token }, "paymentToken == token"],
        [{ pricePerCota: 0n }, "pricePerCota"],
        [{ minCotas: 0n }, "minCotas"],
        [{ minCotas: base.maxCotasPerInvestor + 1n }, "minCotas"],
        [{ softCapCotas: 0n }, "softCap"],
        [{ softCapCotas: base.hardCapCotas + 1n }, "softCap"],
        [{ maxCotasPerInvestor: base.hardCapCotas + 1n, minCotas: 1n }, "maxCotasPerInvestor"],
        [{ hardCapCotas: OFFERING_DEFAULTS.maxSupply + 1n }, "hardCap > maxSupply"],
        [{ startTime: base.endTime }, "startTime >= endTime"],
        [{ startTime: t - 100n, endTime: t }, "endTime in the past"],
        [{ withdrawalWindow: 30n * DAY + 1n }, "withdrawalWindow"],
      ];
      for (const [override, reason] of cases) {
        await expect(F.deploy({ ...base, ...override }))
          .to.be.revertedWithCustomError(F, "InvalidConfig")
          .withArgs(reason);
      }
      for (const k of ["token", "paymentToken", "treasury"] as const) {
        await expect(F.deploy({ ...base, [k]: ethers.ZeroAddress })).to.be.revertedWithCustomError(F, "ZeroAddress");
      }
      await expect(F.deploy({ ...base, admin: ethers.ZeroAddress })).to.be.revertedWithCustomError(
        F,
        "AccessControlInvalidDefaultAdmin",
      );
      // hardCap × preço que estoura uint256
      await expect(F.deploy({ ...base, pricePerCota: ethers.MaxUint256 / 2n })).to.be.revertedWithPanic(0x11);
      // janela de 0 e de 30 dias são aceitas
      await F.deploy({ ...base, withdrawalWindow: 0n });
      await F.deploy({ ...base, withdrawalWindow: 30n * DAY });
    });
  });

  describe("estados", () => {
    it("Pending → Active → Failed sem aportes", async () => {
      const { offering, startTime, endTime, alice } = await loadFixture(deployOfferingFixture);
      expect(await offering.state()).to.equal(State.Pending);
      await expect(offering.connect(alice).commit(10n))
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Pending);
      await time.increaseTo(startTime - 1n);
      expect(await offering.state()).to.equal(State.Pending);
      await time.increaseTo(startTime);
      expect(await offering.state()).to.equal(State.Active);
      await time.increaseTo(endTime);
      expect(await offering.state()).to.equal(State.Active); // fim é inclusivo
      await time.increaseTo(endTime + 1n);
      expect(await offering.state()).to.equal(State.Failed);
    });

    it("Active → Succeeded (fim com softcap) → Finalized", async () => {
      const f = await loadFixture(softCapReachedFixture);
      expect(await f.offering.state()).to.equal(State.Active);
      await time.increaseTo(f.endTime + 1n);
      expect(await f.offering.state()).to.equal(State.Succeeded);
      await time.increaseTo((await f.offering.withdrawalsCloseAt()) + 1n);
      await f.offering.connect(f.admin).finalize();
      expect(await f.offering.state()).to.equal(State.Finalized);
    });

    it("Succeeded antecipado ao atingir o hardcap", async () => {
      const f = await loadFixture(activeOfferingFixture);
      await fillHardCap(f);
      expect(await f.offering.cotasSold()).to.equal(10_000n);
      expect(await f.offering.state()).to.equal(State.Succeeded);
    });

    it("Succeeded não finalizada vira Failed após finalizeDeadline (escrow nunca congela) e não volta atrás", async () => {
      const f = await loadFixture(softCapReachedFixture);
      const { offering, admin, alice, bob } = f;
      const deadline = await offering.finalizeDeadline();
      expect(deadline).to.equal(f.endTime + WINDOW + 2n * GRACE);
      expect(deadline).to.equal((await offering.withdrawalsCloseAt()) + 2n * GRACE); // sem encerramento antecipado
      await time.increaseTo(deadline);
      expect(await offering.state()).to.equal(State.Succeeded);
      await time.increaseTo(deadline + 1n);
      expect(await offering.state()).to.equal(State.Failed);
      await expect(offering.connect(admin).finalize())
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Failed);
      await offering.connect(alice).refund();
      await offering.connect(bob).refund();
      expect(await offering.state()).to.equal(State.Failed);
    });

    it("encerramento antecipado (hardcap) não finalizado também expira — e reembolsos não reabrem a captação", async () => {
      const f = await loadFixture(activeOfferingFixture);
      await fillHardCap(f);
      await time.increaseTo((await f.offering.finalizeDeadline()) + 1n);
      expect(await f.offering.state()).to.equal(State.Failed);
      await f.offering.connect(f.alice).refund(); // cotasSold < hardcap
      expect(await f.offering.state()).to.equal(State.Failed);
      await expect(f.offering.connect(f.erin).commit(10n))
        .to.be.revertedWithCustomError(f.offering, "InvalidState")
        .withArgs(State.Failed);
    });

    it("Cancelled prevalece sobre qualquer outro estado", async () => {
      const f = await loadFixture(softCapReachedFixture);
      await f.offering.connect(f.admin).cancel();
      expect(await f.offering.state()).to.equal(State.Cancelled);
      await time.increaseTo(f.endTime + 1n);
      expect(await f.offering.state()).to.equal(State.Cancelled);
    });
  });

  describe("commit", () => {
    it("registra o aporte, puxa o pagamento e emite evento", async () => {
      const { offering, usdt, alice } = await loadFixture(activeOfferingFixture);
      const cost = 100n * PRICE;
      const tx = offering.connect(alice).commit(100n);
      await expect(tx).to.emit(offering, "Committed").withArgs(alice.address, 100n, cost, 100n, cost);
      await expect(tx).to.changeTokenBalances(usdt, [alice, offering], [-cost, cost]);
      const ts = await now();
      expect(await offering.commitmentOf(alice.address)).to.deep.equal([100n, cost, ts, false, false]);
      expect(await offering.cotasSold()).to.equal(100n);
      expect(await offering.totalRaised()).to.equal(cost);
      expect(await offering.investorCount()).to.equal(1n);
      expect(await offering.investorsLength()).to.equal(1n);
      expect(await offering.investorAt(0)).to.equal(alice.address);
      expect(await offering.latestCommitAt()).to.equal(ts);
      expect(await offering.withdrawalDeadline(alice.address)).to.equal(ts + WINDOW);
      expect(await offering.remainingCotas()).to.equal(10_000n - 100n);
    });

    it("aportes adicionais somam e viram tranches, cada uma com a sua janela", async () => {
      const { offering, alice } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(100n);
      const t1 = await now();
      await time.increase(3n * DAY);
      await expect(offering.connect(alice).commit(50n))
        .to.emit(offering, "Committed")
        .withArgs(alice.address, 50n, 50n * PRICE, 150n, 150n * PRICE);
      const t2 = await now();
      expect(await offering.commitmentOf(alice.address)).to.deep.equal([150n, 150n * PRICE, t2, false, false]);
      expect((await offering.tranchesOf(alice.address)).map((t) => [t.committedAt, t.cotas])).to.deep.equal([
        [t1, 100n],
        [t2, 50n],
      ]);
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([150n, 150n * PRICE, t2 + WINDOW]);
      expect(await offering.withdrawalDeadline(alice.address)).to.equal(t2 + WINDOW);
      expect(await offering.investorCount()).to.equal(1n);
      expect(await offering.investorsLength()).to.equal(1n);
      // a 1ª tranche expira antes; a 2ª continua desistível
      await time.increaseTo(t1 + WINDOW + 1n);
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([50n, 50n * PRICE, t2 + WINDOW]);
      await time.increaseTo(t2 + WINDOW + 1n);
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([0n, 0n, 0n]);
      expect(await offering.tranchesOf(ethers.ZeroAddress)).to.deep.equal([]);
    });

    it("exige KYC vigente", async () => {
      const { offering, usdt, admin, registry, compliance, outsider, alice } = await loadFixture(activeOfferingFixture);
      await usdt.connect(admin).mint(outsider.address, USDT(1000));
      await usdt.connect(outsider).approve(await offering.getAddress(), ethers.MaxUint256);
      await expect(offering.connect(outsider).commit(10n))
        .to.be.revertedWithCustomError(offering, "NotVerified")
        .withArgs(outsider.address);
      // KYC vencido
      const exp = (await now()) + 100n;
      await registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, exp);
      await time.increaseTo(exp);
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "NotVerified");
    });

    it("respeita o mínimo por aporte", async () => {
      const { offering, alice } = await loadFixture(activeOfferingFixture);
      await expect(offering.connect(alice).commit(0n)).to.be.revertedWithCustomError(offering, "ZeroAmount");
      await expect(offering.connect(alice).commit(9n))
        .to.be.revertedWithCustomError(offering, "BelowMinimum")
        .withArgs(9n, 10n);
      await offering.connect(alice).commit(10n);
      // o mínimo vale por aporte, inclusive nos seguintes
      await expect(offering.connect(alice).commit(5n)).to.be.revertedWithCustomError(offering, "BelowMinimum");
    });

    it("respeita o teto por investidor (somando aportes)", async () => {
      const { offering, alice } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(2000n);
      await expect(offering.connect(alice).commit(1001n))
        .to.be.revertedWithCustomError(offering, "ExceedsInvestorCap")
        .withArgs(3001n, 3000n);
      await offering.connect(alice).commit(1000n);
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "ExceedsInvestorCap");
    });

    it("respeita o hardcap e encerra a captação ao atingi-lo", async () => {
      const f = await loadFixture(activeOfferingFixture);
      const { offering, alice, bob, carol, dave, erin } = f;
      await offering.connect(alice).commit(3000n);
      await offering.connect(bob).commit(3000n);
      await offering.connect(carol).commit(3000n);
      await expect(offering.connect(dave).commit(1001n))
        .to.be.revertedWithCustomError(offering, "ExceedsHardCap")
        .withArgs(1001n, 1000n);
      await offering.connect(dave).commit(1000n);
      expect(await offering.remainingCotas()).to.equal(0n);
      await expect(offering.connect(erin).commit(10n))
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Succeeded);
    });

    it("permite completar o hardcap com menos que o mínimo (evita sobra invendável)", async () => {
      const { offering, alice, bob, carol, dave, erin } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(3000n);
      await offering.connect(bob).commit(3000n);
      await offering.connect(carol).commit(3000n);
      await offering.connect(dave).commit(995n); // restam 5
      await expect(offering.connect(erin).commit(4n)).to.be.revertedWithCustomError(offering, "BelowMinimum");
      await offering.connect(erin).commit(5n);
      expect(await offering.state()).to.equal(State.Succeeded);
    });

    it("pausa bloqueia só novos aportes (desistência continua)", async () => {
      const { offering, pauser, outsider, alice, bob } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(100n);
      await expect(offering.connect(outsider).pause())
        .to.be.revertedWithCustomError(offering, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ROLES.PAUSER);
      await offering.connect(pauser).pause();
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "EnforcedPause");
      await offering.connect(alice).withdraw();
      await offering.connect(pauser).unpause();
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "RecommitAfterWithdrawal");
      await offering.connect(bob).commit(10n);
    });

    it("falha sem allowance suficiente", async () => {
      const { offering, usdt, alice } = await loadFixture(activeOfferingFixture);
      await usdt.connect(alice).approve(await offering.getAddress(), 10n * PRICE - 1n);
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(usdt, "ERC20InsufficientAllowance");
    });

    it("rejeita token de pagamento com taxa na transferência", async () => {
      const fee = await ethers.deployContract("FeeOnTransferERC20");
      const f = await deployOffering({}, await fee.getAddress());
      await fee.mint(f.alice.address, USDT(10_000));
      await fee.connect(f.alice).approve(await f.offering.getAddress(), ethers.MaxUint256);
      await time.increaseTo(f.startTime);
      const cost = 10n * PRICE;
      await expect(f.offering.connect(f.alice).commit(10n))
        .to.be.revertedWithCustomError(f.offering, "TransferAmountMismatch")
        .withArgs(cost, cost - cost / 100n);
    });
  });

  describe("withdraw (desistência em até 5 dias)", () => {
    it("devolve toda a posição dentro da janela", async () => {
      const { offering, usdt, alice } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(200n);
      const paid = 200n * PRICE;
      const tx = offering.connect(alice).withdraw();
      await expect(tx).to.emit(offering, "Withdrawn").withArgs(alice.address, 200n, paid);
      await expect(tx).to.changeTokenBalances(usdt, [offering, alice], [-paid, paid]);
      const c = await offering.commitmentOf(alice.address);
      expect([c.cotas, c.paid, c.settled, c.refunded]).to.deep.equal([0n, 0n, false, false]);
      expect(await offering.cotasSold()).to.equal(0n);
      expect(await offering.totalRaised()).to.equal(0n);
      expect(await offering.investorCount()).to.equal(0n);
      expect(await offering.withdrawalDeadline(alice.address)).to.equal(0n);
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([0n, 0n, 0n]);
      expect(await offering.tranchesOf(alice.address)).to.deep.equal([]);
      expect(await offering.hasWithdrawn(alice.address)).to.equal(true);
      await expect(offering.connect(alice).withdraw()).to.be.revertedWithCustomError(offering, "NoCommitment");
      // quem desiste não aporta de novo (M-01: impede reciclar a posição para segurar o hardcap)
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "RecommitAfterWithdrawal");
      expect(await offering.investorsLength()).to.equal(1n);
      expect(await offering.investorCount()).to.equal(0n);
    });

    it("vale até o último segundo da janela, não depois", async () => {
      const { offering, alice, bob } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(100n);
      await offering.connect(bob).commit(100n);
      const deadlineA = await offering.withdrawalDeadline(alice.address);
      await time.setNextBlockTimestamp(deadlineA);
      await offering.connect(alice).withdraw();
      const deadlineB = await offering.withdrawalDeadline(bob.address);
      await time.setNextBlockTimestamp(deadlineB + 1n);
      await expect(offering.connect(bob).withdraw())
        .to.be.revertedWithCustomError(offering, "WithdrawalWindowClosed")
        .withArgs(deadlineB);
    });

    it("desistência por tranche: só os aportes dentro da janela voltam; os antigos ficam em escrow", async () => {
      const { offering, usdt, alice } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(3000n - 10n);
      const t1 = await now();
      await time.increase(4n * DAY);
      await offering.connect(alice).commit(10n); // "recarga" de 10 cotas não reabre a janela dos 2 990
      const t2 = await now();
      await time.increase(4n * DAY); // 8 dias após o 1º aporte, 4 após o 2º
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([10n, 10n * PRICE, t2 + WINDOW]);
      const tx = offering.connect(alice).withdraw();
      await expect(tx).to.emit(offering, "Withdrawn").withArgs(alice.address, 10n, 10n * PRICE);
      await expect(tx).to.changeTokenBalances(usdt, [offering, alice], [-10n * PRICE, 10n * PRICE]);
      expect(await offering.commitmentOf(alice.address)).to.deep.equal([2990n, 2990n * PRICE, t1, false, false]);
      expect(await offering.cotasSold()).to.equal(2990n);
      expect(await offering.totalRaised()).to.equal(2990n * PRICE);
      expect(await offering.investorCount()).to.equal(1n); // ainda tem posição
      expect(await offering.withdrawalDeadline(alice.address)).to.equal(t1 + WINDOW);
      await expect(offering.connect(alice).withdraw())
        .to.be.revertedWithCustomError(offering, "WithdrawalWindowClosed")
        .withArgs(t1 + WINDOW);
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "RecommitAfterWithdrawal");
    });

    it("várias tranches dentro da janela voltam juntas; a fora da janela fica", async () => {
      const { offering, alice } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(100n);
      const t1 = await now();
      await time.increase(5n * DAY + 1n);
      await offering.connect(alice).commit(20n);
      await offering.connect(alice).commit(30n);
      const t3 = await now();
      expect(await offering.withdrawableOf(alice.address)).to.deep.equal([50n, 50n * PRICE, t3 + WINDOW]);
      await expect(offering.connect(alice).withdraw()).to.emit(offering, "Withdrawn").withArgs(alice.address, 50n, 50n * PRICE);
      expect((await offering.tranchesOf(alice.address)).map((t) => [t.committedAt, t.cotas])).to.deep.equal([[t1, 100n]]);
      expect((await offering.commitmentOf(alice.address)).lastCommitAt).to.equal(t1);
    });

    it("desistência após o hardcap reabre a captação", async () => {
      const f = await loadFixture(activeOfferingFixture);
      await fillHardCap(f);
      expect(await f.offering.state()).to.equal(State.Succeeded);
      await f.offering.connect(f.dave).withdraw();
      expect(await f.offering.state()).to.equal(State.Active);
      await f.offering.connect(f.erin).commit(500n);
    });

    it("desistência após o fim pode derrubar a oferta para Failed", async () => {
      const f = await loadFixture(activeOfferingFixture);
      const { offering, alice, bob, endTime } = f;
      await offering.connect(alice).commit(3000n);
      await time.increaseTo(endTime - 10n);
      await offering.connect(bob).commit(1000n); // 4000 = softcap
      await time.increaseTo(endTime + 1n);
      expect(await offering.state()).to.equal(State.Succeeded);
      await offering.connect(bob).withdraw();
      expect(await offering.state()).to.equal(State.Failed);
      await offering.connect(alice).refund();
    });

    it("não é possível depois de finalizada ou cancelada", async () => {
      const f = await loadFixture(finalizedFixture);
      await expect(f.offering.connect(f.alice).withdraw())
        .to.be.revertedWithCustomError(f.offering, "InvalidState")
        .withArgs(State.Finalized);

      const g = await loadFixture(activeOfferingFixture);
      await g.offering.connect(g.alice).commit(100n);
      await g.offering.connect(g.admin).cancel();
      await expect(g.offering.connect(g.alice).withdraw())
        .to.be.revertedWithCustomError(g.offering, "InvalidState")
        .withArgs(State.Cancelled);
    });

    it("protegido contra reentrância", async () => {
      const { offering, evil, alice } = await loadFixture(reentrantOfferingFixture);
      await offering.connect(alice).commit(100n);
      await evil.arm(await offering.getAddress(), offering.interface.encodeFunctionData("withdraw"));
      await expect(offering.connect(alice).withdraw()).to.be.revertedWithCustomError(
        offering,
        "ReentrancyGuardReentrantCall",
      );
      await evil.disarm();
      await offering.connect(alice).withdraw();
    });
  });

  describe("refund (falha ou cancelamento)", () => {
    it("Failed: devolve o valor integral, uma única vez", async () => {
      const f = await loadFixture(activeOfferingFixture);
      const { offering, usdt, alice, bob, endTime } = f;
      await offering.connect(alice).commit(1000n);
      await offering.connect(bob).commit(500n);
      await expect(offering.connect(alice).refund())
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Active);
      await time.increaseTo(endTime + 1n);
      expect(await offering.state()).to.equal(State.Failed);

      const paid = 1000n * PRICE;
      const tx = offering.connect(alice).refund();
      await expect(tx).to.emit(offering, "Refunded").withArgs(alice.address, 1000n, paid);
      await expect(tx).to.changeTokenBalances(usdt, [offering, alice], [-paid, paid]);
      const c = await offering.commitmentOf(alice.address);
      expect([c.cotas, c.paid, c.refunded]).to.deep.equal([0n, 0n, true]);
      await expect(offering.connect(alice).refund()).to.be.revertedWithCustomError(offering, "NothingToRefund");

      // commit e finalize não são possíveis em Failed
      await expect(offering.connect(alice).commit(10n)).to.be.revertedWithCustomError(offering, "InvalidState");
      await expect(offering.connect(f.admin).finalize())
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Failed);

      await offering.connect(bob).refund();
      expect(await usdt.balanceOf(await offering.getAddress())).to.equal(0n);
      expect(await offering.totalRaised()).to.equal(0n);
      expect(await offering.cotasSold()).to.equal(0n);
      expect(await offering.investorCount()).to.equal(0n);
      expect(await offering.state()).to.equal(State.Failed);
    });

    it("refundFor: qualquer um dispara, o dinheiro vai sempre ao investidor", async () => {
      const { offering, usdt, alice, outsider, endTime } = await loadFixture(activeOfferingFixture);
      await offering.connect(alice).commit(100n);
      await time.increaseTo(endTime + 1n);
      const tx = offering.connect(outsider).refundFor(alice.address);
      await expect(tx).to.changeTokenBalances(usdt, [alice, outsider], [100n * PRICE, 0n]);
      await expect(offering.connect(outsider).refundFor(alice.address)).to.be.revertedWithCustomError(
        offering,
        "NothingToRefund",
      );
      await expect(offering.connect(outsider).refundFor(outsider.address)).to.be.revertedWithCustomError(
        offering,
        "NothingToRefund",
      );
    });

    it("Cancelled: reembolso liberado mesmo com softcap atingido", async () => {
      const f = await loadFixture(softCapReachedFixture);
      await f.offering.connect(f.admin).cancel();
      for (const s of [f.alice, f.bob, f.carol]) {
        await expect(f.offering.connect(s).refund()).to.changeTokenBalance(f.usdt, s, 1500n * PRICE);
      }
      expect(await f.usdt.balanceOf(await f.offering.getAddress())).to.equal(0n);
    });

    it("não há reembolso em Succeeded nem em Finalized", async () => {
      const f = await loadFixture(softCapReachedFixture);
      await time.increaseTo(f.endTime + 1n);
      await expect(f.offering.connect(f.alice).refund())
        .to.be.revertedWithCustomError(f.offering, "InvalidState")
        .withArgs(State.Succeeded);
      const g = await loadFixture(finalizedFixture);
      await expect(g.offering.connect(g.alice).refund())
        .to.be.revertedWithCustomError(g.offering, "InvalidState")
        .withArgs(State.Finalized);
    });

    it("protegido contra reentrância", async () => {
      const { offering, evil, alice, admin } = await loadFixture(reentrantOfferingFixture);
      await offering.connect(alice).commit(100n);
      await offering.connect(admin).cancel();
      await evil.arm(await offering.getAddress(), offering.interface.encodeFunctionData("refund"));
      await expect(offering.connect(alice).refund()).to.be.revertedWithCustomError(
        offering,
        "ReentrancyGuardReentrantCall",
      );
      await evil.arm(
        await offering.getAddress(),
        offering.interface.encodeFunctionData("refundFor", [alice.address]),
      );
      await expect(offering.connect(alice).refund()).to.be.revertedWithCustomError(
        offering,
        "ReentrancyGuardReentrantCall",
      );
    });
  });

  describe("cancel", () => {
    it("admin cancela antes de finalizar; aportes param", async () => {
      const { offering, admin, alice } = await loadFixture(activeOfferingFixture);
      await expect(offering.connect(admin).cancel()).to.emit(offering, "OfferingCancelled").withArgs(admin.address);
      expect(await offering.cancelled()).to.equal(true);
      await expect(offering.connect(alice).commit(10n))
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Cancelled);
      await expect(offering.connect(admin).cancel())
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Cancelled);
    });

    it("também em Pending", async () => {
      const { offering, admin } = await loadFixture(deployOfferingFixture);
      await offering.connect(admin).cancel();
      expect(await offering.state()).to.equal(State.Cancelled);
    });

    it("não após finalizar; só admin", async () => {
      const f = await loadFixture(finalizedFixture);
      await expect(f.offering.connect(f.admin).cancel())
        .to.be.revertedWithCustomError(f.offering, "InvalidState")
        .withArgs(State.Finalized);
      await expect(f.offering.connect(f.outsider).cancel())
        .to.be.revertedWithCustomError(f.offering, "AccessControlUnauthorizedAccount")
        .withArgs(f.outsider.address, ROLES.DEFAULT_ADMIN);
    });
  });

  describe("finalize", () => {
    it("só depois de fechada a janela de desistência; envia exatamente o captado à tesouraria uma vez", async () => {
      const f = await loadFixture(softCapReachedFixture);
      const { offering, usdt, admin, treasury, endTime } = f;
      await time.increaseTo(endTime + 1n);
      const closesAt = await offering.withdrawalsCloseAt();
      expect(closesAt).to.equal(endTime + WINDOW);
      await expect(offering.connect(admin).finalize())
        .to.be.revertedWithCustomError(offering, "WithdrawalPeriodOpen")
        .withArgs(closesAt);
      await time.setNextBlockTimestamp(closesAt);
      await expect(offering.connect(admin).finalize()).to.be.revertedWithCustomError(offering, "WithdrawalPeriodOpen");

      const raised = 4500n * PRICE;
      const tx = offering.connect(admin).finalize();
      await expect(tx).to.emit(offering, "OfferingFinalized").withArgs(treasury.address, raised, 4500n, admin.address);
      await expect(tx).to.changeTokenBalances(usdt, [offering, treasury], [-raised, raised]);
      expect(await offering.finalized()).to.equal(true);
      expect(await offering.totalRaised()).to.equal(raised); // fica como registro
      await expect(offering.connect(admin).finalize())
        .to.be.revertedWithCustomError(offering, "InvalidState")
        .withArgs(State.Finalized);
      expect(await usdt.balanceOf(treasury.address)).to.equal(raised);
    });

    it("antes do fim só se o hardcap foi atingido e a janela do último aporte fechou", async () => {
      const f = await loadFixture(activeOfferingFixture);
      await fillHardCap(f);
      const last = await f.offering.latestCommitAt();
      const closesAt = await f.offering.withdrawalsCloseAt();
      expect(closesAt).to.equal(last + WINDOW);
      await expect(f.offering.connect(f.admin).finalize()).to.be.revertedWithCustomError(f.offering, "WithdrawalPeriodOpen");
      await time.increaseTo(closesAt + 1n);
      expect(await now()).to.be.lessThan(f.endTime);
      await f.offering.connect(f.admin).finalize();
      expect(await f.usdt.balanceOf(f.treasury.address)).to.equal(10_000n * PRICE);
    });

    it("estado Active não finaliza", async () => {
      const f = await loadFixture(softCapReachedFixture);
      await expect(f.offering.connect(f.admin).finalize())
        .to.be.revertedWithCustomError(f.offering, "InvalidState")
        .withArgs(State.Active);
    });

    it("terceiros só finalizam após o prazo de carência (dinheiro nunca fica preso)", async () => {
      const f = await loadFixture(readyToFinalizeFixture);
      const closesAt = await f.offering.withdrawalsCloseAt();
      await expect(f.offering.connect(f.outsider).finalize())
        .to.be.revertedWithCustomError(f.offering, "AccessControlUnauthorizedAccount")
        .withArgs(f.outsider.address, ROLES.DEFAULT_ADMIN);
      await time.setNextBlockTimestamp(closesAt + GRACE);
      await expect(f.offering.connect(f.outsider).finalize()).to.be.revertedWithCustomError(
        f.offering,
        "AccessControlUnauthorizedAccount",
      );
      await time.setNextBlockTimestamp(closesAt + GRACE + 1n);
      await expect(f.offering.connect(f.outsider).finalize())
        .to.emit(f.offering, "OfferingFinalized")
        .withArgs(f.treasury.address, 4500n * PRICE, 4500n, f.outsider.address);
    });

    it("não libera o dinheiro se a oferta não for a emissora do token", async () => {
      const f = await deployOffering({}, undefined, { setMinter: false });
      const { offering, token, admin, usdt, treasury, alice, bob, carol } = f;
      await time.increaseTo(f.startTime);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n);
      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await expect(offering.connect(admin).finalize()).to.be.revertedWithCustomError(offering, "OfferingNotMinter");
      expect(await usdt.balanceOf(treasury.address)).to.equal(0n);
      // o admin define o emissor (uma única vez) e só então a captação é liberada
      await token.connect(admin).setMinter(await offering.getAddress());
      await offering.connect(admin).finalize();
      expect(await usdt.balanceOf(treasury.address)).to.equal(4500n * PRICE);
    });

    it("emissor definido para outro endereço: nunca finaliza e o escrow volta (cancel ou finalizeDeadline)", async () => {
      const f = await deployOffering({}, undefined, { setMinter: false });
      const { offering, token, admin, outsider, alice, bob, carol, usdt } = f;
      await token.connect(admin).setMinter(admin.address); // erro operacional irreversível
      await time.increaseTo(f.startTime);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n);
      await time.increaseTo((await offering.withdrawalsCloseAt()) + GRACE + 1n);
      await expect(offering.connect(outsider).finalize()).to.be.revertedWithCustomError(offering, "OfferingNotMinter");
      await time.increaseTo((await offering.finalizeDeadline()) + 1n);
      expect(await offering.state()).to.equal(State.Failed);
      for (const s of [alice, bob, carol]) await offering.refundFor(s.address);
      expect(await usdt.balanceOf(await offering.getAddress())).to.equal(0n);
    });

    it("protegido contra reentrância", async () => {
      const { offering, evil, admin, alice, bob, carol } = await loadFixture(reentrantOfferingFixture);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n);
      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await evil.arm(await offering.getAddress(), offering.interface.encodeFunctionData("finalize"));
      await expect(offering.connect(admin).finalize()).to.be.revertedWithCustomError(
        offering,
        "ReentrancyGuardReentrantCall",
      );
    });
  });

  describe("entrega das cotas (settle / claimTokens)", () => {
    it("não antes de finalizar", async () => {
      const f = await loadFixture(readyToFinalizeFixture);
      await expect(f.offering.settle(10)).to.be.revertedWithCustomError(f.offering, "NotFinalized");
      await expect(f.offering.connect(f.alice).claimTokens()).to.be.revertedWithCustomError(f.offering, "NotFinalized");
    });

    it("settle em lotes com cursor, pula quem desistiu e encerra a emissão no fim", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, token, outsider, alice, bob, carol, dave, erin } = f;
      // lista: alice, bob, carol, erin (desistiu), dave
      expect(await offering.investorsLength()).to.equal(5n);
      await expect(offering.settle(0)).to.be.revertedWithCustomError(offering, "ZeroAmount");

      await expect(offering.connect(outsider).settle(2))
        .to.emit(offering, "TokensDelivered")
        .withArgs(alice.address, 1500n);
      expect(await offering.settleCursor()).to.equal(2n);
      expect(await token.balanceOf(bob.address)).to.equal(1500n);
      expect(await token.mintingFinished()).to.equal(false);

      await offering.connect(outsider).settle(2); // carol + erin (pulada)
      expect(await offering.settleCursor()).to.equal(4n);
      expect(await token.balanceOf(erin.address)).to.equal(0n);

      await expect(offering.connect(outsider).settle(100))
        .to.emit(offering, "SettlementCompleted")
        .withArgs(5000n)
        .and.to.emit(token, "MintingFinished")
        .withArgs(5000n);
      expect(await token.balanceOf(carol.address)).to.equal(1500n);
      expect(await token.balanceOf(dave.address)).to.equal(500n);
      expect(await token.totalSupply()).to.equal(await offering.cotasSold());
      expect(await offering.cotasDelivered()).to.equal(5000n);
      expect(await offering.settlementCompleted()).to.equal(true);
      expect(await token.mintingFinished()).to.equal(true);
      expect((await offering.commitmentOf(dave.address)).settled).to.equal(true);
      await expect(offering.settle(1)).to.be.revertedWithCustomError(offering, "SettlementAlreadyCompleted");
    });

    it("claimTokens: autoliquidação sem dupla emissão", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, token, alice, erin, outsider } = f;
      await expect(offering.connect(alice).claimTokens())
        .to.emit(offering, "TokensDelivered")
        .withArgs(alice.address, 1500n);
      await expect(offering.connect(alice).claimTokens()).to.be.revertedWithCustomError(offering, "AlreadySettled");
      await expect(offering.connect(erin).claimTokens()).to.be.revertedWithCustomError(offering, "NoCommitment");
      await expect(offering.connect(outsider).claimTokens()).to.be.revertedWithCustomError(offering, "NoCommitment");
      await offering.settle(100);
      expect(await token.balanceOf(alice.address)).to.equal(1500n);
      expect(await token.totalSupply()).to.equal(5000n);
    });

    it("o último claimTokens também encerra a emissão", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, token, alice, bob, carol, dave } = f;
      for (const s of [alice, bob, carol]) await offering.connect(s).claimTokens();
      expect(await token.mintingFinished()).to.equal(false);
      await expect(offering.connect(dave).claimTokens()).to.emit(offering, "SettlementCompleted").withArgs(5000n);
      expect(await token.mintingFinished()).to.equal(true);
      await expect(offering.settle(10)).to.be.revertedWithCustomError(offering, "SettlementAlreadyCompleted");
    });

    it("KYC vencido depois do aporte não trava a liquidação (só bloqueia transferir/sacar)", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, token, registry, compliance, alice, bob } = f;
      await registry.connect(compliance).removeInvestor(alice.address);
      await offering.settle(100);
      expect(await token.balanceOf(alice.address)).to.equal(1500n);
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(alice.address);
      await kyc(registry, compliance, [alice]);
      await token.connect(alice).transfer(bob.address, 1n);
    });

    it("cotas dão direito à receita após a liquidação (integração token ↔ oferta)", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, token, distributor, usdt, alice, dave } = f;
      await expect(token.connect(distributor).distribute(USDT(5000), ethers.ZeroHash)).to.be.revertedWithCustomError(
        token,
        "MintingNotFinished",
      );
      await offering.settle(100);
      await token.connect(distributor).distribute(USDT(5000), ethers.ZeroHash);
      expect(await token.claimable(alice.address)).to.equal(USDT(1500));
      expect(await token.claimable(dave.address)).to.equal(USDT(500));
      await expect(token.connect(dave).claim()).to.changeTokenBalance(usdt, dave, USDT(500));
    });
  });

  describe("rescueTokens", () => {
    it("antes de finalizar o escrow é intocável; só o excedente sai", async () => {
      const f = await loadFixture(softCapReachedFixture);
      const { offering, usdt, admin, outsider } = f;
      const addr = await offering.getAddress();
      const u = await usdt.getAddress();
      await expect(offering.connect(admin).rescueTokens(u, outsider.address, 1n))
        .to.be.revertedWithCustomError(offering, "InsufficientSurplus")
        .withArgs(1n, 0n);
      await usdt.connect(admin).mint(addr, 7n); // enviado por engano
      await expect(offering.connect(admin).rescueTokens(u, outsider.address, 7n))
        .to.emit(offering, "TokensRescued")
        .withArgs(u, outsider.address, 7n);
      expect(await usdt.balanceOf(addr)).to.equal(await offering.totalRaised());
    });

    it("após finalizar, qualquer saldo residual pode ser devolvido", async () => {
      const f = await loadFixture(finalizedFixture);
      const { offering, usdt, admin, outsider } = f;
      await usdt.connect(admin).mint(await offering.getAddress(), 9n);
      await offering.connect(admin).rescueTokens(await usdt.getAddress(), outsider.address, 9n);
      expect(await usdt.balanceOf(outsider.address)).to.equal(9n);
    });

    it("outros tokens saem integralmente; validações", async () => {
      const f = await loadFixture(activeOfferingFixture);
      const { offering, admin, outsider } = f;
      const other = await ethers.deployContract("MockUSDT", [admin.address]);
      await other.connect(admin).mint(await offering.getAddress(), 3n);
      await offering.connect(admin).rescueTokens(await other.getAddress(), outsider.address, 3n);
      expect(await other.balanceOf(outsider.address)).to.equal(3n);
      await expect(
        offering.connect(admin).rescueTokens(await other.getAddress(), ethers.ZeroAddress, 1n),
      ).to.be.revertedWithCustomError(offering, "ZeroAddress");
      await expect(
        offering.connect(admin).rescueTokens(await other.getAddress(), outsider.address, 0n),
      ).to.be.revertedWithCustomError(offering, "ZeroAmount");
    });
  });

  describe("controle de acesso", () => {
    it("funções privilegiadas revertem para conta sem papel", async () => {
      const f = await loadFixture(activeOfferingFixture);
      const o = f.offering.connect(f.outsider);
      const u = await f.usdt.getAddress();
      const cases: [() => Promise<unknown>, string][] = [
        [() => o.cancel(), ROLES.DEFAULT_ADMIN],
        [() => o.pause(), ROLES.PAUSER],
        [() => o.unpause(), ROLES.PAUSER],
        [() => o.rescueTokens(u, f.outsider.address, 1n), ROLES.DEFAULT_ADMIN],
        [() => o.grantRole(ROLES.PAUSER, f.outsider.address), ROLES.DEFAULT_ADMIN],
        [() => o.beginDefaultAdminTransfer(f.outsider.address), ROLES.DEFAULT_ADMIN],
      ];
      for (const [tx, role] of cases) {
        await expect(tx()).to.be.revertedWithCustomError(f.offering, "AccessControlUnauthorizedAccount").withArgs(f.outsider.address, role);
      }
    });
  });

  describe("ciclo completo com números da Janaúba I", () => {
    it("capta, desiste, finaliza, liquida e distribui receita", async () => {
      const f = await deployOffering({
        maxSupply: 130_000n,
        hardCapCotas: 130_000n,
        softCapCotas: 91_000n,
        maxCotasPerInvestor: 13_000n,
        minCotas: 10n,
        price: USDT("18.2"),
      });
      const { offering, token, usdt, admin, treasury, distributor, signers, compliance, registry } = f;
      // 10 investidores com 13 000 cotas (hardcap exato) + 1 que entra no lugar de quem desistir
      const investors = signers.slice(6, 16) as HardhatEthersSigner[];
      const replacement = signers[16] as HardhatEthersSigner;
      await kyc(registry, compliance, [...investors, replacement]);
      for (const s of [...investors, replacement]) {
        await usdt.connect(admin).mint(s.address, USDT(300_000));
        await usdt.connect(s).approve(await offering.getAddress(), ethers.MaxUint256);
      }
      await time.increaseTo(f.startTime);
      for (const s of investors) await offering.connect(s).commit(13_000n);
      expect(await offering.state()).to.equal(State.Succeeded);
      expect(await offering.totalRaised()).to.equal(USDT(2_366_000)); // 130 000 × 18,2

      // um desiste no dia 4 (não pode voltar); outro entra no lugar
      await time.increase(4n * DAY);
      await offering.connect(investors[3]).withdraw();
      expect(await offering.state()).to.equal(State.Active);
      await expect(offering.connect(investors[3]).commit(13_000n)).to.be.revertedWithCustomError(
        offering,
        "RecommitAfterWithdrawal",
      );
      await offering.connect(replacement).commit(13_000n);
      investors[3] = replacement;

      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await offering.connect(admin).finalize();
      expect(await usdt.balanceOf(treasury.address)).to.equal(USDT(2_366_000));
      await offering.settle(4);
      await offering.settle(100);
      expect(await token.totalSupply()).to.equal(130_000n);

      // 12 meses de receita (valores ilustrativos)
      for (let m = 1; m <= 12; m++) {
        await token.connect(distributor).distribute(USDT("31234.56"), ethers.encodeBytes32String(`2027-${m}`));
      }
      // valor exato = 12 × 31 234,56 × 13 000 / 130 000; o contrato arredonda para baixo
      // (no máximo 1 unidade mínima = 10^-18 USDT a menos, nunca a mais)
      const exact = (USDT("31234.56") * 12n * 13_000n) / 130_000n;
      for (const s of investors) {
        const c = await token.claimable(s.address);
        expect(c <= exact && c + 1n >= exact).to.equal(true);
      }
      const total = await token.totalDistributed();
      let sum = 0n;
      for (const s of investors) sum += await token.claimable(s.address);
      expect(total - sum <= BigInt(investors.length)).to.equal(true);
    });
  });

  describe("invariante de escrow (fuzz determinístico)", () => {
    for (const seed of [7, 99, 2026]) {
      it(`semente ${seed}: aportes e desistências aleatórios mantêm o escrow consistente`, async () => {
        const f = await deployOffering({ softCapCotas: 6_000n });
        const { offering, usdt, investors, admin, token, treasury } = f;
        const rnd = prng(seed);
        await time.increaseTo(f.startTime);
        const offeringAddr = await offering.getAddress();

        const check = async (o: UFVOffering) => {
          let sumCotas = 0n;
          let sumPaid = 0n;
          let active = 0n;
          for (const s of investors) {
            const c = await o.commitmentOf(s.address);
            expect(c.paid).to.equal(c.cotas * PRICE);
            // Σ tranches == posição; lastCommitAt == tranche mais recente
            const tranches = await o.tranchesOf(s.address);
            expect(tranches.reduce((acc, t) => acc + t.cotas, 0n)).to.equal(c.cotas);
            if (tranches.length) expect(c.lastCommitAt).to.equal(tranches[tranches.length - 1].committedAt);
            const [wc, wa] = await o.withdrawableOf(s.address);
            expect(wa).to.equal(wc * PRICE);
            expect(wc <= c.cotas).to.equal(true);
            sumCotas += c.cotas;
            sumPaid += c.paid;
            if (c.cotas > 0n) active++;
          }
          expect(await o.cotasSold()).to.equal(sumCotas);
          expect(await o.totalRaised()).to.equal(sumPaid);
          expect(await o.investorCount()).to.equal(active);
          expect(await usdt.balanceOf(offeringAddr)).to.equal(sumPaid);
          expect(sumCotas <= (await o.hardCapCotas())).to.equal(true);
        };

        for (let step = 0; step < 40; step++) {
          const s = rnd.pick(investors);
          const r = rnd.next();
          if (r < 0.65) {
            if (await offering.hasWithdrawn(s.address)) {
              await expect(offering.connect(s).commit(10n)).to.be.reverted;
              continue;
            }
            const c = await offering.commitmentOf(s.address);
            const room = 3000n - c.cotas;
            const remaining = await offering.remainingCotas();
            const max = room < remaining ? room : remaining;
            if (max < 10n || (await offering.state()) !== State.Active) continue;
            await offering.connect(s).commit(rnd.big(10n, max));
          } else if (r < 0.85) {
            // a tx roda em now+1: soma as tranches (da mais recente para trás) ainda na janela
            const at = (await now()) + 1n;
            const tranches = [...(await offering.tranchesOf(s.address))].reverse();
            let expected = 0n;
            for (const t of tranches) {
              if (at > t.committedAt + WINDOW) break;
              expected += t.cotas;
            }
            if (expected === 0n) continue;
            await expect(offering.connect(s).withdraw())
              .to.emit(offering, "Withdrawn")
              .withArgs(s.address, expected, expected * PRICE);
          } else {
            await time.increase(rnd.int(1, 3) * 86_400);
          }
          await check(offering);
        }

        const closesAt = (await offering.withdrawalsCloseAt()) + 1n;
        if (closesAt > (await now())) await time.increaseTo(closesAt);
        if ((await offering.state()) === State.Succeeded) {
          const raised = await offering.totalRaised();
          await offering.connect(admin).finalize();
          expect(await usdt.balanceOf(treasury.address)).to.equal(raised);
          await offering.settle(3);
          await offering.settle(100);
          expect(await token.totalSupply()).to.equal(await offering.cotasSold());
        } else {
          for (const s of investors) {
            if ((await offering.commitmentOf(s.address)).paid > 0n) await offering.refundFor(s.address);
          }
          await check(offering);
        }
        expect(await usdt.balanceOf(offeringAddr)).to.equal(0n);
      });
    }
  });
});
