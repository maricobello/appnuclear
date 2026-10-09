"use client";

import { useReadContracts } from "wagmi";
import { offeringAbi } from "@/lib/web3/abi";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { plantContracts } from "@/lib/web3/deployments";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export type OfferingStats = {
  sold: number;
  total: number;
  pct: number;
  investors: number | null;
  /** "onchain" = lido do contrato; "ilustrativo" = valor de demonstração do catálogo */
  source: "onchain" | "ilustrativo";
};

/**
 * Cotas subscritas de uma usina: lê `cotasSold`/`hardCapCotas` da oferta quando ela está
 * implantada na rede; senão usa o valor ilustrativo do catálogo (projetos de demonstração).
 */
export function useOfferingStats(slug: string, fallback: { total: number; demoSold: number }): OfferingStats {
  const c = plantContracts(slug);
  const off = c?.offering ?? ZERO;
  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: Boolean(c?.offering), refetchInterval: 30_000 },
    contracts: [
      { address: off, abi: offeringAbi, functionName: "cotasSold", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "hardCapCotas", chainId: TARGET_CHAIN_ID },
      { address: off, abi: offeringAbi, functionName: "investorCount", chainId: TARGET_CHAIN_ID },
    ],
  });
  const r = reads.data;
  const v = (i: number) => (r?.[i]?.status === "success" ? Number(r[i].result as bigint) : undefined);
  const sold = v(0);
  const cap = v(1);
  if (c?.offering && sold !== undefined && cap) {
    return { sold, total: cap, pct: (sold / cap) * 100, investors: v(2) ?? null, source: "onchain" };
  }
  const total = Math.max(1, fallback.total);
  const demo = Math.min(total, Math.max(0, fallback.demoSold));
  return { sold: demo, total, pct: (demo / total) * 100, investors: null, source: "ilustrativo" };
}
