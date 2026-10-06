import { expect } from "chai";
import hre, { ethers } from "hardhat";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { checkPaymentTokenPolicy, deployAll } from "../scripts/lib/deploy-core";
import { BSC_USDT_MAINNET } from "../scripts/lib/deployments";
import { DEFAULT_PLANTS_FILE, loadPlants } from "../scripts/lib/plants-config";
import { DAY, ROLES, USDT } from "./helpers";

describe("Deploy (scripts/lib/deploy-core)", () => {
  it("config/plants.json espelha as 3 usinas do catálogo do front", () => {
    const nowSec = BigInt(Math.floor(Date.parse("2026-10-05T00:00:00Z") / 1000));
    const plants = loadPlants({ nowSec, paymentDecimals: 18 });
    expect(plants.map((p) => p.slug)).to.deep.equal(["ufv-janauba-1", "ufv-petrolina-1", "ufv-bom-jesus-da-lapa-1"]);
    const jan = plants[0];
    expect(jan).to.include({ name: "Cota UFV Janaúba I", symbol: "UFVJAN1", pricePerCotaUSDT: "18.2" });
    expect(jan.maxSupply).to.equal(130_000n);
    expect(jan.softCapCotas).to.equal(91_000n);
    expect(jan.maxCotasPerInvestor).to.equal(13_000n);
    expect(jan.minCotas).to.equal(10n);
    expect(jan.pricePerCota).to.equal(USDT("18.2"));
    expect(jan.withdrawalWindow).to.equal(5n * DAY);
    expect(jan.startTime).to.equal(BigInt(Date.parse("2026-10-01T12:00:00Z") / 1000));
    expect(jan.endTime).to.equal(BigInt(Date.parse("2026-12-20T23:59:59Z") / 1000));
    expect(plants[1]).to.include({ symbol: "UFVPET1" });
    expect([plants[1].maxSupply, plants[1].softCapCotas]).to.deep.equal([84_600n, 59_220n]);
    expect(plants[1].startTime).to.equal(nowSec + DAY);
    expect(plants[1].endTime).to.equal(nowSec + 60n * DAY);
    expect(plants[2]).to.include({ symbol: "UFVBJL1" });
    expect([plants[2].maxSupply, plants[2].softCapCotas]).to.deep.equal([105_600n, 73_920n]);
  });

  it("implanta tudo, configura papéis, entrega o admin à Safe e mescla o deployments.json do front", async () => {
    const [deployer, safe, distributor, compliance, treasury] = await ethers.getSigners();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ufv-deploy-"));
    // datas relativas: o relógio da rede de teste pode ter avançado em outros testes
    const plantsFile = path.join(dir, "plants.json");
    const real = JSON.parse(fs.readFileSync(DEFAULT_PLANTS_FILE, "utf8"));
    real.plants[0].startTime = "+0d";
    real.plants[0].endTime = "+80d";
    fs.writeFileSync(plantsFile, JSON.stringify(real));
    const webFile = path.join(dir, "deployments.json");
    fs.writeFileSync(webFile, JSON.stringify({ "97": { identityRegistry: "0x0000000000000000000000000000000000000097" } }));
    const recordFile = path.join(dir, "record.json");

    const opts = {
      admin: safe.address,
      distributor: distributor.address,
      compliance: compliance.address,
      treasury: treasury.address,
      plantsFile,
      recordFile,
      webFile,
      log: () => {},
    };
    const { record } = await deployAll(hre, opts);

    // front: rede local adicionada, testnet preservada
    const web = JSON.parse(fs.readFileSync(webFile, "utf8"));
    expect(web["97"].identityRegistry).to.equal("0x0000000000000000000000000000000000000097");
    const local = web["31337"];
    expect(local.identityRegistry).to.equal(record.identityRegistry!.address);
    expect(local.paymentToken).to.equal(record.paymentToken!.address);
    expect(local.paymentTokenDecimals).to.equal(18);
    expect(Object.keys(local.plants)).to.deep.equal(["ufv-janauba-1", "ufv-petrolina-1", "ufv-bom-jesus-da-lapa-1"]);

    const registry = await ethers.getContractAt("IdentityRegistry", local.identityRegistry);
    expect(await registry.hasRole(ROLES.COMPLIANCE, compliance.address)).to.equal(true);
    expect((await registry.pendingDefaultAdmin())[0]).to.equal(safe.address);

    const all = [registry] as { getAddress(): Promise<string> }[];
    for (const [slug, { token: tokenAddr, offering: offeringAddr }] of Object.entries(local.plants) as [
      string,
      { token: string; offering: string },
    ][]) {
      const token = await ethers.getContractAt("UFVPlantToken", tokenAddr);
      const offering = await ethers.getContractAt("UFVOffering", offeringAddr);
      all.push(token, offering);
      expect(await token.hasRole(ROLES.MINTER, offeringAddr)).to.equal(true);
      expect(await token.minter()).to.equal(offeringAddr);
      expect(await token.hasRole(ROLES.DISTRIBUTOR, distributor.address)).to.equal(true);
      expect(await token.hasRole(ROLES.PAUSER, safe.address)).to.equal(true);
      // M-03: documentos só com a Safe; a carteira de KYC não tem nenhum papel no token
      expect(await token.hasRole(ROLES.DOCUMENT, safe.address)).to.equal(true);
      for (const role of [ROLES.DOCUMENT, ROLES.MINTER, ROLES.DISTRIBUTOR, ROLES.PAUSER, ROLES.COMPLIANCE]) {
        expect(await token.hasRole(role, compliance.address)).to.equal(false);
      }
      expect(await offering.hasRole(ROLES.PAUSER, safe.address)).to.equal(true);
      expect(await token.identityRegistry()).to.equal(local.identityRegistry);
      expect(await token.payoutToken()).to.equal(local.paymentToken);
      expect(await offering.token()).to.equal(tokenAddr);
      expect(await offering.paymentToken()).to.equal(local.paymentToken);
      expect(await offering.treasury()).to.equal(treasury.address);
      expect(await offering.pricePerCota()).to.equal(USDT("18.2"));
      expect(await offering.minCotas()).to.equal(10n);
      expect(await offering.withdrawalWindow()).to.equal(5n * DAY);
      expect(await offering.hardCapCotas()).to.equal(await token.maxSupply());
      expect(await offering.maxCotasPerInvestor()).to.equal((await token.maxSupply()) / 10n);
      if (slug === "ufv-janauba-1") {
        expect(await token.maxSupply()).to.equal(130_000n);
        expect(await offering.softCapCotas()).to.equal(91_000n);
        expect(await token.symbol()).to.equal("UFVJAN1");
      }
      // o deployer não ficou com nenhum papel operacional
      for (const role of [ROLES.MINTER, ROLES.DISTRIBUTOR, ROLES.PAUSER, ROLES.DOCUMENT]) {
        expect(await token.hasRole(role, deployer.address)).to.equal(false);
      }
      expect(await offering.hasRole(ROLES.PAUSER, deployer.address)).to.equal(false);
    }
    expect(record.pendingAdminTransfers).to.have.length(7);

    // reexecução é idempotente: nada é reimplantado
    const again = await deployAll(hre, opts);
    expect(again.record.identityRegistry!.address).to.equal(record.identityRegistry!.address);
    expect(again.record.plants["ufv-petrolina-1"].offering.address).to.equal(local.plants["ufv-petrolina-1"].offering);

    // a Safe aceita após o atraso de 2 dias e o deployer perde o admin
    await time.increase(2n * DAY + 1n);
    for (const c of all) {
      const ac = await ethers.getContractAt("IdentityRegistry", await c.getAddress()); // mesma ABI de admin
      await ac.connect(safe).acceptDefaultAdminTransfer();
      expect(await ac.defaultAdmin()).to.equal(safe.address);
      expect(await ac.hasRole(ROLES.DEFAULT_ADMIN, deployer.address)).to.equal(false);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("I-03: na mainnet só aceita o USDT BEP-20 oficial como token de pagamento (salvo opt-in)", () => {
    const fake = "0x000000000000000000000000000000000000dEaD";
    expect(() => checkPaymentTokenPolicy(56, fake)).to.throw("não é o USDT BEP-20 oficial");
    expect(() => checkPaymentTokenPolicy(56, fake, true)).not.to.throw();
    expect(() => checkPaymentTokenPolicy(56, BSC_USDT_MAINNET)).not.to.throw();
    expect(() => checkPaymentTokenPolicy(56, BSC_USDT_MAINNET.toLowerCase())).not.to.throw();
    expect(() => checkPaymentTokenPolicy(56, undefined)).not.to.throw(); // vazio = USDT oficial
    expect(() => checkPaymentTokenPolicy(97, fake)).not.to.throw();
  });
});
