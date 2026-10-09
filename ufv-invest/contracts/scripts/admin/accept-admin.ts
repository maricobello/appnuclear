/**
 * Gera o lote do Safe Transaction Builder que aceita a administração (acceptDefaultAdminTransfer)
 * em todos os contratos com transferência pendente, e grava em deployments/<chainId>-accept-admin.json.
 *   npm run admin:accept -- --network bscTestnet
 * Importe o arquivo em app.safe.global → Apps → Transaction Builder, depois do prazo indicado.
 */
import hre from "hardhat";
import path from "node:path";
import { buildAcceptAdminBatch, loadAddresses } from "../lib/admin";
import { DEPLOYMENTS_DIR, writeJson } from "../lib/deployments";

async function main() {
  const a = await loadAddresses(hre);
  const { pending, batch } = await buildAcceptAdminBatch(hre, a);
  if (!pending.length) {
    console.log("nenhuma transferência de admin pendente nesta rede");
    return;
  }
  const out = path.join(DEPLOYMENTS_DIR, `${a.chainId}-accept-admin.json`);
  writeJson(out, batch);
  for (const p of pending) console.log(`${p.contract.padEnd(24)} ${p.address} aceitar após ${new Date(p.acceptAfter * 1000).toISOString()}`);
  console.log(`\nlote para o Transaction Builder: ${out}`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
