/**
 * Publica um documento (ex.: relatório de auditoria) no token da usina com o SHA-256 do arquivo.
 * Exige DOCUMENT_ROLE no token — por padrão só a Safe do admin o tem (a carteira de KYC não);
 * nesse caso o script recusa e imprime o SHA-256 para montar setDocument no Transaction Builder.
 *   PLANT=ufv-janauba-1 NAME=AUDIT-2027-Q1 URI=ipfs://bafy... FILE=./relatorio.pdf \
 *     npm run admin:document -- --network bscTestnet
 * Em vez de FILE, pode-se passar HASH=0x<sha256>.
 */
import hre from "hardhat";
import { loadAddresses, publishDocument } from "../lib/admin";
import { env, requireEnv } from "../lib/env";

async function main() {
  const a = await loadAddresses(hre);
  await publishDocument(hre, a, {
    plant: env("PLANT"),
    name: requireEnv("NAME", "até 31 caracteres, ex.: AUDIT-2027-Q1"),
    uri: requireEnv("URI"),
    file: env("FILE"),
    hash: env("HASH"),
  });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
