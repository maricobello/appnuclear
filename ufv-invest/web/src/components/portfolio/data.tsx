"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatUnits, parseAbiItem, type Address } from "viem";
import { useConnection, usePublicClient, useReadContracts } from "wagmi";
import type { PlantSummary } from "@/lib/analysis";
import { plantTokenAbi, offeringAbi } from "@/lib/web3/abi";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";
import { networkDeployment, plantContracts } from "@/lib/web3/deployments";

/**
 * Dados do portfólio. Fonte real: contratos na BNB Chain (saldo de cotas, reservas em custódia,
 * rendimentos resgatados/disponíveis e eventos para o extrato). Enquanto não há contratos
 * implantados ou posições, a pessoa pode abrir uma DEMONSTRAÇÃO com dados fictícios, sempre
 * sinalizada na tela.
 */

export type Position = {
  slug: string;
  name: string;
  municipio: string;
  uf: string;
  status: PlantSummary["status"];
  cotas: number;
  pendingCotas: number;
  investedBRL: number;
  receivedBRL: number;
  claimableBRL: number;
  monthlyEstBRL: number;
  irrPct: number;
  claimable?: bigint;
  token?: Address;
};

export type Tx = {
  at: string;
  kind: "aporte" | "distribuicao" | "resgate" | "desistencia" | "reembolso" | "entrega";
  slug: string;
  plant: string;
  cotas?: number;
  amountBRL: number;
  hash?: string;
};

export type PortfolioData = {
  mode: "onchain" | "demo";
  positions: Position[];
  txs: Tx[];
  /** patrimônio (valor de face + distribuições recebidas) mês a mês */
  /** fim de cada mês (ISO) e patrimônio acumulado; o rótulo é formatado no idioma da interface */
  series: { date: string; value: number }[];
  totals: { invested: number; cotas: number; received: number; monthly: number; claimable: number };
  loading: boolean;
  logsNote: "note1" | "note2" | null;
  refetch: () => void;
};

const Ctx = createContext<{ items: PlantSummary[] } | null>(null);
export function PortfolioProvider({ items, children }: { items: PlantSummary[]; children: ReactNode }) {
  return <Ctx.Provider value={{ items }}>{children}</Ctx.Provider>;
}
export function usePlantItems() {
  const v = useContext(Ctx);
  if (!v) throw new Error("PortfolioProvider ausente");
  return v.items;
}

// ─── modo demonstração (preferência local, nunca dados reais) ───
const DEMO_KEY = "aferi-portfolio-demo";
const listeners = new Set<() => void>();
function readDemo() {
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}
export function setDemo(on: boolean) {
  try {
    if (on) window.localStorage.setItem(DEMO_KEY, "1");
    else window.localStorage.removeItem(DEMO_KEY);
  } catch {
    /* armazenamento indisponível: a demonstração só não persiste */
  }
  listeners.forEach((l) => l());
}
export function useDemo() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readDemo,
    () => false,
  );
}

function buildSeries(positions: Position[], txs: Tx[], months = 12) {
  const now = new Date();
  const out: { date: string; value: number }[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k + 1, 1));
    let v = 0;
    for (const t of txs) {
      if (new Date(t.at) >= end) continue;
      if (t.kind === "aporte") v += t.amountBRL;
      if (t.kind === "desistencia" || t.kind === "reembolso") v -= t.amountBRL;
      if (t.kind === "distribuicao" || t.kind === "resgate") v += t.amountBRL;
    }
    out.push({ date: new Date(end.getTime() - 86400000).toISOString(), value: Math.max(0, v) });
  }
  if (positions.length && out.every((o) => o.value === 0)) out[out.length - 1].value = positions.reduce((s, p) => s + p.investedBRL + p.receivedBRL, 0);
  return out;
}

function demoData(items: PlantSummary[]): Omit<PortfolioData, "loading" | "refetch" | "logsNote"> {
  const plan: [string, number, number][] = [
    ["ufv-horizonte-azul", 10, 9],
    ["ufv-vale-verde", 5, 11],
    ["ufv-serra-dourada", 7, 4],
    ["ufv-sol-do-cerrado", 3, 7],
  ];
  const now = new Date();
  const txs: Tx[] = [];
  const positions: Position[] = [];
  for (const [slug, cotas, monthsAgo] of plan) {
    const p = items.find((i) => i.slug === slug);
    if (!p) continue;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 12));
    const invested = cotas * p.cotaPriceBRL;
    txs.push({ at: start.toISOString(), kind: "aporte", slug, plant: p.name, cotas, amountBRL: invested });
    let received = 0;
    if (p.status === "operacao") {
      for (let m = 1; m < monthsAgo; m++) {
        const v = cotas * p.monthlyPerCotaBRL * (0.88 + 0.24 * Math.abs(Math.sin(m * 1.7 + cotas)));
        received += v;
        txs.push({ at: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 10)).toISOString(), kind: "distribuicao", slug, plant: p.name, amountBRL: v });
      }
    }
    positions.push({ slug, name: p.name, municipio: p.municipio, uf: p.uf, status: p.status, cotas, pendingCotas: 0, investedBRL: invested, receivedBRL: received, claimableBRL: 0, monthlyEstBRL: cotas * p.monthlyPerCotaBRL, irrPct: p.irrNominalPct });
  }
  txs.sort((a, b) => b.at.localeCompare(a.at));
  return {
    mode: "demo",
    positions,
    txs,
    series: buildSeries(positions, txs),
    totals: {
      invested: positions.reduce((s, p) => s + p.investedBRL, 0),
      cotas: positions.reduce((s, p) => s + p.cotas, 0),
      received: positions.reduce((s, p) => s + p.receivedBRL, 0),
      monthly: positions.reduce((s, p) => s + p.monthlyEstBRL, 0),
      claimable: 0,
    },
  };
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const EV = {
  committed: parseAbiItem("event Committed(address indexed investor, uint256 cotas, uint256 amount, uint256 totalCotas, uint256 totalPaid)"),
  withdrawn: parseAbiItem("event Withdrawn(address indexed investor, uint256 cotas, uint256 amount)"),
  refunded: parseAbiItem("event Refunded(address indexed investor, uint256 cotas, uint256 amount)"),
  delivered: parseAbiItem("event TokensDelivered(address indexed investor, uint256 cotas)"),
  claimed: parseAbiItem("event RevenueClaimed(address indexed account, uint256 amount)"),
};

export function usePortfolio(): PortfolioData {
  const items = usePlantItems();
  const demo = useDemo();
  const { address, isConnected } = useConnection();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const net = networkDeployment();
  const deployed = useMemo(() => items.map((p) => ({ p, c: plantContracts(p.slug) })).filter((x) => x.c), [items]);
  const me = address ?? ZERO;
  const usdtBrl = items[0]?.usdtBrl ?? 5.5;
  const dec = net.paymentTokenDecimals;

  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: isConnected && deployed.length > 0 && !demo, refetchInterval: 30_000 },
    contracts: deployed.flatMap(({ c }) => [
      { address: c!.token, abi: plantTokenAbi, functionName: "balanceOf", args: [me], chainId: TARGET_CHAIN_ID } as const,
      { address: c!.token, abi: plantTokenAbi, functionName: "claimable", args: [me], chainId: TARGET_CHAIN_ID } as const,
      { address: c!.token, abi: plantTokenAbi, functionName: "claimed", args: [me], chainId: TARGET_CHAIN_ID } as const,
      { address: c!.offering ?? ZERO, abi: offeringAbi, functionName: "commitmentOf", args: [me], chainId: TARGET_CHAIN_ID } as const,
    ]),
  });

  // extrato on-chain (eventos filtrados pelo endereço do investidor)
  const [logs, setLogs] = useState<{ txs: Tx[]; note: "note1" | "note2" | null; loading: boolean }>({ txs: [], note: null, loading: false });
  useEffect(() => {
    if (demo || !isConnected || !address || !client || deployed.length === 0) return;
    let alive = true;
    (async () => {
      setLogs((l) => ({ ...l, loading: true }));
      const out: Tx[] = [];
      let note: "note1" | "note2" | null = null;
      try {
        const latest = await client.getBlockNumber();
        const span = 45_000n; // ~1,5 dia na BSC; RPCs públicas limitam o intervalo do getLogs
        const from = latest > span ? latest - span : 0n;
        for (const { p, c } of deployed) {
          const off = c!.offering;
          const reqs = [
            ...(off
              ? [
                  client.getLogs({ address: off, event: EV.committed, args: { investor: address }, fromBlock: from, toBlock: latest }).then((ls) => ls.map((l) => ({ l, kind: "aporte" as const, cotas: Number(l.args.cotas), amt: l.args.amount }))),
                  client.getLogs({ address: off, event: EV.withdrawn, args: { investor: address }, fromBlock: from, toBlock: latest }).then((ls) => ls.map((l) => ({ l, kind: "desistencia" as const, cotas: Number(l.args.cotas), amt: l.args.amount }))),
                  client.getLogs({ address: off, event: EV.refunded, args: { investor: address }, fromBlock: from, toBlock: latest }).then((ls) => ls.map((l) => ({ l, kind: "reembolso" as const, cotas: Number(l.args.cotas), amt: l.args.amount }))),
                  client.getLogs({ address: off, event: EV.delivered, args: { investor: address }, fromBlock: from, toBlock: latest }).then((ls) => ls.map((l) => ({ l, kind: "entrega" as const, cotas: Number(l.args.cotas), amt: 0n }))),
                ]
              : []),
            client.getLogs({ address: c!.token, event: EV.claimed, args: { account: address }, fromBlock: from, toBlock: latest }).then((ls) => ls.map((l) => ({ l, kind: "resgate" as const, cotas: undefined, amt: l.args.amount }))),
          ];
          const all = (await Promise.all(reqs)).flat();
          for (const e of all) {
            const b = e.l.blockNumber ? await client.getBlock({ blockNumber: e.l.blockNumber }) : null;
            out.push({
              at: b ? new Date(Number(b.timestamp) * 1000).toISOString() : new Date().toISOString(),
              kind: e.kind,
              slug: p.slug,
              plant: p.name,
              cotas: e.cotas,
              amountBRL: Number(formatUnits(e.amt ?? 0n, dec)) * usdtBrl,
              hash: e.l.transactionHash ?? undefined,
            });
          }
        }
        note = "note1";
      } catch {
        note = "note2";
      }
      if (alive) setLogs({ txs: out.sort((a, b) => b.at.localeCompare(a.at)), note, loading: false });
    })();
    return () => {
      alive = false;
    };
  }, [demo, isConnected, address, client, deployed, dec, usdtBrl]);

  return useMemo<PortfolioData>(() => {
    if (demo) return { ...demoData(items), loading: false, logsNote: null, refetch: () => {} };
    const d = reads.data ?? [];
    const positions: Position[] = [];
    deployed.forEach(({ p, c }, k) => {
      const v = <T,>(j: number) => (d[k * 4 + j]?.status === "success" ? (d[k * 4 + j].result as T) : undefined);
      const bal = Number(v<bigint>(0) ?? 0n);
      const claimable = v<bigint>(1) ?? 0n;
      const claimed = v<bigint>(2) ?? 0n;
      const cm = v<readonly [bigint, bigint, bigint, boolean, boolean]>(3);
      const pending = cm && !cm[3] && !cm[4] ? Number(cm[0]) : 0;
      if (bal + pending === 0 && claimed === 0n) return;
      const cotas = bal + pending;
      positions.push({
        slug: p.slug,
        name: p.name,
        municipio: p.municipio,
        uf: p.uf,
        status: p.status,
        cotas: bal,
        pendingCotas: pending,
        investedBRL: cotas * p.cotaPriceBRL,
        receivedBRL: Number(formatUnits(claimed, dec)) * usdtBrl,
        claimableBRL: Number(formatUnits(claimable, dec)) * usdtBrl,
        monthlyEstBRL: cotas * p.monthlyPerCotaBRL,
        irrPct: p.irrNominalPct,
        claimable,
        token: c!.token,
      });
    });
    const txs = logs.txs;
    return {
      mode: "onchain",
      positions,
      txs,
      series: buildSeries(positions, txs),
      totals: {
        invested: positions.reduce((s, p) => s + p.investedBRL, 0),
        cotas: positions.reduce((s, p) => s + p.cotas + p.pendingCotas, 0),
        received: positions.reduce((s, p) => s + p.receivedBRL, 0),
        monthly: positions.reduce((s, p) => s + p.monthlyEstBRL, 0),
        claimable: positions.reduce((s, p) => s + p.claimableBRL, 0),
      },
      loading: reads.isLoading || logs.loading,
      logsNote: logs.note,
      refetch: () => void reads.refetch(),
    };
  }, [demo, items, reads, deployed, logs, dec, usdtBrl]);
}

export const deployedCount = () => 0;
