"use client";

import { useMemo, useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { barRadius, base, C, catAxis, fmt0, fmt1, valAxis } from "@/components/charts/theme";
import { MONTHS } from "@/lib/fmt";
import { cx } from "@/components/ui";

type Props = {
  projection: number[];
  /** geração estimada com a irradiação medida por satélite no último ano (null = sem histórico) */
  history: { year: number; values: (number | null)[] } | null;
  historyNote: string;
};

/** Geração de energia mês a mês: Histórico (estimado) × Projeção (P50) */
export function GenerationOverview({ projection, history, historyNote }: Props) {
  const [mode, setMode] = useState<"historico" | "projecao">(history ? "historico" : "projecao");
  const data = mode === "historico" && history ? history.values : projection;
  const option = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 28 },
      legend: { show: false },
      xAxis: catAxis(MONTHS.map((m) => m[0].toUpperCase() + m.slice(1))),
      yAxis: valAxis("MWh", fmt0),
      series: [
        {
          name: mode === "historico" ? `Histórico ${history?.year ?? ""}` : "Projeção (P50)",
          type: "bar",
          barMaxWidth: 22,
          data: data.map((v) => (v == null ? null : { value: +v.toFixed(1), itemStyle: { color: mode === "historico" ? C.s1 : C.s1Light, borderRadius: barRadius(1) } })),
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${fmt1(v)} MWh`) },
    }),
    [data, mode, history?.year],
  );
  const total = data.reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">Geração de energia</h3>
        <div className="inline-flex rounded-full bg-surface-2 p-1 text-[12px]" role="group" aria-label="Período">
          {(
            [
              ["historico", "Histórico"],
              ["projecao", "Projeção"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              disabled={id === "historico" && !history}
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cx("rounded-full px-3 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40", mode === id ? "bg-white text-good shadow-sm" : "text-ink-2 hover:text-ink")}
            >
              {mode === id && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-leaf align-middle" aria-hidden />}
              {label}
            </button>
          ))}
        </div>
      </div>
      <EChart option={option} height={240} label={`Geração mensal em MWh — ${mode === "historico" ? "histórico estimado" : "projeção P50"}`} />
      <p className="text-[12px] text-muted">
        {mode === "historico" && history ? `Total ${fmt0(total)} MWh em ${history.year}. ${historyNote}` : `Projeção P50 do ano 1: ${fmt0(total)} MWh. ${!history ? historyNote : ""}`}
      </p>
    </div>
  );
}
