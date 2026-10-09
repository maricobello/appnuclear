"use client";

import { useMemo, useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { barRadius, base, C, catAxis, valAxis } from "@/components/charts/theme";
import { useT } from "@/i18n/client";
import { cx } from "@/components/ui";

type Props = {
  projection: number[];
  /** geração estimada com a irradiação medida por satélite no último ano (null = sem histórico) */
  history: { year: number; values: (number | null)[] } | null;
  /** chave da nota em d.gen (com {d} = data, quando houver) */
  historyNote: { key: "noteNasa" | "noteBuilding" | "noteNoData" | "noteFirstYear"; date?: string };
};

/** Geração de energia mês a mês: Histórico (estimado) × Projeção (P50) */
export function GenerationOverview({ projection, history, historyNote }: Props) {
  const [mode, setMode] = useState<"historico" | "projecao">(history ? "historico" : "projecao");
  const { d, t, f } = useT();
  const g = d.gen;
  const note = t(g[historyNote.key], { d: historyNote.date ? f.date(historyNote.date) : "" });
  const data = mode === "historico" && history ? history.values : projection;
  const option = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 28 },
      legend: { show: false },
      xAxis: catAxis(f.months.map((m) => m[0].toUpperCase() + m.slice(1))),
      yAxis: valAxis("MWh", (v: number) => f.num(v)),
      series: [
        {
          name: mode === "historico" ? t(g.historyYear, { y: history?.year ?? "" }) : g.projP50,
          type: "bar",
          barMaxWidth: 22,
          data: data.map((v) => (v == null ? null : { value: +v.toFixed(1), itemStyle: { color: mode === "historico" ? C.s1 : C.s2, borderRadius: barRadius(1) } })),
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${f.num(v, 1)} MWh`) },
    }),
    [data, mode, history?.year, f, g, t],
  );
  const total = data.reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{g.title}</h3>
        <div className="inline-flex rounded-full bg-surface-2 p-1 text-[12px]" role="group" aria-label={g.period}>
          {(
            [
              ["historico", g.history],
              ["projecao", g.projection],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              disabled={id === "historico" && !history}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cx("rounded-full px-3 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40", mode === id ? "bg-white/10 text-ink ring-1 ring-inset ring-white/15" : "text-ink-2 hover:text-ink")}
            >
              {mode === id && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-leaf align-middle" aria-hidden />}
              {label}
            </button>
          ))}
        </div>
      </div>
      <EChart option={option} height={240} label={t(g.aria, { m: mode === "historico" ? g.histEst : g.projLower })} />
      <p className="text-[12px] text-muted">
        {mode === "historico" && history ? `${t(g.totalHist, { v: f.num(total), y: history.year })} ${note}` : `${t(g.totalProj, { v: f.num(total) })} ${!history ? note : ""}`}
      </p>
    </div>
  );
}
