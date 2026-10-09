/**
 * SOMENTE TESTNET: emite tUSDT (MockUSDT) para testadores. Exige ser o owner do MockUSDT.
 *   ADDRESSES=0xabc,0xdef AMOUNT=500000 npm run admin:mock-mint -- --network bscTestnet
 */
import hre from "hardhat";
import { parseUnits } from "ethers";
import { loadAddresses } from "../lib/admin";
import { envList, requireEnv } from "../lib/env";

async function main() {
  const a = await loadAddresses(hre);
  if (a.chainId === 56) throw new Error("MockUSDT não existe na mainnet");
  const usdt = await hre.ethers.getContractAt("MockUSDT", a.paymentToken);
  const amount = parseUnits(requireEnv("AMOUNT"), 18);
  for (const to of envList("ADDRESSES")) {
    const tx = await usdt.mint(to, amount);
    await tx.wait();
    console.log(`mint ${requireEnv("AMOUNT")} tUSDT → ${to} (tx ${tx.hash})`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
