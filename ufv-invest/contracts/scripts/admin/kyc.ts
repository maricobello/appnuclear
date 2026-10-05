/**
 * Aprova (ou remove) KYC de carteiras no IdentityRegistry. Exige COMPLIANCE_ROLE.
 *   ADDRESSES=0xabc,0xdef COUNTRY=76 DAYS=365 npm run admin:kyc -- --network bscTestnet
 *   ADDRESSES=0xabc REMOVE=true npm run admin:kyc -- --network bscTestnet
 */
import hre from "hardhat";
import { kycApprove, kycRemove, loadAddresses } from "../lib/admin";
import { env, envFlag, envList } from "../lib/env";

async function main() {
  const a = await loadAddresses(hre);
  const addresses = envList("ADDRESSES");
  if (envFlag("REMOVE")) return kycRemove(hre, a, addresses);
  await kycApprove(hre, a, { addresses, country: Number(env("COUNTRY") ?? 76), days: Number(env("DAYS") ?? 365) });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
