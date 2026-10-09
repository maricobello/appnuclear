import "server-only";
import { createPublicClient, fallback, http, verifyMessage, type Address, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { parseSiweMessage, validateSiweMessage, verifySiweMessage } from "viem/siwe";
import { RPC_URLS, TARGET_CHAIN_ID } from "@/lib/web3/chains";

/**
 * Verificação de "Sign-In with Ethereum" (EIP-4361).
 * Checa domínio, URI, nonce, chainId, janela de validade e a assinatura:
 *  1) ECDSA local (carteiras comuns — não depende de RPC);
 *  2) se falhar, ERC-1271/ERC-6492 via RPC (carteiras de contrato, ex.: Safe).
 */
export async function verifySiwe(params: { message: string; signature: Hex; nonce: string; host: string }): Promise<{ ok: true; address: Address; chainId: number } | { ok: false; reason: string }> {
  const fields = parseSiweMessage(params.message);
  if (!fields.address || !fields.chainId) return { ok: false, reason: "mensagem SIWE malformada" };
  if (fields.chainId !== TARGET_CHAIN_ID) return { ok: false, reason: "rede incorreta" };
  if (fields.uri && !fields.uri.startsWith(`https://${params.host}`) && !fields.uri.startsWith(`http://${params.host}`)) {
    return { ok: false, reason: "URI não corresponde ao site" };
  }
  const valid = validateSiweMessage({ message: fields, domain: params.host, nonce: params.nonce });
  if (!valid) return { ok: false, reason: "domínio, nonce ou validade inválidos" };
  if (!fields.expirationTime) return { ok: false, reason: "mensagem sem expiração" };

  const address = fields.address;
  const eoa = await verifyMessage({ address, message: params.message, signature: params.signature }).catch(() => false);
  if (eoa) return { ok: true, address, chainId: fields.chainId };

  const client = createPublicClient({
    chain: TARGET_CHAIN_ID === 56 ? bsc : bscTestnet,
    transport: fallback(RPC_URLS[TARGET_CHAIN_ID].map((u) => http(u, { timeout: 8000 }))),
  });
  const contractOk = await verifySiweMessage(client, { message: params.message, signature: params.signature, domain: params.host, nonce: params.nonce }).catch(() => false);
  return contractOk ? { ok: true, address, chainId: fields.chainId } : { ok: false, reason: "assinatura inválida" };
}
