/**
 * Auditoria independente (UFV Invest) — provas de conceito.
 *
 * Cada `describe` corresponde a um achado do relatório de auditoria (IDs M-xx / L-xx / I-xx) ou a
 * um ataque suspeito que foi testado e NÃO funciona (prefixo "[falha]"). Os testes dos achados em
 * aberto passam porque demonstram o comportamento atual (o problema); os de achados corrigidos
 * verificam a correção.
 */
import { expect } from "chai";
import hre, { ethers, network } from "hardhat";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployAll } from "../scripts/lib/deploy-core";
import { DEFAULT_PLANTS_FILE } from "../scripts/lib/plants-config";
import { DAY, ROLES, State, USDT, deployOffering, deployTokenFixture, kyc } from "./helpers";

const WINDOW = 5n * DAY;
const GRACE = 30n * DAY;
const PERIOD = ethers.encodeBytes32String("2027-01");
/** força a mineração da tx (sem estimateGas) para testar o comportamento no timestamp exato */
const MINED = { gasLimit: 500_000 };

type Fixture = Awaited<ReturnType<typeof deployOffering>>;

async function offeringFixture() {
  return deployOffering();
}

/** softcap atingido (alice, bob, carol 1500 cada), ainda Active. */
async function softCapFixture() {
  const f = await deployOffering();
  await time.increaseTo(f.startTime);
  for (const s of [f.alice, f.bob, f.carol]) await f.offering.connect(s).commit(1500n);
  return f;
}

/** Vários blocos de transações no MESMO bloco (bundle privado, como um atacante faria na BSC). */
async function sameBlock(send: () => Promise<void>) {
  await network.provider.send("evm_setAutomine", [false]);
  try {
    await send();
    await mine();
  } finally {
    await network.provider.send("evm_setAutomine", [true]);
  }
}

describe("Auditoria — UFVOffering", () => {
  describe("M-01 trava do hardcap: carteiras KYC (sybil) bloqueiam a captação de graça e derrubam a oferta", () => {
    it("PoC: atacantes enchem o hardcap na abertura, reciclam a posição a cada 5 dias e saem após o fim", async () => {
      const f: Fixture = await loadFixture(offeringFixture);
      const { offering, usdt, alice, bob, carol, dave, erin } = f;
      // hardcap 10 000, teto por carteira 3 000 → 4 identidades KYC bastam
      const attackers: [HardhatEthersSigner, bigint][] = [
        [alice, 3000n],
        [bob, 3000n],
        [carol, 3000n],
        [dave, 1000n],
      ];
      const victim = erin; // investidor legítimo
      const before = await Promise.all(attackers.map(([a]) => usdt.balanceOf(a.address)));

      await time.increaseTo(f.startTime);
      for (const [a, n] of attackers) await offering.connect(a).commit(n);
      expect(await offering.state()).to.equal(State.Succeeded);
      await expect(offering.connect(victim).commit(100n)).to.be.revertedWithCustomError(offering, "InvalidState").withArgs(State.Succeeded);

      // antes de cada janela fechar (o que permitiria finalizar), sai e reentra no mesmo bloco
      let rounds = 0;
      while (true) {
        const closesAt = await offering.withdrawalsCloseAt();
        if (closesAt >= f.endTime) break;
        await time.increaseTo(closesAt - 60n);
        await sameBlock(async () => {
          for (const [a, n] of attackers) {
            await offering.connect(a).withdraw({ gasLimit: 300_000 });
            await offering.connect(a).commit(n, { gasLimit: 400_000 });
          }
        });
        rounds++;
        expect(await offering.state()).to.equal(State.Succeeded);
        expect(await offering.cotasSold()).to.equal(10_000n);
        await expect(offering.connect(victim).commit(100n)).to.be.revertedWithCustomError(offering, "InvalidState");
      }
      expect(rounds).to.be.greaterThan(3); // 30 dias de oferta travados

      // fim da oferta: o último aporte ainda está na janela → todos desistem
      await time.increaseTo(f.endTime + 1n);
      for (const [a] of attackers) await offering.connect(a).withdraw();
      expect(await offering.state()).to.equal(State.Failed);
      expect(await offering.totalRaised()).to.equal(0n);

      // custo do ataque: só gás (100% do capital devolvido); a vítima nunca conseguiu investir
      const after = await Promise.all(attackers.map(([a]) => usdt.balanceOf(a.address)));
      expect(after).to.deep.equal(before);
      expect((await offering.commitmentOf(victim.address)).cotas).to.equal(0n);
    });
  });

  describe("L-01 escrow congelado se a oferta perder o MINTER_ROLE (sem caminho permissionless para reembolso)", () => {
    it("PoC: após a carência, ninguém finaliza nem reembolsa; só o cancel() do admin destrava", async () => {
      const f = await loadFixture(softCapFixture);
      const { offering, token, admin, outsider, alice } = f;
      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      // admin (comprometido, ou erro operacional) revoga o MINTER da oferta
      await token.connect(admin).revokeRole(ROLES.MINTER, await offering.getAddress());

      await time.increase(GRACE + 1n);
      await expect(offering.connect(outsider).finalize()).to.be.revertedWithCustomError(offering, "OfferingNotMinter");
      await expect(offering.connect(alice).refund()).to.be.revertedWithCustomError(offering, "InvalidState").withArgs(State.Succeeded);
      await expect(offering.connect(alice).withdraw()).to.be.revertedWithCustomError(offering, "WithdrawalWindowClosed");
      expect(await offering.state()).to.equal(State.Succeeded); // indefinidamente

      await offering.connect(admin).cancel();
      await expect(offering.connect(alice).refund()).to.emit(offering, "Refunded");
    });
  });

  describe("[falha] limites de tempo: commit no último segundo, desistência e finalize nunca se sobrepõem", () => {
    async function commitAtEnd() {
      const f = await softCapFixture();
      await time.setNextBlockTimestamp(f.endTime);
      await f.offering.connect(f.dave).commit(100n); // exatamente em endTime: ainda Active
      return f;
    }

    it("no instante withdrawalsCloseAt a desistência vale e o finalize não", async () => {
      const f = await loadFixture(commitAtEnd);
      const closesAt = await f.offering.withdrawalsCloseAt();
      expect(closesAt).to.equal(f.endTime + WINDOW);
      expect(await f.offering.withdrawalDeadline(f.dave.address)).to.equal(closesAt);
      // gasLimit explícito: a tx é minerada (e reverte) exatamente no timestamp escolhido
      await time.setNextBlockTimestamp(closesAt);
      await expect(f.offering.connect(f.admin).finalize(MINED)).to.be.revertedWithCustomError(f.offering, "WithdrawalPeriodOpen");
      expect(await time.latest()).to.equal(Number(closesAt));
      await time.setNextBlockTimestamp(closesAt + 1n);
      await expect(f.offering.connect(f.dave).withdraw(MINED)).to.be.revertedWithCustomError(f.offering, "WithdrawalWindowClosed");
      await expect(f.offering.connect(f.admin).finalize()).to.emit(f.offering, "OfferingFinalized");
    });

    it("a última desistência possível acontece antes de qualquer finalize", async () => {
      const f = await loadFixture(commitAtEnd);
      const closesAt = await f.offering.withdrawalsCloseAt();
      await time.setNextBlockTimestamp(closesAt);
      await expect(f.offering.connect(f.dave).withdraw(MINED)).to.emit(f.offering, "Withdrawn");
      expect(await time.latest()).to.equal(Number(closesAt));
    });

    it("hardcap atingido → desistência reabre Active e o prazo de finalize volta para endTime + janela", async () => {
      const f = await loadFixture(offeringFixture);
      const { offering, alice, bob, carol, dave, erin, admin } = f;
      await time.increaseTo(f.startTime);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(3000n);
      await offering.connect(dave).commit(1000n);
      const early = await offering.withdrawalsCloseAt();
      expect(early).to.be.lessThan(f.endTime);
      await time.increase(4n * DAY);
      await offering.connect(alice).withdraw(); // abaixo do hardcap
      expect(await offering.state()).to.equal(State.Active);
      expect(await offering.withdrawalsCloseAt()).to.equal(f.endTime + WINDOW);
      await offering.connect(erin).commit(3000n); // reenche o hardcap: base volta a ser o último aporte
      const t = BigInt(await time.latest());
      expect(await offering.withdrawalsCloseAt()).to.equal(t + WINDOW);
      // no último segundo da janela da erin o finalize ainda não é possível; ela ainda pode desistir
      await time.setNextBlockTimestamp(t + WINDOW);
      await expect(offering.connect(admin).finalize(MINED)).to.be.revertedWithCustomError(offering, "WithdrawalPeriodOpen");
      expect(await time.latest()).to.equal(Number(t + WINDOW));
      await time.setNextBlockTimestamp(t + WINDOW + 1n);
      await expect(offering.connect(erin).withdraw(MINED)).to.be.revertedWithCustomError(offering, "WithdrawalWindowClosed");
      await expect(offering.connect(admin).finalize()).to.emit(offering, "OfferingFinalized");
    });
  });

  describe("[falha] ninguém consegue travar a entrega das cotas nem emitir em dobro", () => {
    it("KYC revogado, token pausado e centenas de posições desistidas não impedem o settle", async () => {
      const f = await loadFixture(offeringFixture);
      const { offering, token, usdt, admin, compliance, registry, pauser, alice, bob, outsider } = f;
      await time.increaseTo(f.startTime);
      // griefer infla a lista com carteiras KYC que aportam e desistem (custa só gás para ele)
      const wallets = Array.from({ length: 60 }, () => ethers.Wallet.createRandom().connect(ethers.provider));
      await kyc(registry, compliance, wallets);
      for (const w of wallets) {
        await admin.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
        await usdt.connect(admin).mint(w.address, USDT(1000));
        await usdt.connect(w).approve(await offering.getAddress(), ethers.MaxUint256);
        await offering.connect(w).commit(10n);
        await offering.connect(w).withdraw();
      }
      await offering.connect(alice).commit(3000n);
      await offering.connect(bob).commit(1500n);
      expect(await offering.investorsLength()).to.equal(62n);

      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await offering.connect(admin).finalize();
      await registry.connect(compliance).removeInvestor(alice.address); // KYC revogado
      await token.connect(pauser).pause(); // token pausado

      await offering.connect(bob).claimTokens(); // autoliquidação antes do lote
      await expect(offering.connect(bob).claimTokens()).to.be.revertedWithCustomError(offering, "AlreadySettled");
      while (!(await offering.settlementCompleted())) await offering.connect(outsider).settle(25n);
      expect(await token.balanceOf(alice.address)).to.equal(3000n);
      expect(await token.balanceOf(bob.address)).to.equal(1500n);
      expect(await token.totalSupply()).to.equal(4500n);
      expect(await token.mintingFinished()).to.equal(true);
      await expect(offering.connect(outsider).settle(1n)).to.be.revertedWithCustomError(offering, "SettlementAlreadyCompleted");
    });
  });

  describe("[falha] rescueTokens não alcança o escrow em nenhum estado", () => {
    it("Active, Succeeded, Failed com reembolsos parciais e Cancelled", async () => {
      const f = await loadFixture(offeringFixture);
      const { offering, usdt, admin, alice, bob } = f;
      const addr = await offering.getAddress();
      await time.increaseTo(f.startTime);
      await offering.connect(alice).commit(1000n);
      await offering.connect(bob).commit(500n);
      await usdt.connect(admin).mint(addr, USDT(7)); // excedente enviado por engano
      const tryDrain = async () => {
        const reserved = await offering.totalRaised();
        const bal = await usdt.balanceOf(addr);
        await expect(offering.connect(admin).rescueTokens(await usdt.getAddress(), admin.address, bal - reserved + 1n))
          .to.be.revertedWithCustomError(offering, "InsufficientSurplus");
      };
      await tryDrain(); // Active
      await time.increaseTo(f.endTime + 1n); // 1500 < softcap 4000 → Failed
      expect(await offering.state()).to.equal(State.Failed);
      await offering.connect(alice).refund();
      await tryDrain(); // Failed, reembolso parcial
      await offering.connect(admin).rescueTokens(await usdt.getAddress(), admin.address, USDT(7)); // só o excedente
      await expect(offering.connect(bob).refund()).to.emit(offering, "Refunded").withArgs(bob.address, 500n, 500n * f.params.price);
      expect(await usdt.balanceOf(addr)).to.equal(0n);
    });
  });
});

describe("Auditoria — UFVPlantToken", () => {
  /** alice 600, bob 400, carol 1 (emissão encerrada). */
  async function mintedFixture() {
    const f = await deployTokenFixture();
    await f.token.connect(f.admin).mint(f.alice.address, 600n);
    await f.token.connect(f.admin).mint(f.bob.address, 400n);
    await f.token.connect(f.admin).mint(f.carol.address, 1n);
    await f.token.connect(f.admin).finishMinting();
    return f;
  }

  describe("[falha] arredondamento com cotas indivisíveis não é explorável", () => {
    it("fatiar o saldo em várias carteiras e fazer ping-pong entre distribuições não aumenta a receita", async () => {
      const f = await loadFixture(mintedFixture);
      const { token, distributor, alice, bob, carol, dave, erin, frank, usdt } = f;
      const honestSnapshot = await ethers.provider.send("evm_snapshot", []);

      // cenário honesto: alice fica parada com 600
      const amounts = [1001n, 7n, USDT("123.456789"), 3n, 999_999n];
      for (const a of amounts) await token.connect(distributor).distribute(a, PERIOD);
      const honest = await token.accumulativeRevenueOf(alice.address);
      await ethers.provider.send("evm_revert", [honestSnapshot]);

      // cenário "atacante": alice fatia 600 em 4 carteiras e circula cotas antes/depois de cada distribuição
      const sybils = [alice, dave, erin, frank];
      await token.connect(alice).transfer(dave.address, 1n);
      await token.connect(alice).transfer(erin.address, 1n);
      await token.connect(alice).transfer(frank.address, 1n);
      for (const a of amounts) {
        await token.connect(distributor).distribute(a, PERIOD);
        await token.connect(dave).transfer(erin.address, 1n);
        await token.connect(erin).transfer(frank.address, 1n);
        await token.connect(frank).transfer(dave.address, 1n);
        for (const s of sybils) if ((await token.claimable(s.address)) > 0n) await token.connect(s).claim();
      }
      let attacker = 0n;
      for (const s of sybils) attacker += await token.accumulativeRevenueOf(s.address);
      expect(attacker <= honest, `fatiar rendeu ${attacker} > ${honest}`).to.equal(true);

      // e o sistema continua solvente
      const total = await token.totalDistributed();
      let owed = 0n;
      for (const s of [...sybils, bob, carol]) owed += await token.accumulativeRevenueOf(s.address);
      expect(owed <= total).to.equal(true);
      expect(await usdt.balanceOf(await token.getAddress())).to.equal(total - (await token.totalClaimed()));
    });

    it("titular de 1 cota com distribuições de poucos wei: a sobra é carregada, nunca paga a mais", async () => {
      const f = await loadFixture(mintedFixture);
      const { token, distributor, carol } = f;
      for (let i = 0; i < 20; i++) await token.connect(distributor).distribute(1000n, PERIOD); // 1000 wei / 1001 cotas
      // exato: 20 000 / 1001 = 19,98 → 19 (nunca 20)
      expect(await token.accumulativeRevenueOf(carol.address)).to.equal(19n);
    });
  });

  describe("[falha] ninguém saca mais do que foi distribuído; rescueTokens não toca a receita", () => {
    it("admin retira o excedente máximo e, ainda assim, todos os titulares sacam tudo", async () => {
      const f = await loadFixture(mintedFixture);
      const { token, usdt, admin, distributor, alice, bob, carol } = f;
      const addr = await token.getAddress();
      await token.connect(distributor).distribute(USDT(1000), PERIOD);
      await token.connect(alice).claim();
      await token.connect(alice).transfer(bob.address, 300n);
      await token.connect(distributor).distribute(USDT("0.000000000000000777"), PERIOD);
      await usdt.connect(admin).mint(addr, USDT(5)); // enviado por engano

      const reserved = (await token.totalDistributed()) - (await token.totalClaimed());
      const surplus = (await usdt.balanceOf(addr)) - reserved;
      await expect(token.connect(admin).rescueTokens(await usdt.getAddress(), admin.address, surplus + 1n)).to.be.revertedWithCustomError(
        token,
        "InsufficientSurplus",
      );
      await token.connect(admin).rescueTokens(await usdt.getAddress(), admin.address, surplus);
      for (const s of [alice, bob, carol]) if ((await token.claimable(s.address)) > 0n) await token.connect(s).claim();
      expect(await token.totalClaimed() <= (await token.totalDistributed())).to.equal(true);
      expect(await usdt.balanceOf(addr)).to.equal((await token.totalDistributed()) - (await token.totalClaimed()));
    });

    it("recover de ida e volta não cria receita; a carteira perdida não saca de novo mesmo com KYC ativo", async () => {
      const f = await loadFixture(mintedFixture);
      const { token, admin, distributor, alice, bob, dave } = f;
      await token.connect(distributor).distribute(USDT(1001), PERIOD);
      const sumBefore = (await token.accumulativeRevenueOf(alice.address)) + (await token.accumulativeRevenueOf(dave.address));
      await token.connect(alice).claim();
      await token.connect(admin).recover(alice.address, dave.address);
      await expect(token.connect(alice).claim()).to.be.revertedWithCustomError(token, "NothingToClaim");
      await token.connect(admin).recover(dave.address, alice.address);
      await token.connect(admin).recover(alice.address, dave.address);
      const sumAfter = (await token.accumulativeRevenueOf(alice.address)) + (await token.accumulativeRevenueOf(dave.address));
      expect(sumAfter).to.equal(sumBefore);
      expect(await token.claimable(bob.address)).to.equal(USDT(400));
    });
  });

  describe("M-03 a chave quente de KYC (COMPLIANCE no token, pelo deploy) controla o registro de relatórios", () => {
    it("PoC: o operador de KYC troca o hash do relatório oficial por um forjado e apaga o original", async () => {
      const f = await loadFixture(mintedFixture);
      const { token, admin, compliance } = f;
      const name = ethers.encodeBytes32String("AUDIT-2027-Q1");
      const official = ethers.sha256(ethers.toUtf8Bytes("relatorio oficial"));
      const forged = ethers.sha256(ethers.toUtf8Bytes("relatorio forjado"));
      await token.connect(admin).setDocument(name, "ipfs://oficial", official); // publicado pela Safe
      // deploy-core.ts concede COMPLIANCE_ROLE no token ao mesmo COMPLIANCE_ADDRESS do registro de KYC
      await token.connect(compliance).setDocument(name, "ipfs://forjado", forged);
      expect((await token.getDocument(name))[1]).to.equal(forged); // /verificar passa a dizer "Autêntico" ao forjado
      await token.connect(compliance).removeDocument(name);
      expect(await token.getAllDocuments()).to.deep.equal([]);
    });
  });

  describe("M-02 (centralização) admin pode diluir os cotistas antes de a liquidação terminar", () => {
    it("PoC: admin se concede MINTER e emite o supply não vendido para si → captura parte da receita futura", async () => {
      const f = await deployOffering({ maxSupply: 10_000n, hardCapCotas: 10_000n, softCapCotas: 4_000n });
      const { offering, token, admin, distributor, alice, bob, carol } = f;
      await time.increaseTo(f.startTime);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n); // 4500 vendidas
      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await offering.connect(admin).finalize();

      // janela entre finalize e o último settle: emissão ainda aberta
      await token.connect(admin).grantRole(ROLES.MINTER, admin.address);
      await token.connect(admin).mint(admin.address, 10_000n - 4500n);
      await offering.settle(10n); // entrega normalmente e encerra a emissão
      expect(await token.totalSupply()).to.equal(10_000n);

      await token.connect(distributor).distribute(USDT(10_000), PERIOD);
      // quem pagou 100% da captação recebe só 45% da receita
      expect(await token.claimable(alice.address)).to.equal(USDT(1500));
      expect(await token.accumulativeRevenueOf(admin.address)).to.equal(USDT(5500));
    });

    it("PoC: a checagem de supply do finalize não protege depois dele — o admin pode impedir a entrega após o dinheiro ir à tesouraria", async () => {
      const f = await deployOffering({ maxSupply: 10_000n, hardCapCotas: 10_000n, softCapCotas: 4_000n });
      const { offering, token, usdt, admin, treasury, alice, bob, carol, outsider } = f;
      await time.increaseTo(f.startTime);
      for (const s of [alice, bob, carol]) await offering.connect(s).commit(1500n);
      await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
      await offering.connect(admin).finalize();
      expect(await usdt.balanceOf(treasury.address)).to.equal(4500n * f.params.price);

      await token.connect(admin).grantRole(ROLES.MINTER, admin.address);
      await token.connect(admin).mint(admin.address, 10_000n); // todo o maxSupply
      await expect(offering.connect(outsider).settle(10n)).to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
      await expect(offering.connect(alice).claimTokens()).to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
      await expect(offering.connect(alice).refund()).to.be.revertedWithCustomError(offering, "InvalidState").withArgs(State.Finalized);
    });
  });
});

describe("Auditoria — deploy (scripts/lib/deploy-core)", () => {
  it("M-04 (corrigido) retomar um deploy interrompido no meio do hand-off entrega o admin de TODOS os contratos à Safe", async () => {
    const [, safe, distributor, compliance, treasury] = await ethers.getSigners();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ufv-audit-"));
    const plantsFile = path.join(dir, "plants.json");
    const real = JSON.parse(fs.readFileSync(DEFAULT_PLANTS_FILE, "utf8"));
    real.plants[0].startTime = "+0d";
    real.plants[0].endTime = "+80d";
    fs.writeFileSync(plantsFile, JSON.stringify(real));
    const opts = {
      admin: safe.address,
      distributor: distributor.address,
      compliance: compliance.address,
      treasury: treasury.address,
      plantsFile,
      recordFile: path.join(dir, "record.json"),
      webFile: path.join(dir, "deployments.json"),
    };

    // 1ª execução: o RPC cai logo depois do hand-off do 1º token (antes do da oferta)
    let crashed = false;
    await expect(
      deployAll(hre, {
        ...opts,
        log: (m: string) => {
          if (!crashed && /\(token\): transferência de admin/.test(m)) {
            crashed = true;
            throw new Error("RPC caiu");
          }
        },
      }),
    ).to.be.rejectedWith("RPC caiu");

    // 2ª execução ("é retomável: rode de novo")
    const { record } = await deployAll(hre, { ...opts, log: () => {} });
    const web = JSON.parse(fs.readFileSync(opts.webFile, "utf8"))["31337"];
    for (const p of Object.values(web.plants) as { token: string; offering: string }[]) {
      for (const a of [p.token, p.offering]) {
        const c = await ethers.getContractAt("IdentityRegistry", a); // mesma ABI de admin
        expect((await c.pendingDefaultAdmin())[0], `admin de ${a} não foi entregue à Safe`).to.equal(safe.address);
      }
    }
    expect(record.pendingAdminTransfers).to.have.length(7);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
