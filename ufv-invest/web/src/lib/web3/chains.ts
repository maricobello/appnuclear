/** Constantes de rede compartilhadas entre servidor e cliente (sem dependência do wagmi). */

export const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97) === 56 ? 56 : 97;
const mainnetRpcs = [process.env.NEXT_PUBLIC_BSC_RPC_URL, "https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"].filter(Boolean) as string[];
const testnetRpcs = [process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL, "https://data-seed-prebsc-1-s1.bnbchain.org:8545", "https://bsc-testnet-rpc.publicnode.com"].filter(Boolean) as string[];

export const RPC_URLS: Record<56 | 97, string[]> = { 56: mainnetRpcs, 97: testnetRpcs };

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const chainName = TARGET_CHAIN_ID === 56 ? "BNB Smart Chain" : "BNB Smart Chain Testnet";

export function explorerUrl(kind: "address" | "tx" | "token", value: string, chainId: number = TARGET_CHAIN_ID) {
  const base = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
  return `${base}/${kind}/${value}`;
}

/** Carteiras recomendadas, por rdns EIP-6963, com nota de segurança exibida no seletor */
export const walletNotes: Record<string, { label: string; note: string; recommended?: boolean }> = {
  "io.rabby": { label: "Rabby", note: "Simula cada transação antes de assinar e alerta contratos suspeitos. Funciona com Ledger/Trezor.", recommended: true },
  "io.metamask": { label: "MetaMask", note: "Padrão do mercado; conecte uma Ledger/Trezor para a máxima segurança.", recommended: true },
  "com.binance.wallet": { label: "Binance Wallet", note: "Carteira Web3 da Binance (autocustódia, MPC). Nativa da BNB Chain.", recommended: true },
  "com.trustwallet.app": { label: "Trust Wallet", note: "Suporta BNB Chain nativamente." },
  "com.okex.wallet": { label: "OKX Wallet", note: "Suporta BNB Chain." },
  "app.phantom": { label: "Phantom", note: "Focada em Solana; para a BNB Chain prefira Rabby, MetaMask ou Binance Wallet." },
};
