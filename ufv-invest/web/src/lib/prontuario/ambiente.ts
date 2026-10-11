import "server-only";
import { createPublicClient, fallback, getAddress, http, isAddress, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import type { OnChainState } from "@/lib/types";
import { identityRegistryAbi, roles } from "@/lib/web3/abi";
import { RPC_URLS, TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { deployedSlugs, networkDeployment } from "@/lib/web3/deployments";
import { relayerInfo } from "@/lib/web3/relayer";
import { readOnChainState } from "@/lib/web3/server";
import type { ReviewItem, Situacao } from "./dados";

/**
 * Revisão técnica do ambiente na hora da emissão: só verifica SE cada configuração existe (nunca lê
 * nem devolve valores de segredo) e consulta os contratos para o estado das ofertas e dos papéis.
 */

const client = createPublicClient({
  chain: TARGET_CHAIN_ID === 56 ? bsc : bscTestnet,
  transport: fallback(RPC_URLS[TARGET_CHAIN_ID].map((u) => http(u, { timeout: 6000, retryCount: 1 }))),
});

function withTimeout<T>(p: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
  return Promise.race([p.catch(() => fallbackValue), new Promise<T>((resolve) => setTimeout(() => resolve(fallbackValue), ms))]);
}

const has = (k: string) => Boolean(process.env[k]?.trim());

export interface Ambiente {
  chainId: number;
  deployed: boolean;
  onChain: Record<string, OnChainState | null>;
  review: ReviewItem[];
}

export async function revisaoAmbiente(): Promise<Ambiente> {
  const chainId = TARGET_CHAIN_ID;
  const mainnet = chainId === 56;
  const net = networkDeployment();
  const deployed = Boolean(net.identityRegistry);
  const review: ReviewItem[] = [];
  const add = (area: string, item: string, situacao: Situacao, detalhe: string) => review.push({ area, item, situacao, detalhe });

  add("Contratos", "Contratos implantados na rede alvo", deployed ? "normal" : "alterado", deployed ? `Registro, token de pagamento e ${deployedSlugs().length} usinas publicados no site.` : "Contratos ainda não implantados nesta rede; o site opera em modo de demonstração.");

  const secret = process.env.SESSION_SECRET ?? "";
  add("Segurança", "Segredo das sessões (SESSION_SECRET)", secret.length >= 32 ? "normal" : "alterado", secret.length >= 32 ? "Configurado com tamanho adequado. Trocar se já tiver sido exposto." : "Ausente ou curto: sessões de login inseguras.");

  if (!mainnet) {
    const info = await withTimeout(relayerInfo(), 9000, null);
    if (!info || !info.enabled) add("Segurança", "Relayer do KYC automático (testnet)", "alterado", "Desativado: defina SESSION_SECRET ou KYC_RELAYER_PRIVATE_KEY.");
    else if (!deployed) add("Segurança", "Relayer do KYC automático (testnet)", "atencao", `Endereço ${info.address}; receberá a permissão de KYC no deploy.`);
    else {
      const bal = info.balanceWei ? Number(info.balanceWei) / 1e18 : 0;
      const s: Situacao = info.hasRole === false ? "alterado" : bal < 0.002 ? "atencao" : "normal";
      add("Segurança", "Relayer do KYC automático (testnet)", s, `${info.hasRole ? "Com" : "Sem"} permissão de KYC; saldo de ${bal.toFixed(4)} tBNB para gás.`);
    }
  } else {
    add("Segurança", "Relayer do KYC automático", "na", "Desligado por desenho na rede principal: aprovação pelo provedor de KYC e pela equipe de compliance.");
  }

  if (deployed && net.identityRegistry) {
    const admin = await withTimeout(client.readContract({ address: net.identityRegistry, abi: identityRegistryAbi, functionName: "defaultAdmin" }), 8000, null);
    const code = admin ? await withTimeout(client.getCode({ address: admin }), 8000, undefined) : undefined;
    const isContract = Boolean(code && code !== "0x");
    add(
      "Segurança",
      "Administração em carteira multisig",
      admin === null ? "atencao" : isContract ? "normal" : mainnet ? "alterado" : "atencao",
      admin === null ? "Não foi possível ler o administrador agora." : isContract ? `Administrador ${admin} é um contrato (Safe).` : `Administrador ${admin} é uma carteira comum${mainnet ? ": exigir Safe multisig." : " (aceitável só na testnet)."}`,
    );
  }

  add("Integrações", "Provedor de KYC (KYC_WEBHOOK_URL)", has("KYC_WEBHOOK_URL") ? "normal" : mainnet ? "alterado" : "atencao", has("KYC_WEBHOOK_URL") ? "Pedidos encaminhados ao provedor." : "Sem provedor: na testnet o KYC é aprovado pelo relayer; na rede principal é obrigatório.");
  add("Integrações", "Contatos de interessados (LEADS_WEBHOOK_URL)", has("LEADS_WEBHOOK_URL") ? "normal" : "atencao", has("LEADS_WEBHOOK_URL") ? "Contatos encaminhados ao CRM." : "Contatos só na memória do servidor.");
  add("Integrações", "Carteiras de celular (WalletConnect)", has("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID") ? "normal" : "atencao", has("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID") ? "Conexão por QR code ativa." : "Só extensões de navegador; ID gratuito em cloud.reown.com.");
  add("Integrações", "Acesso dedicado à blockchain (RPC)", has(mainnet ? "NEXT_PUBLIC_BSC_RPC_URL" : "NEXT_PUBLIC_BSC_TESTNET_RPC_URL") ? "normal" : "atencao", "Provedor privado reduz falhas e limites dos RPCs públicos.");

  const onChain: Record<string, OnChainState | null> = {};
  if (deployed) {
    await Promise.all(
      deployedSlugs().map(async (slug) => {
        onChain[slug] = await withTimeout(readOnChainState(slug), 9000, null);
      }),
    );
  }
  return { chainId, deployed, onChain, review };
}

/**
 * Quem pode emitir o prontuário: carteira com papel no registro (administradora, administradora
 * pendente ou compliance) ou listada em ADMIN_WALLETS (vírgulas) — útil antes do deploy.
 */
export async function isAdminWallet(address: string): Promise<boolean> {
  if (!isAddress(address)) return false;
  const me = getAddress(address);
  const listed = (process.env.ADMIN_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => isAddress(s))
    .map((s) => getAddress(s));
  if (listed.includes(me)) return true;
  const registry = networkDeployment().identityRegistry;
  if (!registry) return false;
  const read = <T>(p: Promise<T>) => withTimeout(p as Promise<T | null>, 8000, null);
  const [admin, pending, compliance] = await Promise.all([
    read(client.readContract({ address: registry, abi: identityRegistryAbi, functionName: "defaultAdmin" })),
    read(client.readContract({ address: registry, abi: identityRegistryAbi, functionName: "pendingDefaultAdmin" })),
    read(client.readContract({ address: registry, abi: identityRegistryAbi, functionName: "hasRole", args: [roles.COMPLIANCE_ROLE, me as Address] })),
  ]);
  const same = (a?: string | null) => Boolean(a && a.toLowerCase() === me.toLowerCase());
  return same(admin) || same(pending?.[0]) || compliance === true;
}
