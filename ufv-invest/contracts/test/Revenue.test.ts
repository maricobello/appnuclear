import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { COUNTRY_BR, DAY, ROLES, USDT, deployBase, deployTokenFixture, kyc, now, prng } from "./helpers";
import type { FeeOnTransferERC20, ReentrantERC20, UFVPlantToken } from "../typechain-types";

const PERIOD = ethers.encodeBytes32String("2027-03");

/** alice 600, bob 400 (emissão encerrada). */
async function mintedFixture() {
  const f = await deployTokenFixture();
  await f.token.connect(f.admin).mint(f.alice.address, 600n);
  await f.token.connect(f.admin).mint(f.bob.address, 400n);
  await f.token.connect(f.admin).finishMinting();
  return f;
}

/** Token cujo payoutToken é um contrato arbitrário (malicioso/fee-on-transfer). */
async function tokenWithPayout(payoutName: "FeeOnTransferERC20" | "ReentrantERC20") {
  const base = await deployBase();
  const { admin, compliance, distributor, registry, alice, bob } = base;
  const payout = await ethers.deployContract(payoutName);
  const token = (await ethers.deployContract("UFVPlantToken", [
    "n",
    "s",
    1000n,
    await registry.getAddress(),
    await payout.getAddress(),
    admin.address,
  ])) as unknown as UFVPlantToken;
  await token.connect(admin).grantRole(ROLES.MINTER, admin.address);
  await token.connect(admin).grantRole(ROLES.DISTRIBUTOR, distributor.address);
  await kyc(registry, compliance, [alice, bob]);
  await token.connect(admin).mint(alice.address, 600n);
  await token.connect(admin).mint(bob.address, 400n);
  await token.connect(admin).finishMinting();
  await payout.mint(distributor.address, USDT(1_000_000));
  await payout.connect(distributor).approve(await token.getAddress(), ethers.MaxUint256);
  return { ...base, token, payout };
}

describe("UFVPlantToken — distribuição de receita", () => {
  describe("distribute", () => {
    it("credita pro-rata, emite evento e registra o período", async () => {
      const { token, distributor, alice, bob, usdt } = await loadFixture(mintedFixture);
      const amount = USDT(1000);
      const expectedRps = (amount * 2n ** 128n) / 1000n;
      const tx = token.connect(distributor).distribute(amount, PERIOD);
      await expect(tx).to.emit(token, "RevenueDistributed").withArgs(distributor.address, PERIOD, amount, expectedRps);
      await expect(tx).to.changeTokenBalances(usdt, [distributor, token], [-amount, amount]);
      expect(await token.claimable(alice.address)).to.equal(USDT(600));
      expect(await token.claimable(bob.address)).to.equal(USDT(400));
      expect(await token.totalDistributed()).to.equal(amount);
      expect(await token.magnifiedRevenuePerShare()).to.equal(expectedRps);
      expect(await token.revenueByPeriod(PERIOD)).to.equal(amount);
      await token.connect(distributor).distribute(USDT(1), PERIOD);
      expect(await token.revenueByPeriod(PERIOD)).to.equal(USDT(1001));
    });

    it("exige emissão encerrada (ninguém que ainda vai receber cotas perde receita)", async () => {
      const { token, admin, distributor, alice } = await loadFixture(deployTokenFixture);
      await token.connect(admin).mint(alice.address, 10n);
      await expect(token.connect(distributor).distribute(USDT(1), PERIOD)).to.be.revertedWithCustomError(
        token,
        "MintingNotFinished",
      );
    });

    it("exige supply > 0 e valor > 0", async () => {
      const { token, admin, distributor } = await loadFixture(deployTokenFixture);
      await token.connect(admin).finishMinting();
      await expect(token.connect(distributor).distribute(USDT(1), PERIOD)).to.be.revertedWithCustomError(
        token,
        "NoSupply",
      );
      await expect(token.connect(distributor).distribute(0n, PERIOD)).to.be.revertedWithCustomError(token, "ZeroAmount");
    });

    it("só DISTRIBUTOR_ROLE; bloqueado durante pausa", async () => {
      const { token, admin, distributor, pauser } = await loadFixture(mintedFixture);
      await expect(token.connect(admin).distribute(USDT(1), PERIOD))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(admin.address, ROLES.DISTRIBUTOR);
      await token.connect(pauser).pause();
      await expect(token.connect(distributor).distribute(USDT(1), PERIOD)).to.be.revertedWithCustomError(
        token,
        "EnforcedPause",
      );
    });

    it("rejeita token de pagamento com taxa na transferência", async () => {
      const { token, distributor } = await tokenWithPayout("FeeOnTransferERC20");
      await expect(token.connect(distributor).distribute(1000n, PERIOD))
        .to.be.revertedWithCustomError(token, "TransferAmountMismatch")
        .withArgs(1000n, 990n);
    });

    it("suporta valores grandes sem overflow", async () => {
      const { token, distributor, alice, bob, usdt, admin } = await loadFixture(mintedFixture);
      const big = 10n ** 30n; // 1 trilhão de USDT
      await usdt.connect(admin).mint(distributor.address, 3n * big);
      for (let i = 0; i < 3; i++) await token.connect(distributor).distribute(big, PERIOD);
      expect(await token.claimable(alice.address)).to.equal((3n * big * 600n) / 1000n);
      expect(await token.claimable(bob.address)).to.equal((3n * big * 400n) / 1000n);
    });
  });

  describe("claim", () => {
    it("paga o disponível, atualiza claimed e não paga duas vezes", async () => {
      const { token, distributor, alice, usdt } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      const tx = token.connect(alice).claim();
      await expect(tx).to.emit(token, "RevenueClaimed").withArgs(alice.address, USDT(600));
      await expect(tx).to.changeTokenBalances(usdt, [token, alice], [-USDT(600), USDT(600)]);
      expect(await token.claimed(alice.address)).to.equal(USDT(600));
      expect(await token.claimable(alice.address)).to.equal(0n);
      expect(await token.totalClaimed()).to.equal(USDT(600));
      await expect(token.connect(alice).claim()).to.be.revertedWithCustomError(token, "NothingToClaim");
    });

    it("exige KYC vigente; a receita fica guardada até a renovação", async () => {
      const { token, distributor, registry, compliance, alice } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      await registry.connect(compliance).removeInvestor(alice.address);
      await expect(token.connect(alice).claim())
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(alice.address);
      expect(await token.claimable(alice.address)).to.equal(USDT(600));
      await registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, (await now()) + DAY);
      await token.connect(alice).claim();
      expect(await token.claimed(alice.address)).to.equal(USDT(600));
    });

    it("bloqueado durante pausa", async () => {
      const { token, distributor, pauser, alice } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      await token.connect(pauser).pause();
      await expect(token.connect(alice).claim()).to.be.revertedWithCustomError(token, "EnforcedPause");
      await token.connect(pauser).unpause();
      await token.connect(alice).claim();
    });

    it("protegido contra reentrância (token com hook reentra em claim)", async () => {
      const { token, distributor, alice, payout } = await tokenWithPayout("ReentrantERC20");
      const malicious = payout as unknown as ReentrantERC20;
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      await malicious.arm(await token.getAddress(), token.interface.encodeFunctionData("claim"));
      await expect(token.connect(alice).claim()).to.be.revertedWithCustomError(token, "ReentrancyGuardReentrantCall");
      await malicious.disarm();
      await token.connect(alice).claim();
      expect(await token.claimed(alice.address)).to.equal(USDT(600));
    });

    it("protegido contra reentrância em distribute", async () => {
      const { token, admin, distributor, payout } = await tokenWithPayout("ReentrantERC20");
      const malicious = payout as unknown as ReentrantERC20;
      // até um distribuidor legítimo sendo o próprio token malicioso não consegue reentrar
      await token.connect(admin).grantRole(ROLES.DISTRIBUTOR, await malicious.getAddress());
      await malicious.arm(await token.getAddress(), token.interface.encodeFunctionData("distribute", [1n, PERIOD]));
      await expect(token.connect(distributor).distribute(USDT(1), PERIOD)).to.be.revertedWithCustomError(
        token,
        "ReentrancyGuardReentrantCall",
      );
    });
  });

  describe("transferências entre distribuições", () => {
    it("receita acumulada antes da transferência fica com o remetente", async () => {
      const { token, distributor, alice, bob, carol } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), PERIOD); // alice 600, bob 400
      await token.connect(alice).transfer(carol.address, 300n); // alice 300, carol 300
      expect(await token.claimable(alice.address)).to.equal(USDT(600));
      expect(await token.claimable(carol.address)).to.equal(0n);

      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      expect(await token.claimable(alice.address)).to.equal(USDT(600 + 300));
      expect(await token.claimable(carol.address)).to.equal(USDT(300));
      expect(await token.claimable(bob.address)).to.equal(USDT(400 + 400));

      // carol repassa tudo para bob; bob saca; nova distribuição
      await token.connect(carol).transfer(bob.address, 300n);
      await token.connect(bob).claim();
      await token.connect(distributor).distribute(USDT(500), PERIOD); // alice 300/1000, bob 700/1000
      expect(await token.claimable(alice.address)).to.equal(USDT(900 + 150));
      expect(await token.claimable(bob.address)).to.equal(USDT(350));
      expect(await token.claimable(carol.address)).to.equal(USDT(300));
      expect(await token.accumulativeRevenueOf(bob.address)).to.equal(USDT(800 + 350));
    });

    it("transferência para si mesmo não altera a receita", async () => {
      const { token, distributor, alice } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      await token.connect(alice).transfer(alice.address, 600n);
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      expect(await token.claimable(alice.address)).to.equal(USDT(1200));
    });
  });

  describe("arredondamento", () => {
    it("poeira < 1 unidade por titular e o resto é carregado para a próxima distribuição", async () => {
      const { token, admin, distributor, alice, bob, carol } = await loadFixture(deployTokenFixture);
      for (const s of [alice, bob, carol]) await token.connect(admin).mint(s.address, 1n);
      await token.connect(admin).finishMinting();

      await token.connect(distributor).distribute(100n, PERIOD);
      for (const s of [alice, bob, carol]) expect(await token.claimable(s.address)).to.equal(33n);
      // 100 - 99 = 1 de poeira

      await token.connect(distributor).distribute(2n, PERIOD);
      // 102 / 3 = 34 exato graças ao resto carregado: poeira zera
      for (const s of [alice, bob, carol]) expect(await token.claimable(s.address)).to.equal(34n);
    });

    it("1 wei para 1000 cotas: ninguém recebe nada, mas nada é perdido para sempre", async () => {
      const { token, distributor, alice, bob } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(1n, PERIOD);
      expect(await token.claimable(alice.address)).to.equal(0n);
      expect(await token.claimable(bob.address)).to.equal(0n);
      await token.connect(distributor).distribute(999n, PERIOD);
      expect(await token.claimable(alice.address)).to.equal(600n);
      expect(await token.claimable(bob.address)).to.equal(400n);
    });
  });

  describe("invariante (fuzz determinístico)", () => {
    // Σ claimed + Σ claimable + poeira == totalDistributed, 0 ≤ poeira ≤ nº de contas,
    // saldo de USDT do contrato == totalDistributed − totalClaimed, e cada conta recebe o
    // valor exato do modelo racional (arredondado para baixo, com no máximo 1 unidade a menos).
    for (const seed of [1, 42, 1337, 20261004]) {
      it(`semente ${seed}: transferências, distribuições, saques e recuperações aleatórias`, async () => {
        const f = await loadFixture(deployTokenFixture);
        const { token, admin, distributor, usdt } = f;
        const accounts: HardhatEthersSigner[] = f.investors;
        const rnd = prng(seed);

        const balances = new Map<string, bigint>();
        for (const a of accounts) {
          const b = BigInt(rnd.int(1, 5000));
          await token.connect(admin).mint(a.address, b);
          balances.set(a.address, b);
        }
        await token.connect(admin).finishMinting();
        const S = await token.totalSupply();

        // modelo exato: receita × S (inteiro) por conta, e quanto cada uma sacou
        const entitlementTimesS = new Map<string, bigint>(accounts.map((a) => [a.address, 0n]));
        const claimedModel = new Map<string, bigint>(accounts.map((a) => [a.address, 0n]));
        let totalDistributed = 0n;

        const check = async () => {
          let sumClaimed = 0n;
          let sumClaimable = 0n;
          for (const a of accounts) {
            const [claimable, claimed, accum, bal] = await Promise.all([
              token.claimable(a.address),
              token.claimed(a.address),
              token.accumulativeRevenueOf(a.address),
              token.balanceOf(a.address),
            ]);
            expect(bal).to.equal(balances.get(a.address));
            expect(claimed).to.equal(claimedModel.get(a.address));
            expect(accum).to.equal(claimable + claimed);
            const exactFloor = entitlementTimesS.get(a.address)! / S;
            expect(accum <= exactFloor, `conta recebeu mais que o exato`).to.equal(true);
            expect(accum + 1n >= exactFloor, `conta perdeu mais de 1 unidade`).to.equal(true);
            sumClaimed += claimed;
            sumClaimable += claimable;
          }
          const td = await token.totalDistributed();
          expect(td).to.equal(totalDistributed);
          const dust = td - sumClaimed - sumClaimable;
          expect(dust >= 0n, "Σ sacado + Σ sacável > distribuído").to.equal(true);
          expect(dust <= BigInt(accounts.length), `poeira ${dust} > nº de contas`).to.equal(true);
          expect(await token.totalClaimed()).to.equal(sumClaimed);
          expect(await usdt.balanceOf(await token.getAddress())).to.equal(td - sumClaimed);
        };

        for (let step = 0; step < 70; step++) {
          const r = rnd.next();
          if (r < 0.35) {
            // distribuição: às vezes poucos wei (stress de arredondamento), às vezes grande
            const amount = rnd.next() < 0.3 ? BigInt(rnd.int(1, 5000)) : rnd.big(USDT(1), USDT(250_000));
            await token.connect(distributor).distribute(amount, PERIOD);
            totalDistributed += amount;
            for (const a of accounts) {
              entitlementTimesS.set(a.address, entitlementTimesS.get(a.address)! + amount * balances.get(a.address)!);
            }
          } else if (r < 0.75) {
            const from = rnd.pick(accounts);
            const to = rnd.pick(accounts);
            const bal = balances.get(from.address)!;
            if (bal === 0n) continue;
            const amount = rnd.big(1n, bal);
            await token.connect(from).transfer(to.address, amount);
            balances.set(from.address, bal - amount);
            balances.set(to.address, balances.get(to.address)! + amount);
          } else if (r < 0.95) {
            const who = rnd.pick(accounts);
            const claimable = await token.claimable(who.address);
            if (claimable === 0n) continue;
            await token.connect(who).claim();
            claimedModel.set(who.address, claimedModel.get(who.address)! + claimable);
          } else {
            const lost = rnd.pick(accounts);
            const to = rnd.pick(accounts);
            if (lost === to) continue;
            if ((await token.balanceOf(lost.address)) === 0n && (await token.claimable(lost.address)) === 0n) continue;
            await token.connect(admin).recover(lost.address, to.address);
            balances.set(to.address, balances.get(to.address)! + balances.get(lost.address)!);
            balances.set(lost.address, 0n);
            const lostClaimedTimesS = claimedModel.get(lost.address)! * S;
            entitlementTimesS.set(
              to.address,
              entitlementTimesS.get(to.address)! + entitlementTimesS.get(lost.address)! - lostClaimedTimesS,
            );
            entitlementTimesS.set(lost.address, lostClaimedTimesS);
          }
          await check();
        }

        // no fim, todos sacam: o que sobra no contrato é só a poeira
        for (const a of accounts) {
          const c = await token.claimable(a.address);
          if (c > 0n) {
            await token.connect(a).claim();
            claimedModel.set(a.address, claimedModel.get(a.address)! + c);
          }
        }
        await check();
        const leftover = await usdt.balanceOf(await token.getAddress());
        expect(leftover <= BigInt(accounts.length)).to.equal(true);
      });
    }
  });
});
