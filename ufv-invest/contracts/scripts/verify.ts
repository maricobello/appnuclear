/**
 * Verifica no BscScan todos os contratos registrados em deployments/<chainId>.json.
 *   ETHERSCAN_API_KEY=... npm run verify -- --network bscTestnet
 * Usa a API v2 do Etherscan (multichain); o compilador é o solc 0.8.28+commit.7893614a com
 * otimizador (200 runs) e evmVersion cancun — exatamente o do hardhat.config.ts.
 */
import hre from "hardhat";
import { readRecord, recordPath, type ContractRecord } from "./lib/deployments";

async function verify(label: string, fq: string, c: ContractRecord | undefined) {
  if (!c) return;
  try {
    await hre.run("verify:verify", { address: c.address, constructorArguments: c.args, contract: fq });
    console.log(`✓ ${label} ${c.address}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already verified/i.test(msg)) console.log(`= ${label} ${c.address} já verificado`);
    else console.error(`✗ ${label} ${c.address}: ${msg}`);
  }
}

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const rec = readRecord(recordPath(chainId));
  if (!rec) throw new Error(`deployments/${chainId}.json não encontrado — faça o deploy primeiro`);
  await verify("IdentityRegistry", "src/IdentityRegistry.sol:IdentityRegistry", rec.identityRegistry);
  if (rec.paymentToken?.mock) await verify("MockUSDT", "src/testnet/MockUSDT.sol:MockUSDT", rec.paymentToken);
  for (const [slug, p] of Object.entries(rec.plants)) {
    await verify(`${slug} token`, "src/UFVPlantToken.sol:UFVPlantToken", p.token);
    await verify(`${slug} oferta`, "src/UFVOffering.sol:UFVOffering", p.offering);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
