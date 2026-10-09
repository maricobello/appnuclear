"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, PlayCircle } from "lucide-react";
import { EChart } from "@/components/charts/EChart";
import { base, C, catAxis, fmtMi, valAxis } from "@/components/charts/theme";
import { brl, num, pct } from "@/lib/fmt";
import { plantTokenAbi } from "@/lib/web3/abi";
import { useTx } from "@/lib/web3/useTx";
import { TxStatus } from "@/components/plant/InvestPanel";
import { buttonClass, Card, cx, StatusChip } from "@/components/ui";
import { setDemo, usePortfolio } from "./data";
import { RequireWallet } from "./Shell";

const PIE = ["#2a78d6", "#22b573", "#0f2a44", "#f5a524", "#9cc3ef", "#8b5cf6", "#e34948"];

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx("mt-1 text-[22px] font-bold tnum", tone === "good" ? "text-good" : "text-ink")}>{value}</div>
    </div>
  );
}

function Inner() {
  const d = usePortfolio();
  const tx = useTx();
  const pie = useMemo(
    () => ({
      tooltip: { trigger: "item", valueFormatter: (v: number) => brl(v, 0) },
      series: [
        {
          type: "pie",
          radius: ["58%", "82%"],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          data: d.positions.map((p, i) => ({ name: p.name, value: Math.round(p.investedBRL), itemStyle: { color: PIE[i % PIE.length] } })),
        },
      ],
    }),
    [d.positions],
  );
  const line = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 20 },
      legend: { show: false },
      xAxis: catAxis(d.series.map((s) => s.label), { boundaryGap: false }),
      yAxis: valAxis(undefined, fmtMi),
      series: [{ name: "Patrimônio", type: "line", smooth: true, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.5, color: C.s1 }, itemStyle: { color: C.s1 }, areaStyle: { color: "rgba(42,120,214,0.08)" }, data: d.series.map((s) => +s.value.toFixed(0)) }],
      tooltip: { ...base().tooltip, axisPointer: { type: "line" }, valueFormatter: (v: number) => brl(v, 0) },
    }),
    [d.series],
  );

  if (d.positions.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <h2 className="text-[20px] font-semibold text-ink">Você ainda não tem cotas</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">
          {d.loading ? "Lendo seus dados na blockchain…" : "Quando você investir em uma usina, suas cotas, distribuições e documentos aparecem aqui."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/usinas" className={buttonClass.primary}>
            Explorar usinas <ArrowRight className="size-4" />
          </Link>
          <button className={buttonClass.secondary} onClick={() => setDemo(true)}>
            <PlayCircle className="size-4" /> Ver demonstração
          </button>
        </div>
      </div>
    );
  }

  const total = d.totals.invested || 1;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total investido" value={brl(d.totals.invested, 2)} />
        <Kpi label="Cotas" value={num(d.totals.cotas)} />
        <Kpi label="Distribuições recebidas" value={brl(d.totals.received, 2)} tone="good" />
        <Kpi label="Distribuição mensal estimada" value={brl(d.totals.monthly, 2)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Distribuição por usina</h2>
          <div className="mt-3 grid items-center gap-4 sm:grid-cols-[180px_1fr]">
            <div className="relative">
              <EChart option={pie} height={180} label="Distribuição do valor investido por usina" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[14px] font-bold text-ink tnum">{brl(d.totals.received, 2)}</span>
                <span className="text-[10px] text-muted">distribuições</span>
              </div>
            </div>
            <ul className="space-y-2 text-[13px]">
              {d.positions.map((p, i) => (
                <li key={p.slug} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                    <span className="truncate text-ink-2">{p.name}</span>
                  </span>
                  <span className="font-semibold text-ink tnum">{pct((p.investedBRL / total) * 100, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Evolução do patrimônio</h2>
          <p className="text-[12px] text-muted">Valor de face das cotas + distribuições recebidas</p>
          <EChart option={line} height={200} label="Evolução do patrimônio nos últimos 12 meses" />
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Suas posições</h2>
          {d.totals.claimable > 0 && <span className="text-[13px] text-good">Disponível para resgate: {brl(d.totals.claimable, 2)}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-medium">Usina</th>
                <th className="py-2.5 text-right font-medium">Cotas</th>
                <th className="py-2.5 text-right font-medium">Valor investido</th>
                <th className="py-2.5 text-right font-medium">Distribuições recebidas</th>
                <th className="py-2.5 text-right font-medium">Rentabilidade (a.a.)</th>
                <th className="py-2.5 pl-4 font-medium">Status</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="tnum">
              {d.positions.map((p) => (
                <tr key={p.slug} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ink">{p.name}</div>
                    <div className="text-[11px] text-muted">
                      {p.municipio} - {p.uf}
                      {p.pendingCotas > 0 && ` · ${num(p.pendingCotas)} em custódia`}
                    </div>
                  </td>
                  <td className="py-3 text-right">{num(p.cotas + p.pendingCotas)}</td>
                  <td className="py-3 text-right">{brl(p.investedBRL, 2)}</td>
                  <td className="py-3 text-right text-good">{brl(p.receivedBRL, 2)}</td>
                  <td className="py-3 text-right">{pct(p.irrPct)}</td>
                  <td className="py-3 pl-4">
                    <StatusChip status={p.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {d.mode === "onchain" && p.claimable && p.claimable > 0n && p.token && (
                        <button
                          className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")}
                          disabled={tx.busy}
                          onClick={async () => (await tx.run(`Resgate ${p.name}`, { address: p.token!, abi: plantTokenAbi, functionName: "claim" })) && d.refetch()}
                        >
                          Resgatar {brl(p.claimableBRL, 2)}
                        </button>
                      )}
                      <Link href={`/usinas/${p.slug}`} className="whitespace-nowrap font-semibold text-good hover:underline">
                        Ver detalhes →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <TxStatus state={tx.state} />
        </div>
      </Card>
    </div>
  );
}

export function PortfolioOverview() {
  return (
    <RequireWallet>
      <h1 className="text-[22px] font-bold text-navy">Meu portfólio</h1>
      <p className="mb-4 text-[13px] text-muted">Acompanhe seus investimentos e o desempenho da sua carteira.</p>
      <Inner />
    </RequireWallet>
  );
}
