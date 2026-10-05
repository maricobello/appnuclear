/**
 * Deposita a receita de um período para distribuição aos cotistas. Exige DISTRIBUTOR_ROLE e saldo
 * do token de pagamento (faz o approve se preciso).
 *   PLANT=ufv-janauba-1 AMOUNT=31234.56 PERIOD=2027-03 npm run admin:distribute -- --network bscTestnet
 * Se o distribuidor é uma Safe, gere a transação no Transaction Builder (approve + distribute).
 */
import hre from "hardhat";
import { distributeRevenue, loadAddresses } from "../lib/admin";
import { env, envFlag, requireEnv } from "../lib/env";

async function main() {
  const a = await loadAddresses(hre);
  await distributeRevenue(hre, a, {
    plant: env("PLANT"),
    amount: requireEnv("AMOUNT", "valor em USDT, ex.: 31234.56"),
    period: requireEnv("PERIOD", "ex.: 2027-03"),
    allowDuplicate: envFlag("ALLOW_DUPLICATE_PERIOD"),
  });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
