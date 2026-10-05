/**
 * Finaliza a oferta (se Succeeded e a janela de desistência fechou) e entrega as cotas em lotes.
 * `finalize` exige DEFAULT_ADMIN_ROLE (ou qualquer um após a carência de 30 dias); `settle` é livre.
 *   PLANT=ufv-janauba-1 BATCH=100 npm run admin:finalize -- --network bscTestnet
 */
import hre from "hardhat";
import { finalizeAndSettle, loadAddresses } from "../lib/admin";
import { env } from "../lib/env";

async function main() {
  const a = await loadAddresses(hre);
  await finalizeAndSettle(hre, a, { plant: env("PLANT"), batch: Number(env("BATCH") ?? 100) });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
