import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { COUNTRY_BR, DAY, ROLES, USDT, deployBase, deployTokenFixture, kyc, now } from "./helpers";

const NAME = ethers.encodeBytes32String("AUDIT-2027-Q1");
const NAME2 = ethers.encodeBytes32String("PROSPECTO");
const NAME3 = ethers.encodeBytes32String("LAUDO-ENGENHARIA");
const HASH = ethers.sha256(ethers.toUtf8Bytes("conteudo do PDF"));

/** Token com emissão encerrada: alice 600, bob 400. */
async function mintedFixture() {
  const f = await deployTokenFixture();
  const { token, admin, alice, bob } = f;
  await token.connect(admin).mint(alice.address, 600n);
  await token.connect(admin).mint(bob.address, 400n);
  await token.connect(admin).finishMinting();
  return f;
}

describe("UFVPlantToken", () => {
  describe("construtor e metadados", () => {
    it("expõe configuração e decimals = 0", async () => {
      const { token, registry, usdt, admin } = await loadFixture(deployTokenFixture);
      expect(await token.name()).to.equal("Cota UFV Teste");
      expect(await token.symbol()).to.equal("UFVTST");
      expect(await token.decimals()).to.equal(0n);
      expect(await token.maxSupply()).to.equal(1_000_000n);
      expect(await token.identityRegistry()).to.equal(await registry.getAddress());
      expect(await token.payoutToken()).to.equal(await usdt.getAddress());
      expect(await token.defaultAdmin()).to.equal(admin.address);
      expect(await token.defaultAdminDelay()).to.equal(2n * DAY);
      expect(await token.MAGNITUDE()).to.equal(2n ** 128n);
      expect(await token.mintingFinished()).to.equal(false);
    });

    it("valida parâmetros", async () => {
      const { registry, usdt, admin } = await loadFixture(deployBase);
      const F = await ethers.getContractFactory("UFVPlantToken");
      const reg = await registry.getAddress();
      const pay = await usdt.getAddress();
      await expect(F.deploy("n", "s", 0, reg, pay, admin.address)).to.be.revertedWithCustomError(F, "InvalidMaxSupply");
      await expect(F.deploy("n", "s", 1, ethers.ZeroAddress, pay, admin.address)).to.be.revertedWithCustomError(
        F,
        "ZeroAddress",
      );
      await expect(F.deploy("n", "s", 1, reg, ethers.ZeroAddress, admin.address)).to.be.revertedWithCustomError(
        F,
        "ZeroAddress",
      );
      await expect(F.deploy("n", "s", 1, reg, pay, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        F,
        "AccessControlInvalidDefaultAdmin",
      );
    });
  });

  describe("emissão", () => {
    it("MINTER emite até maxSupply, nem uma cota a mais", async () => {
      const { registry, usdt, admin, alice } = await loadFixture(deployTokenFixture);
      const token = await ethers.deployContract("UFVPlantToken", [
        "n",
        "s",
        100n,
        await registry.getAddress(),
        await usdt.getAddress(),
        admin.address,
      ]);
      await token.connect(admin).grantRole(ROLES.MINTER, admin.address);
      await token.connect(admin).mint(alice.address, 60n);
      await expect(token.connect(admin).mint(alice.address, 41n))
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
        .withArgs(101n, 100n);
      await token.connect(admin).mint(alice.address, 40n);
      expect(await token.totalSupply()).to.equal(100n);
      await expect(token.connect(admin).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
    });

    it("rejeita quantidade zero e destino zero", async () => {
      const { token, admin } = await loadFixture(deployTokenFixture);
      await expect(token.connect(admin).mint(admin.address, 0n)).to.be.revertedWithCustomError(token, "ZeroAmount");
      await expect(token.connect(admin).mint(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
        token,
        "ERC20InvalidReceiver",
      );
    });

    it("emite para carteira sem KYC (liquidação da oferta não trava)", async () => {
      const { token, admin, outsider, registry } = await loadFixture(deployTokenFixture);
      expect(await registry.isVerified(outsider.address)).to.equal(false);
      await expect(token.connect(admin).mint(outsider.address, 5n))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, outsider.address, 5n);
    });

    it("finishMinting é irreversível e só do MINTER", async () => {
      const { token, admin, outsider, alice } = await loadFixture(deployTokenFixture);
      await token.connect(admin).mint(alice.address, 7n);
      await expect(token.connect(outsider).finishMinting())
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ROLES.MINTER);
      await expect(token.connect(admin).finishMinting()).to.emit(token, "MintingFinished").withArgs(7n);
      expect(await token.mintingFinished()).to.equal(true);
      await expect(token.connect(admin).finishMinting()).to.be.revertedWithCustomError(token, "MintingAlreadyFinished");
      await expect(token.connect(admin).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "MintingAlreadyFinished",
      );
    });

    it("admin sem MINTER_ROLE não emite nem encerra a emissão", async () => {
      const { token, admin, alice } = await loadFixture(deployTokenFixture);
      await token.connect(admin).revokeRole(ROLES.MINTER, admin.address);
      await expect(token.connect(admin).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await expect(token.connect(admin).finishMinting()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("transferência restrita (KYC)", () => {
    it("permite entre carteiras verificadas (transfer e transferFrom)", async () => {
      const { token, alice, bob, carol, outsider } = await loadFixture(mintedFixture);
      await expect(token.connect(alice).transfer(bob.address, 10n)).to.changeTokenBalances(token, [alice, bob], [-10n, 10n]);
      await token.connect(bob).approve(outsider.address, 5n);
      // o spender (outsider) não precisa de KYC; as duas pontas sim
      await expect(token.connect(outsider).transferFrom(bob.address, carol.address, 5n)).to.changeTokenBalances(
        token,
        [bob, carol],
        [-5n, 5n],
      );
    });

    it("bloqueia remetente sem KYC", async () => {
      const { token, registry, compliance, alice, bob } = await loadFixture(mintedFixture);
      await registry.connect(compliance).removeInvestor(alice.address);
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(alice.address);
    });

    it("bloqueia destinatário sem KYC", async () => {
      const { token, alice, outsider } = await loadFixture(mintedFixture);
      await expect(token.connect(alice).transfer(outsider.address, 1n))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(outsider.address);
    });

    it("bloqueia quando o KYC vence (remetente ou destinatário)", async () => {
      const { token, registry, compliance, alice, bob } = await loadFixture(mintedFixture);
      const exp = (await now()) + 1000n;
      await registry.connect(compliance).setInvestor(bob.address, COUNTRY_BR, exp);
      await time.setNextBlockTimestamp(exp - 1n);
      await token.connect(alice).transfer(bob.address, 1n); // ainda válido
      await time.setNextBlockTimestamp(exp);
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(bob.address);
      await expect(token.connect(bob).transfer(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(bob.address);
    });

    it("bloqueia mesmo transferências de 0 para carteira sem KYC", async () => {
      const { token, alice, outsider } = await loadFixture(mintedFixture);
      await expect(token.connect(alice).transfer(outsider.address, 0n)).to.be.revertedWithCustomError(token, "NotVerified");
    });
  });

  describe("pausa", () => {
    it("PAUSER pausa/despausa transferências; outros não", async () => {
      const { token, pauser, outsider, alice, bob } = await loadFixture(mintedFixture);
      await expect(token.connect(outsider).pause())
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ROLES.PAUSER);
      await expect(token.connect(pauser).pause()).to.emit(token, "Paused").withArgs(pauser.address);
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(outsider).unpause()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await token.connect(pauser).unpause();
      await token.connect(alice).transfer(bob.address, 1n);
    });

    it("pausa não bloqueia a emissão pela oferta (MINTER)", async () => {
      const { token, admin, pauser, alice } = await loadFixture(deployTokenFixture);
      await token.connect(pauser).pause();
      await token.connect(admin).mint(alice.address, 3n);
      expect(await token.balanceOf(alice.address)).to.equal(3n);
    });
  });

  describe("documentos (ERC-1643)", () => {
    it("admin e COMPLIANCE publicam; demais não", async () => {
      const { token, admin, compliance, outsider } = await loadFixture(deployTokenFixture);
      await expect(token.connect(admin).setDocument(NAME, "ipfs://cid1", HASH))
        .to.emit(token, "DocumentUpdated")
        .withArgs(NAME, "ipfs://cid1", HASH);
      await token.connect(compliance).setDocument(NAME2, "https://ufv.invest/prospecto.pdf", ethers.ZeroHash);
      await expect(token.connect(outsider).setDocument(NAME3, "x", HASH))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, ROLES.COMPLIANCE);
      await expect(token.connect(outsider).removeDocument(NAME)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      expect(await token.getAllDocuments()).to.deep.equal([NAME, NAME2]);
    });

    it("getDocument devolve uri, hash SHA-256 e timestamp; atualização não duplica o índice", async () => {
      const { token, admin } = await loadFixture(deployTokenFixture);
      await token.connect(admin).setDocument(NAME, "ipfs://v1", HASH);
      const t1 = await now();
      expect(await token.getDocument(NAME)).to.deep.equal(["ipfs://v1", HASH, t1]);

      const hash2 = ethers.sha256(ethers.toUtf8Bytes("v2"));
      await time.increase(100);
      await token.connect(admin).setDocument(NAME, "ipfs://v2", hash2);
      const t2 = await now();
      expect(await token.getDocument(NAME)).to.deep.equal(["ipfs://v2", hash2, t2]);
      expect(await token.getAllDocuments()).to.deep.equal([NAME]);

      // documento inexistente
      expect(await token.getDocument(NAME3)).to.deep.equal(["", ethers.ZeroHash, 0n]);
    });

    it("removeDocument mantém o índice consistente (swap-and-pop)", async () => {
      const { token, admin } = await loadFixture(deployTokenFixture);
      await token.connect(admin).setDocument(NAME, "a", HASH);
      await token.connect(admin).setDocument(NAME2, "b", HASH);
      await token.connect(admin).setDocument(NAME3, "c", HASH);
      await expect(token.connect(admin).removeDocument(NAME))
        .to.emit(token, "DocumentRemoved")
        .withArgs(NAME, "a", HASH);
      expect(await token.getAllDocuments()).to.deep.equal([NAME3, NAME2]);
      await token.connect(admin).removeDocument(NAME2);
      expect(await token.getAllDocuments()).to.deep.equal([NAME3]);
      await expect(token.connect(admin).removeDocument(NAME2))
        .to.be.revertedWithCustomError(token, "DocumentNotFound")
        .withArgs(NAME2);
      // re-adicionar depois de remover funciona
      await token.connect(admin).setDocument(NAME, "a2", HASH);
      expect(await token.getAllDocuments()).to.deep.equal([NAME3, NAME]);
      await token.connect(admin).removeDocument(NAME3);
      await token.connect(admin).removeDocument(NAME);
      expect(await token.getAllDocuments()).to.deep.equal([]);
    });

    it("valida nome e uri", async () => {
      const { token, admin } = await loadFixture(deployTokenFixture);
      await expect(token.connect(admin).setDocument(ethers.ZeroHash, "x", HASH)).to.be.revertedWithCustomError(
        token,
        "InvalidDocumentName",
      );
      await expect(token.connect(admin).setDocument(NAME, "", HASH)).to.be.revertedWithCustomError(
        token,
        "EmptyDocumentUri",
      );
    });
  });

  describe("recover (carteira perdida)", () => {
    it("move saldo e receita pendente; histórico sacado fica na carteira antiga", async () => {
      const { token, admin, distributor, registry, compliance, alice, bob, carol, pauser, usdt } =
        await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), ethers.ZeroHash); // alice 600, bob 400
      await token.connect(alice).claim();
      await token.connect(distributor).distribute(USDT(500), ethers.ZeroHash); // alice +300
      expect(await token.claimable(alice.address)).to.equal(USDT(300));

      // alice perdeu a carteira: compliance revoga, admin pausa (emergência) e recupera para carol
      await registry.connect(compliance).removeInvestor(alice.address);
      await token.connect(pauser).pause();
      await expect(token.connect(admin).recover(alice.address, carol.address))
        .to.emit(token, "WalletRecovered")
        .withArgs(alice.address, carol.address, 600n, USDT(300), admin.address)
        .and.to.emit(token, "Transfer")
        .withArgs(alice.address, carol.address, 600n);
      await token.connect(pauser).unpause();

      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await token.balanceOf(carol.address)).to.equal(600n);
      expect(await token.claimable(alice.address)).to.equal(0n);
      expect(await token.claimed(alice.address)).to.equal(USDT(600));
      expect(await token.claimable(carol.address)).to.equal(USDT(300));
      expect(await token.claimed(carol.address)).to.equal(0n);

      // receita futura segue o saldo novo
      await token.connect(distributor).distribute(USDT(100), ethers.ZeroHash);
      expect(await token.claimable(carol.address)).to.equal(USDT(360));
      expect(await token.claimable(bob.address)).to.equal(USDT(400 + 200 + 40));
      await expect(token.connect(carol).claim()).to.changeTokenBalance(usdt, carol, USDT(360));
      // nada sobra para a carteira perdida
      expect(await token.accumulativeRevenueOf(alice.address)).to.equal(USDT(600));
    });

    it("move só a receita quando a carteira perdida já não tem saldo", async () => {
      const { token, admin, distributor, alice, bob, carol } = await loadFixture(mintedFixture);
      await token.connect(distributor).distribute(USDT(1000), ethers.ZeroHash);
      await token.connect(alice).transfer(bob.address, 600n); // receita de 600 fica com alice
      await token.connect(admin).recover(alice.address, carol.address);
      expect(await token.claimable(carol.address)).to.equal(USDT(600));
      expect(await token.claimable(alice.address)).to.equal(0n);
      expect(await token.balanceOf(carol.address)).to.equal(0n);
    });

    it("exige nova carteira verificada e entradas válidas", async () => {
      const { token, admin, alice, bob, outsider, frank } = await loadFixture(mintedFixture);
      await expect(token.connect(admin).recover(alice.address, outsider.address))
        .to.be.revertedWithCustomError(token, "NotVerified")
        .withArgs(outsider.address);
      await expect(token.connect(admin).recover(alice.address, alice.address)).to.be.revertedWithCustomError(
        token,
        "InvalidRecovery",
      );
      await expect(token.connect(admin).recover(ethers.ZeroAddress, bob.address)).to.be.revertedWithCustomError(
        token,
        "ZeroAddress",
      );
      await expect(token.connect(admin).recover(alice.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        token,
        "ZeroAddress",
      );
      await expect(token.connect(admin).recover(frank.address, bob.address)).to.be.revertedWithCustomError(
        token,
        "NothingToRecover",
      );
    });

    it("só DEFAULT_ADMIN_ROLE", async () => {
      const { token, compliance, alice, bob } = await loadFixture(mintedFixture);
      await expect(token.connect(compliance).recover(alice.address, bob.address))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(compliance.address, ROLES.DEFAULT_ADMIN);
    });
  });

  describe("rescueTokens", () => {
    it("devolve outros tokens integralmente e do USDT só o excedente", async () => {
      const { token, admin, distributor, usdt, outsider, alice } = await loadFixture(mintedFixture);
      const tokenAddr = await token.getAddress();
      const other = await ethers.deployContract("MockUSDT", [admin.address]);
      await other.connect(admin).mint(tokenAddr, 77n);
      await expect(token.connect(admin).rescueTokens(await other.getAddress(), outsider.address, 77n))
        .to.emit(token, "TokensRescued")
        .withArgs(await other.getAddress(), outsider.address, 77n);
      expect(await other.balanceOf(outsider.address)).to.equal(77n);

      await token.connect(distributor).distribute(USDT(1000), ethers.ZeroHash);
      await usdt.connect(admin).mint(tokenAddr, 5n); // enviado por engano
      await expect(token.connect(admin).rescueTokens(await usdt.getAddress(), outsider.address, 6n))
        .to.be.revertedWithCustomError(token, "InsufficientSurplus")
        .withArgs(6n, 5n);
      await token.connect(admin).rescueTokens(await usdt.getAddress(), outsider.address, 5n);
      // receita reservada intacta
      await token.connect(alice).claim();
      expect(await usdt.balanceOf(alice.address)).to.equal(USDT(600));
    });

    it("valida e restringe ao admin", async () => {
      const { token, admin, usdt, outsider } = await loadFixture(mintedFixture);
      const u = await usdt.getAddress();
      await expect(token.connect(admin).rescueTokens(u, ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
        token,
        "ZeroAddress",
      );
      await expect(token.connect(admin).rescueTokens(u, outsider.address, 0n)).to.be.revertedWithCustomError(
        token,
        "ZeroAmount",
      );
      await expect(token.connect(outsider).rescueTokens(u, outsider.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("controle de acesso (todas as funções privilegiadas)", () => {
    it("reverte para conta sem papel", async () => {
      const { token, outsider, alice, usdt } = await loadFixture(mintedFixture);
      const t = token.connect(outsider);
      const usdtAddr = await usdt.getAddress();
      const cases: [() => Promise<unknown>, string][] = [
        [() => t.mint(alice.address, 1n), ROLES.MINTER],
        [() => t.finishMinting(), ROLES.MINTER],
        [() => t.distribute(1n, ethers.ZeroHash), ROLES.DISTRIBUTOR],
        [() => t.pause(), ROLES.PAUSER],
        [() => t.unpause(), ROLES.PAUSER],
        [() => t.setDocument(NAME, "x", HASH), ROLES.COMPLIANCE],
        [() => t.removeDocument(NAME), ROLES.COMPLIANCE],
        [() => t.recover(alice.address, outsider.address), ROLES.DEFAULT_ADMIN],
        [() => t.rescueTokens(usdtAddr, outsider.address, 1n), ROLES.DEFAULT_ADMIN],
        [() => t.grantRole(ROLES.MINTER, outsider.address), ROLES.DEFAULT_ADMIN],
        [() => t.revokeRole(ROLES.MINTER, outsider.address), ROLES.DEFAULT_ADMIN],
        [() => t.beginDefaultAdminTransfer(outsider.address), ROLES.DEFAULT_ADMIN],
        [() => t.changeDefaultAdminDelay(0), ROLES.DEFAULT_ADMIN],
      ];
      for (const [tx, role] of cases) {
        await expect(tx()).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount").withArgs(outsider.address, role);
      }
    });

    it("admin pode transferir a administração para a Safe em 2 etapas", async () => {
      const { token, admin, outsider } = await loadFixture(deployTokenFixture);
      await token.connect(admin).beginDefaultAdminTransfer(outsider.address);
      await time.increase(2n * DAY + 1n);
      await token.connect(outsider).acceptDefaultAdminTransfer();
      expect(await token.defaultAdmin()).to.equal(outsider.address);
      expect(await token.owner()).to.equal(outsider.address);
    });

    it("KYC de novas carteiras pelo registro reflete no token imediatamente", async () => {
      const { token, registry, compliance, alice, outsider } = await loadFixture(mintedFixture);
      await kyc(registry, compliance, [outsider]);
      await token.connect(alice).transfer(outsider.address, 1n);
      expect(await token.balanceOf(outsider.address)).to.equal(1n);
    });
  });
});
