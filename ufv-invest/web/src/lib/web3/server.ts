import "server-only";
import { createPublicClient, fallback, hexToString, http, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import type { OnChainState } from "@/lib/types";
import { offeringAbi, plantTokenAbi } from "./abi";
import { RPC_URLS, TARGET_CHAIN_ID } from "./chains";
import { plantContracts } from "./deployments";

const client = createPublicClient({
  chain: TARGET_CHAIN_ID === 56 ? bsc : bscTestnet,
  transport: fallback(RPC_URLS[TARGET_CHAIN_ID].map((u) => http(u, { timeout: 6000, retryCount: 1 }))),
});

const STATES: OnChainState["offeringState"][] = ["pending", "active", "succeeded", "failed", "finalized", "cancelled"];

/** Lê o estado on-chain da usina (para o PDF). Retorna null se não implantada ou se o RPC falhar. */
export async function readOnChainState(slug: string): Promise<OnChainState | null> {
  const c = plantContracts(slug);
  if (!c) return null;
  const [totalSupply, maxSupply, names] = await Promise.all([
    client.readContract({ address: c.token, abi: plantTokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: c.token, abi: plantTokenAbi, functionName: "maxSupply" }),
    client.readContract({ address: c.token, abi: plantTokenAbi, functionName: "getAllDocuments" }),
  ]);
  const docs = await Promise.all(
    (names as readonly Hex[]).map(async (n) => {
      const [uri, hash, ts] = await client.readContract({ address: c.token, abi: plantTokenAbi, functionName: "getDocument", args: [n] });
      let name: string;
      try {
        name = hexToString(n, { size: 32 }).replace(/\0+$/, "");
      } catch {
        name = n;
      }
      return { name, uri, hash, timestamp: Number(ts) };
    }),
  );
  let cotasSold = 0n;
  let raised = 0n;
  let state: OnChainState["offeringState"] = "finalized";
  if (c.offering) {
    const [s, sold, r] = await Promise.all([
      client.readContract({ address: c.offering, abi: offeringAbi, functionName: "state" }),
      client.readContract({ address: c.offering, abi: offeringAbi, functionName: "cotasSold" }),
      client.readContract({ address: c.offering, abi: offeringAbi, functionName: "totalRaised" }),
    ]);
    state = STATES[Number(s)] ?? "pending";
    cotasSold = sold;
    raised = r;
  }
  return {
    chainId: c.chainId,
    tokenAddress: c.token,
    offeringAddress: c.offering,
    totalSupply,
    maxSupply,
    cotasSold,
    raisedUSDT: raised,
    offeringState: state,
    documents: docs,
  };
}
