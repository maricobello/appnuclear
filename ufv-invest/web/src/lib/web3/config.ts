import { createConfig, createStorage, cookieStorage, fallback, http } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { RPC_URLS, siteUrl, TARGET_CHAIN_ID } from "./chains";

export { TARGET_CHAIN_ID };

/**
 * Configuração Web3 (wagmi + viem).
 *
 * Segurança da conexão:
 *  - Carteiras de extensão são descobertas por EIP-6963 (cada carteira se anuncia com nome, ícone
 *    e rdns), então a pessoa escolhe exatamente qual carteira usar — sem a "corrida" pelo
 *    `window.ethereum` em que uma extensão maliciosa ou concorrente se passa por outra.
 *  - WalletConnect (carteiras móveis e Ledger Live) só é ativado se houver projectId.
 *  - Só as redes BNB Smart Chain (56) e BNB Testnet (97) existem para o app; qualquer outra
 *    rede é recusada antes de assinar.
 *  - RPCs com fallback (vários provedores públicos) e override por variável de ambiente.
 */

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
export const walletConnectEnabled = Boolean(wcProjectId);

export const wagmiConfig = createConfig({
  // as duas redes existem no config (para trocar de rede), mas toda escrita exige TARGET_CHAIN_ID
  chains: [bscTestnet, bsc],
  multiInjectedProviderDiscovery: true,
  connectors: [
    // fallback genérico para navegadores-carteira (Binance app, Trust) que não anunciam EIP-6963
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "UFV Invest",
              description: "Cotas tokenizadas de usinas solares na BNB Chain",
              url: siteUrl,
              icons: [`${siteUrl}/icon.svg`],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [bsc.id]: fallback(RPC_URLS[56].map((u) => http(u, { batch: true, timeout: 10_000 }))),
    [bscTestnet.id]: fallback(RPC_URLS[97].map((u) => http(u, { batch: true, timeout: 10_000 }))),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
