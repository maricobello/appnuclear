import "server-only";
import { createHmac } from "node:crypto";
import { createPublicClient, createWalletClient, fallback, http, keccak256, nonceManager, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { identityRegistryAbi } from "./abi";
import { RPC_URLS, TARGET_CHAIN_ID } from "./chains";
import { networkDeployment } from "./deployments";

/**
 * Relayer de KYC da TESTNET: a carteira do próprio site que aprova o KYC de demonstração assim que
 * o investidor envia o formulário, para o fluxo de investimento funcionar de ponta a ponta.
 *
 * - Só existe na BSC testnet (97). Na rede principal a aprovação é manual / por provedor de KYC.
 * - Chave: KYC_RELAYER_PRIVATE_KEY, se definida; senão derivada do SESSION_SECRET (HMAC, sem
 *   segredo novo para guardar). Trocar o SESSION_SECRET troca o endereço do relayer.
 * - Poder mínimo: o deploy dá a ele só COMPLIANCE_ROLE no IdentityRegistry (nenhum papel nos
 *   tokens ou nas ofertas). Ele não movimenta fundos de ninguém.
 */
const COMPLIANCE_ROLE = keccak256(toBytes("COMPLIANCE_ROLE"));
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KYC_VALIDITY_S = 365 * 24 * 60 * 60;

function relayerKey(): Hex | null {
  if (TARGET_CHAIN_ID !== 97) return null;
  const explicit = process.env.KYC_RELAYER_PRIVATE_KEY?.trim();
  if (explicit) return (explicit.startsWith("0x") ? explicit : `0x${explicit}`) as Hex;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  for (let i = 0; i < 4; i++) {
    const k = BigInt(`0x${createHmac("sha256", secret).update(`aferi:kyc-relayer:bsc-testnet:v1:${i}`).digest("hex")}`);
    if (k > 0n && k < SECP256K1_N) return `0x${k.toString(16).padStart(64, "0")}`;
  }
  return null;
}

const transport = () => fallback(RPC_URLS[97].map((u) => http(u, { timeout: 8000, retryCount: 1 })));
const publicClient = () => createPublicClient({ chain: bscTestnet, transport: transport() });

export function relayerAccount() {
  const key = relayerKey();
  // nonceManager: dois KYCs ao mesmo tempo na mesma instância não disputam o mesmo nonce
  return key ? privateKeyToAccount(key, { nonceManager }) : null;
}

export interface RelayerInfo {
  enabled: boolean;
  address: Address | null;
  registry: Address | null;
  hasRole: boolean | null;
  balanceWei: string | null;
}

/** Informação pública (endereço, papel, saldo para gás). Nunca expõe a chave. */
export async function relayerInfo(): Promise<RelayerInfo> {
  const account = relayerAccount();
  const registry = networkDeployment(97).identityRegistry ?? null;
  if (!account) return { enabled: false, address: null, registry, hasRole: null, balanceWei: null };
  if (!registry) return { enabled: true, address: account.address, registry, hasRole: null, balanceWei: null };
  const c = publicClient();
  const [hasRole, balance] = await Promise.all([
    c.readContract({ address: registry, abi: identityRegistryAbi, functionName: "hasRole", args: [COMPLIANCE_ROLE, account.address] }).catch(() => null),
    c.getBalance({ address: account.address }).catch(() => null),
  ]);
  return { enabled: true, address: account.address, registry, hasRole, balanceWei: balance?.toString() ?? null };
}

export type OnChainKyc = { status: "approved"; txHash: Hex } | { status: "already" } | { status: "unavailable"; reason: string };

/** Registra a carteira como investidora verificada (testnet). Idempotente: se já está, não faz nada. */
export async function approveInvestorOnChain(wallet: Address, countryNumeric: number): Promise<OnChainKyc> {
  const account = relayerAccount();
  if (!account) return { status: "unavailable", reason: "relayer desativado (só na testnet)" };
  const registry = networkDeployment(97).identityRegistry;
  if (!registry) return { status: "unavailable", reason: "registro de investidores não implantado" };
  const c = publicClient();
  try {
    const [verified, allowed] = await Promise.all([
      c.readContract({ address: registry, abi: identityRegistryAbi, functionName: "isVerified", args: [wallet] }),
      c.readContract({ address: registry, abi: identityRegistryAbi, functionName: "hasRole", args: [COMPLIANCE_ROLE, account.address] }),
    ]);
    if (verified) return { status: "already" };
    if (!allowed) return { status: "unavailable", reason: "relayer sem COMPLIANCE_ROLE no registro" };
    const w = createWalletClient({ account, chain: bscTestnet, transport: transport() });
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + KYC_VALIDITY_S);
    const hash = await w.writeContract({ address: registry, abi: identityRegistryAbi, functionName: "setInvestor", args: [wallet, countryNumeric, expiresAt] });
    const rc = await c.waitForTransactionReceipt({ hash, timeout: 25_000 });
    if (rc.status !== "success") return { status: "unavailable", reason: "transação revertida" };
    return { status: "approved", txHash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "unavailable", reason: /insufficient funds/i.test(msg) ? "relayer sem saldo para gás" : "falha ao registrar na rede" };
  }
}
