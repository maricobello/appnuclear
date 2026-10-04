import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { COUNTRY_BR, DAY, ROLES, deployBase, now } from "./helpers";

describe("IdentityRegistry", () => {
  it("configura admin com transferência em 2 etapas e atraso de 2 dias", async () => {
    const { registry, admin, compliance } = await loadFixture(deployBase);
    expect(await registry.defaultAdmin()).to.equal(admin.address);
    expect(await registry.defaultAdminDelay()).to.equal(2n * DAY);
    expect(await registry.COMPLIANCE_ROLE()).to.equal(ROLES.COMPLIANCE);
    expect(await registry.hasRole(ROLES.COMPLIANCE, compliance.address)).to.equal(true);
  });

  it("rejeita admin inicial zero", async () => {
    const factory = await ethers.getContractFactory("IdentityRegistry");
    await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      factory,
      "AccessControlInvalidDefaultAdmin",
    );
  });

  describe("setInvestor", () => {
    it("cadastra, emite evento e verifica até a expiração (exclusiva)", async () => {
      const { registry, compliance, alice } = await loadFixture(deployBase);
      const expiresAt = (await now()) + 100n;
      await expect(registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, expiresAt))
        .to.emit(registry, "InvestorSet")
        .withArgs(alice.address, COUNTRY_BR, expiresAt, compliance.address);

      expect(await registry.isVerified(alice.address)).to.equal(true);
      expect(await registry.investorOf(alice.address)).to.deep.equal([true, BigInt(COUNTRY_BR), expiresAt]);

      await time.increaseTo(expiresAt - 1n);
      expect(await registry.isVerified(alice.address)).to.equal(true);
      await time.increaseTo(expiresAt);
      expect(await registry.isVerified(alice.address)).to.equal(false);
      // continua cadastrado, só vencido
      expect((await registry.investorOf(alice.address))[0]).to.equal(true);
    });

    it("renova (atualiza) um cadastro existente", async () => {
      const { registry, compliance, alice } = await loadFixture(deployBase);
      const t = await now();
      await registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, t + 10n);
      await time.increaseTo(t + 20n);
      expect(await registry.isVerified(alice.address)).to.equal(false);
      await registry.connect(compliance).setInvestor(alice.address, 840, t + 1000n);
      expect(await registry.isVerified(alice.address)).to.equal(true);
      expect(await registry.investorOf(alice.address)).to.deep.equal([true, 840n, t + 1000n]);
    });

    it("valida carteira, país e validade", async () => {
      const { registry, compliance, alice } = await loadFixture(deployBase);
      const t = await now();
      await expect(
        registry.connect(compliance).setInvestor(ethers.ZeroAddress, COUNTRY_BR, t + 100n),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(registry.connect(compliance).setInvestor(alice.address, 0, t + 100n)).to.be.revertedWithCustomError(
        registry,
        "InvalidCountry",
      );
      // validade igual ao timestamp do bloco do tx (t+1) já é inválida
      await time.setNextBlockTimestamp(t + 5n);
      await expect(registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, t + 5n))
        .to.be.revertedWithCustomError(registry, "InvalidExpiry")
        .withArgs(t + 5n);
    });

    it("só COMPLIANCE_ROLE (nem o admin sem o papel)", async () => {
      const { registry, admin, outsider, alice } = await loadFixture(deployBase);
      const t = await now();
      for (const signer of [admin, outsider]) {
        await expect(registry.connect(signer).setInvestor(alice.address, COUNTRY_BR, t + 100n))
          .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
          .withArgs(signer.address, ROLES.COMPLIANCE);
        await expect(
          registry.connect(signer).setInvestors([alice.address], [COUNTRY_BR], [t + 100n]),
        ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
        await expect(registry.connect(signer).removeInvestor(alice.address)).to.be.revertedWithCustomError(
          registry,
          "AccessControlUnauthorizedAccount",
        );
      }
    });
  });

  describe("setInvestors (lote)", () => {
    it("cadastra vários e emite um evento por carteira", async () => {
      const { registry, compliance, alice, bob, carol } = await loadFixture(deployBase);
      const t = await now();
      const wallets = [alice.address, bob.address, carol.address];
      const tx = registry.connect(compliance).setInvestors(wallets, [76, 76, 32], [t + 100n, t + 200n, t + 300n]);
      await expect(tx).to.emit(registry, "InvestorSet").withArgs(bob.address, 76, t + 200n, compliance.address);
      for (const w of wallets) expect(await registry.isVerified(w)).to.equal(true);
      expect((await registry.investorOf(carol.address))[1]).to.equal(32n);
    });

    it("rejeita tamanhos diferentes, lote vazio e item inválido (atômico)", async () => {
      const { registry, compliance, alice, bob } = await loadFixture(deployBase);
      const t = await now();
      await expect(
        registry.connect(compliance).setInvestors([alice.address, bob.address], [76], [t + 100n, t + 100n]),
      ).to.be.revertedWithCustomError(registry, "LengthMismatch");
      await expect(
        registry.connect(compliance).setInvestors([alice.address], [76], [t + 100n, t + 100n]),
      ).to.be.revertedWithCustomError(registry, "LengthMismatch");
      await expect(registry.connect(compliance).setInvestors([], [], [])).to.be.revertedWithCustomError(
        registry,
        "EmptyBatch",
      );
      await expect(
        registry.connect(compliance).setInvestors([alice.address, bob.address], [76, 0], [t + 100n, t + 100n]),
      ).to.be.revertedWithCustomError(registry, "InvalidCountry");
      expect(await registry.isVerified(alice.address)).to.equal(false);
    });
  });

  describe("removeInvestor", () => {
    it("remove e revoga imediatamente", async () => {
      const { registry, compliance, alice } = await loadFixture(deployBase);
      await registry.connect(compliance).setInvestor(alice.address, COUNTRY_BR, (await now()) + 1000n);
      await expect(registry.connect(compliance).removeInvestor(alice.address))
        .to.emit(registry, "InvestorRemoved")
        .withArgs(alice.address, compliance.address);
      expect(await registry.isVerified(alice.address)).to.equal(false);
      expect(await registry.investorOf(alice.address)).to.deep.equal([false, 0n, 0n]);
    });

    it("reverte se não cadastrado", async () => {
      const { registry, compliance, alice } = await loadFixture(deployBase);
      await expect(registry.connect(compliance).removeInvestor(alice.address))
        .to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(alice.address);
    });
  });

  describe("administração", () => {
    it("troca de admin exige 2 etapas e respeita o atraso", async () => {
      const { registry, admin, outsider } = await loadFixture(deployBase);
      await expect(registry.connect(admin).grantRole(ROLES.DEFAULT_ADMIN, outsider.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlEnforcedDefaultAdminRules",
      );
      await registry.connect(admin).beginDefaultAdminTransfer(outsider.address);
      await expect(registry.connect(outsider).acceptDefaultAdminTransfer()).to.be.revertedWithCustomError(
        registry,
        "AccessControlEnforcedDefaultAdminDelay",
      );
      await time.increase(2n * DAY + 1n);
      await registry.connect(outsider).acceptDefaultAdminTransfer();
      expect(await registry.defaultAdmin()).to.equal(outsider.address);
      expect(await registry.hasRole(ROLES.DEFAULT_ADMIN, admin.address)).to.equal(false);
    });

    it("só o admin concede COMPLIANCE_ROLE", async () => {
      const { registry, compliance, outsider } = await loadFixture(deployBase);
      await expect(registry.connect(compliance).grantRole(ROLES.COMPLIANCE, outsider.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(compliance.address, ROLES.DEFAULT_ADMIN);
    });
  });
});
