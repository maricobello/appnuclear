/**
 * Deploy completo da UFV Invest: IdentityRegistry, token de pagamento (MockUSDT em testnet) e,
 * para cada usina de config/plants.json, UFVPlantToken + UFVOffering com os papéis configurados.
 *
 *   npm run deploy:local     # dry run na rede in-process do Hardhat (não grava no front)
 *   npm run deploy:testnet   # BSC testnet (97)
 *   npm run deploy:mainnet   # BSC (56) — exige ADMIN_ADDRESS (Safe) e TREASURY_ADDRESS
 *
 * Configuração via .env (ver .env.example). Retomável: endereços já gravados em
 * deployments/<chainId>.json são reaproveitados (FORCE_REDEPLOY=true para refazer tudo).
 */
import hre from "hardhat";
import { deployAll } from "./lib/deploy-core";
import { env, envFlag, envList } from "./lib/env";

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 31337;
  const writeWeb = !isLocal || envFlag("WRITE_WEB_DEPLOYMENTS");

  await deployAll(hre, {
    admin: env("ADMIN_ADDRESS"),
    distributor: env("DISTRIBUTOR_ADDRESS"),
    compliance: env("COMPLIANCE_ADDRESS"),
    treasury: env("TREASURY_ADDRESS"),
    paymentToken: env("PAYMENT_TOKEN_ADDRESS"),
    only: envList("PLANTS"),
    forceRedeploy: envFlag("FORCE_REDEPLOY"),
    allowEoaAdminOnMainnet: envFlag("ALLOW_EOA_ADMIN"),
    webFile: writeWeb ? env("WEB_DEPLOYMENTS_FILE") : null,
    confirmations: chainId === 56 ? 2 : 1,
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
