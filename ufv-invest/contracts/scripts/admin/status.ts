/** Resumo on-chain das ofertas e tokens.  npm run admin:status -- --network bscTestnet */
import hre from "hardhat";
import { loadAddresses, plantStatus } from "../lib/admin";

async function main() {
  const a = await loadAddresses(hre);
  console.log(`chainId ${a.chainId} · registry ${a.identityRegistry} · pagamento ${a.paymentToken}`);
  for (const s of await plantStatus(hre, a)) console.log(JSON.stringify(s, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
