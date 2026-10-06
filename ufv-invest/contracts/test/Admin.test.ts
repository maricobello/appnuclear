import { expect } from "chai";
import hre, { ethers } from "hardhat";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll } from "../scripts/lib/deploy-core";
import {
  buildAcceptAdminBatch,
  distributeRevenue,
  finalizeAndSettle,
  kycApprove,
  kycRemove,
  loadAddresses,
  plantStatus,
  publishDocument,
  sha256File,
  toBytes32,
} from "../scripts/lib/admin";
import { USDT } from "./helpers";

describe("Scripts de operação (scripts/lib/admin)", () => {
  it("KYC → aportes → finalize/settle → distribuição → documento → lote da Safe → status", async () => {
    const signers = await ethers.getSigners();
    const [deployer, safe, treasury] = signers;
    const investors = signers.slice(10, 13);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ufv-admin-"));
    const plantsFile = path.join(dir, "plants.json");
    fs.writeFileSync(
      plantsFile,
      JSON.stringify({
        defaults: { pricePerCotaUSDT: "18.2", minCotas: 10, withdrawalWindowDays: 5 },
        plants: [
          { slug: "ufv-teste", name: "Cota UFV Teste", symbol: "UFVTST", maxSupply: 1000, softCapCotas: 100, maxCotasPerInvestor: 500, startTime: "+0d", endTime: "+30d" },
        ],
      }),
    );
    const recordFile = path.join(dir, "record.json");
    const webFile = path.join(dir, "web.json");
    const quiet = () => {};
    await deployAll(hre, {
      admin: safe.address,
      distributor: deployer.address,
      compliance: deployer.address,
      treasury: treasury.address,
      plantsFile,
      recordFile,
      webFile,
      log: quiet,
    });
    const a = await loadAddresses(hre, { recordFile });
    expect(Object.keys(a.plants)).to.deep.equal(["ufv-teste"]);
    // o fallback pelo deployments.json do front devolve os mesmos endereços
    const fromWeb = await loadAddresses(hre, { recordFile: path.join(dir, "inexistente.json"), webFile });
    expect(fromWeb.plants).to.deep.equal(a.plants);

    // KYC
    await kycApprove(hre, a, { addresses: investors.map((s) => s.address), days: 30, log: quiet });
    const registry = await ethers.getContractAt("IdentityRegistry", a.identityRegistry);
    for (const s of investors) expect(await registry.isVerified(s.address)).to.equal(true);
    await expect(kycApprove(hre, a, { addresses: ["0x123"], log: quiet })).to.be.rejectedWith("endereço inválido");

    // aportes com MockUSDT do faucet
    const usdt = await ethers.getContractAt("MockUSDT", a.paymentToken);
    const offering = await ethers.getContractAt("UFVOffering", a.plants["ufv-teste"].offering);
    for (const s of investors) {
      await usdt.connect(s).faucet();
      await usdt.connect(s).approve(await offering.getAddress(), ethers.MaxUint256);
      await offering.connect(s).commit(100n);
    }
    await expect(finalizeAndSettle(hre, a, { plant: "ufv-teste", log: quiet })).to.be.rejectedWith("estado Active");
    await time.increaseTo((await offering.withdrawalsCloseAt()) + 1n);
    await finalizeAndSettle(hre, a, { plant: "ufv-teste", batch: 2, log: quiet });
    expect(await usdt.balanceOf(treasury.address)).to.equal(300n * USDT("18.2"));
    const token = await ethers.getContractAt("UFVPlantToken", a.plants["ufv-teste"].token);
    expect(await token.totalSupply()).to.equal(300n);
    expect(await token.mintingFinished()).to.equal(true);

    // distribuição (deployer é DISTRIBUTOR e owner do MockUSDT)
    await usdt.mint(deployer.address, USDT(1000));
    await distributeRevenue(hre, a, { plant: "ufv-teste", amount: "300", period: "2027-03", log: quiet });
    expect(await token.claimable(investors[0].address)).to.equal(USDT(100));
    await expect(
      distributeRevenue(hre, a, { plant: "ufv-teste", amount: "1", period: "2027-03", log: quiet }),
    ).to.be.rejectedWith("já recebeu");
    await distributeRevenue(hre, a, { plant: "ufv-teste", amount: "3", period: "2027-03", allowDuplicate: true, log: quiet });
    await expect(distributeRevenue(hre, a, { plant: "nao-existe", amount: "1", period: "x", log: quiet })).to.be.rejectedWith(
      "não implantada",
    );

    // documento com SHA-256 do arquivo
    const pdf = path.join(dir, "relatorio.pdf");
    fs.writeFileSync(pdf, "%PDF-1.7 relatório de auditoria");
    // M-03: a carteira de operação (KYC/distribuição) não publica documentos; só a Safe (DOCUMENT_ROLE)
    await expect(
      publishDocument(hre, a, { plant: "ufv-teste", name: "AUDIT-2027-Q1", uri: "ipfs://cid", file: pdf, log: quiet }),
    ).to.be.rejectedWith("DOCUMENT_ROLE");
    const h = await publishDocument(hre, a, {
      plant: "ufv-teste",
      name: "AUDIT-2027-Q1",
      uri: "ipfs://cid",
      file: pdf,
      signer: safe,
      log: quiet,
    });
    expect(h).to.equal(sha256File(pdf));
    expect(h).to.equal(ethers.sha256(fs.readFileSync(pdf)));
    const [uri, docHash] = await token.getDocument(toBytes32("AUDIT-2027-Q1"));
    expect([uri, docHash]).to.deep.equal(["ipfs://cid", h]);

    // lote do Transaction Builder para a Safe aceitar o admin
    const { pending, batch } = await buildAcceptAdminBatch(hre, a);
    expect(pending).to.have.length(3); // registry, token, oferta
    expect(batch.chainId).to.equal("31337");
    expect(batch.meta.createdFromSafeAddress).to.equal(safe.address);
    for (const t of batch.transactions) {
      expect(t.data).to.equal(registry.interface.encodeFunctionData("acceptDefaultAdminTransfer"));
      await safe.sendTransaction({ to: t.to, data: t.data }); // já passou o atraso (time travel acima)
    }
    expect(await token.defaultAdmin()).to.equal(safe.address);
    expect((await buildAcceptAdminBatch(hre, a)).pending).to.have.length(0);

    // remoção de KYC
    await kycRemove(hre, a, [investors[2].address], quiet);
    expect(await registry.isVerified(investors[2].address)).to.equal(false);

    const [status] = await plantStatus(hre, a);
    expect(status).to.include({ slug: "ufv-teste", state: "Finalized", investors: 3, mintingFinished: true, admin: safe.address });
    expect(status.distributed).to.equal("303.0");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
