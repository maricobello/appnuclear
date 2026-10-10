"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, PlayCircle } from "lucide-react";
import { EChart } from "@/components/charts/EChart";
import { base, C, catAxis, valAxis } from "@/components/charts/theme";
import { useT } from "@/i18n/client";
import { plantTokenAbi } from "@/lib/web3/abi";
import { useTx } from "@/lib/web3/useTx";
import { TxStatus } from "@/components/plant/InvestPanel";
import { buttonClass, Card, cx, StatusChip } from "@/components/ui";
import { setDemo, usePortfolio } from "./data";
import { RequireWallet } from "./Shell";

const PIE = ["#60a5fa", "#3ddc84", "#f5b544", "#a78bfa", "#2dd4bf", "#f472b6", "#f87171"];

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx("mt-1 text-[22px] font-bold tnum", tone === "good" ? "text-good" : "text-ink")}>{value}</div>
    </div>
  );
}

function Inner() {
  const d = usePortfolio();
  const tx = useTx();
  const { d: L, t, f } = useT();
  const { brl, num, pct } = f;
  const pf = L.pf;
  const pie = useMemo(
    () => ({
      tooltip: { trigger: "item", valueFormatter: (v: number) => brl(v, 0) },
      series: [
        {
          type: "pie",
          radius: ["58%", "82%"],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: "#0c121a", borderWidth: 2 },
          data: d.positions.map((p, i) => ({ name: p.name, value: Math.round(p.investedBRL), itemStyle: { color: PIE[i % PIE.length] } })),
        },
      ],
    }),
    [d.positions, brl],
  );
  const line = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 20 },
      legend: { show: false },
      xAxis: catAxis(d.series.map((s) => f.monthYear(new Date(s.date)).replace(".", "")), { boundaryGap: false }),
      yAxis: valAxis(undefined, (v: number) => new Intl.NumberFormat(f.tag, { notation: "compact", maximumFractionDigits: 1 }).format(v)),
      series: [{ name: pf.equity, type: "line", smooth: true, symbol: "circle", symbolSize: 6, lineStyle: { width: 2.5, color: C.s1 }, itemStyle: { color: C.s1 }, areaStyle: { color: "rgba(42,120,214,0.08)" }, data: d.series.map((s) => +s.value.toFixed(0)) }],
      tooltip: { ...base().tooltip, axisPointer: { type: "line" }, valueFormatter: (v: number) => brl(v, 0) },
    }),
    [d.series, brl, f, pf.equity],
  );

  if (d.positions.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <h2 className="text-[20px] font-semibold text-ink">{pf.empty}</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-2">
          {d.loading ? pf.loading : pf.emptyText}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/usinas" className={buttonClass.primary}>
            {pf.explore} <ArrowRight className="size-4" />
          </Link>
          <button className={buttonClass.secondary} onClick={() => setDemo(true)}>
            <PlayCircle className="size-4" /> {pf.demo}
          </button>
        </div>
      </div>
    );
  }

  const total = d.totals.invested || 1;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={pf.kpi.invested} value={brl(d.totals.invested, 2)} />
        <Kpi label={pf.kpi.cotas} value={num(d.totals.cotas)} />
        <Kpi label={pf.kpi.received} value={brl(d.totals.received, 2)} tone="good" />
        <Kpi label={pf.kpi.monthly} value={brl(d.totals.monthly, 2)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">{pf.byPlant}</h2>
          <div className="mt-3 grid items-center gap-4 sm:grid-cols-[180px_1fr]">
            <div className="relative">
              <EChart option={pie} height={180} label={pf.byPlantAria} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[14px] font-bold text-ink tnum">{brl(d.totals.received, 2)}</span>
                <span className="text-[10px] text-muted">{pf.distributions}</span>
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
          <h2 className="text-[15px] font-semibold text-ink">{pf.evolution}</h2>
          <p className="text-[12px] text-muted">{pf.evolutionSub}</p>
          <EChart option={line} height={200} label={pf.evolutionAria} />
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">{pf.positions}</h2>
          {d.totals.claimable > 0 && <span className="text-[13px] text-good">{t(pf.claimable, { v: brl(d.totals.claimable, 2) })}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-medium">{pf.col.plant}</th>
                <th className="py-2.5 text-right font-medium">{pf.col.cotas}</th>
                <th className="py-2.5 text-right font-medium">{pf.col.invested}</th>
                <th className="py-2.5 text-right font-medium">{pf.col.received}</th>
                <th className="py-2.5 text-right font-medium">{pf.col.irr}</th>
                <th className="py-2.5 pl-4 font-medium">{pf.col.status}</th>
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
                      {p.pendingCotas > 0 && t(pf.custody, { n: num(p.pendingCotas) })}
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
                      {/* `p.claimable && …` com 0n renderizaria um "0" solto na tabela */}
                      {d.mode === "onchain" && (p.claimable ?? 0n) > 0n && p.token && (
                        <button
                          className={cx(buttonClass.primary, "px-3 py-1.5 text-[12px]")}
                          disabled={tx.busy}
                          onClick={async () => (await tx.run(t(pf.claimLbl, { name: p.name }), { address: p.token!, abi: plantTokenAbi, functionName: "claim" })) && d.refetch()}
                        >
                          {t(pf.claimBtn, { v: brl(p.claimableBRL, 2) })}
                        </button>
                      )}
                      <Link href={`/usinas/${p.slug}`} className="whitespace-nowrap font-semibold text-good hover:underline">
                        {pf.details}
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
  const { d } = useT();
  return (
    <RequireWallet>
      <h1 className="text-[22px] font-bold text-ink">{d.pf.title}</h1>
      <p className="mb-4 text-[13px] text-muted">{d.pf.sub}</p>
      <Inner />
    </RequireWallet>
  );
}
