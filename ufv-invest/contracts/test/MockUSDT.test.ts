import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { DAY, USDT, deployBase } from "./helpers";

describe("MockUSDT (somente testnet)", () => {
  it("tem 18 casas e símbolo de teste", async () => {
    const { usdt } = await loadFixture(deployBase);
    expect(await usdt.decimals()).to.equal(18n);
    expect(await usdt.symbol()).to.equal("tUSDT");
  });

  it("faucet entrega 10k, respeita o cooldown de 1 dia e o teto de 100k por carteira", async () => {
    const { usdt, alice } = await loadFixture(deployBase);
    await expect(usdt.connect(alice).faucet()).to.emit(usdt, "FaucetUsed").withArgs(alice.address, USDT(10_000));
    expect(await usdt.balanceOf(alice.address)).to.equal(USDT(10_000));

    const availableAt = await usdt.faucetAvailableAt(alice.address);
    await expect(usdt.connect(alice).faucet()).to.be.revertedWithCustomError(usdt, "FaucetCooldown").withArgs(availableAt);

    for (let i = 1; i < 10; i++) {
      await time.increase(DAY);
      await usdt.connect(alice).faucet();
    }
    expect(await usdt.balanceOf(alice.address)).to.equal(USDT(100_000));
    await time.increase(DAY);
    await expect(usdt.connect(alice).faucet()).to.be.revertedWithCustomError(usdt, "FaucetCapReached");
  });

  it("mint só pelo owner", async () => {
    const { usdt, admin, alice } = await loadFixture(deployBase);
    await usdt.connect(admin).mint(alice.address, 5n);
    expect(await usdt.balanceOf(alice.address)).to.equal(5n);
    await expect(usdt.connect(alice).mint(alice.address, 5n)).to.be.revertedWithCustomError(
      usdt,
      "OwnableUnauthorizedAccount",
    );
  });
});
