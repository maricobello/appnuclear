"use client";

import { useMemo, useState } from "react";
import { EChart } from "@/components/charts/EChart";
import { barRadius, base, C, catAxis, fmt0, fmt1, fmtMi, valAxis } from "@/components/charts/theme";
import { cx } from "@/components/ui";
import { MONTHS } from "@/lib/fmt";
import type { Benchmark, CashFlowYear, LiveConditions, MonteCarloSummary, MonthlyGeneration, SensitivityRow } from "@/lib/types";

/** Geração mensal P50 (barras) com a linha P90 — mesma unidade, um eixo. */
export function GenerationChart({ monthly, p90Ratio }: { monthly: MonthlyGeneration[]; p90Ratio: number }) {
  const option = useMemo(
    () => ({
      ...base(),
      xAxis: catAxis(MONTHS),
      yAxis: valAxis("MWh", fmt0),
      series: [
        {
          name: "P50 (mais provável)",
          type: "bar",
          itemStyle: { color: C.s1 },
          barMaxWidth: 28,
          data: monthly.map((m) => ({ value: +m.energyMWh.toFixed(1), itemStyle: { color: C.s1, borderRadius: barRadius(1) } })),
        },
        {
          name: "P90 (conservador)",
          type: "line",
          symbol: "circle",
          symbolSize: 8,
          lineStyle: { width: 2, color: C.s2 },
          itemStyle: { color: C.s2, borderColor: C.surface, borderWidth: 2 },
          data: monthly.map((m) => +(m.energyMWh * p90Ratio).toFixed(1)),
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => `${fmt1(v)} MWh` },
    }),
    [monthly, p90Ratio],
  );
  return <EChart option={option} height={280} label="Geração mensal estimada P50 e P90 em MWh" />;
}

export function IrradianceChart({ ghi }: { ghi: number[] }) {
  const option = useMemo(
    () => ({
      ...base(),
      grid: { ...base().grid, top: 28 },
      legend: { show: false },
      xAxis: catAxis(MONTHS),
      yAxis: valAxis("kWh/m²/dia", (v: number) => fmt1(v)),
      series: [{ name: "Irradiação global horizontal", type: "bar", barMaxWidth: 26, data: ghi.map((v) => ({ value: +v.toFixed(2), itemStyle: { color: C.s1, borderRadius: barRadius(1) } })) }],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => `${fmt1(v)} kWh/m²/dia` },
    }),
    [ghi],
  );
  return <EChart option={option} height={240} label="Irradiação global horizontal média diária por mês" />;
}

export function CashFlowChart({ cashFlows }: { cashFlows: CashFlowYear[] }) {
  const [mode, setMode] = useState<"anual" | "acumulado">("anual");
  const option = useMemo(() => {
    const years = cashFlows.map((c) => (c.year === 0 ? "Inv." : String(c.calendarYear)));
    const values = cashFlows.map((c) => (mode === "anual" ? c.netCashFlowBRL : c.cumulativeBRL));
    return {
      ...base(),
      grid: { ...base().grid, top: 28 },
      legend: { show: false },
      xAxis: catAxis(years, { axisLabel: { color: C.muted, fontSize: 11, interval: "auto" } }),
      yAxis: valAxis("R$", fmtMi),
      series: [
        {
          name: mode === "anual" ? "Fluxo de caixa líquido" : "Fluxo acumulado",
          type: "bar",
          barMaxWidth: 18,
          data: values.map((v) => ({ value: Math.round(v), itemStyle: { color: v >= 0 ? C.s2 : C.neg, borderRadius: barRadius(v) } })),
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => `R$ ${fmtMi(v)}` },
    };
  }, [cashFlows, mode]);
  return (
    <div>
      <div className="mb-2 inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-[13px]" role="tablist" aria-label="Visualização do fluxo de caixa">
        {(["anual", "acumulado"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx("rounded-md px-3 py-1 capitalize transition", mode === m ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
            {m}
          </button>
        ))}
      </div>
      <EChart option={option} height={280} label={`Fluxo de caixa ${mode} do investidor em reais`} />
    </div>
  );
}

export function MonteCarloChart({ mc, cdiPct }: { mc: MonteCarloSummary; cdiPct: number }) {
  const option = useMemo(() => {
    const labels = mc.histogram.map((b) => `${fmt1(b.fromPct)}–${fmt1(b.toPct)}%`);
    const mark = (v: number) => {
      const i = mc.histogram.findIndex((b) => v >= b.fromPct && v < b.toPct);
      return i < 0 ? (v < (mc.histogram[0]?.fromPct ?? 0) ? 0 : mc.histogram.length - 1) : i;
    };
    return {
      ...base(),
      grid: { ...base().grid, top: 40 },
      legend: { show: false },
      xAxis: catAxis(labels, { name: "TIR nominal", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted }, axisLabel: { color: C.muted, fontSize: 10, interval: Math.ceil(labels.length / 6) - 1 } }),
      yAxis: valAxis("simulações", fmt0),
      series: [
        {
          name: "Cenários",
          type: "bar",
          itemStyle: { color: C.s2 },
          barCategoryGap: "8%",
          data: mc.histogram.map((b) => ({ value: b.count, itemStyle: { color: C.s2, borderRadius: [3, 3, 0, 0] } })),
          markLine: {
            symbol: "none",
            silent: true,
            label: { color: C.ink2, fontSize: 11, formatter: "{b}" },
            lineStyle: { type: [4, 3], width: 1.5 },
            data: [
              { name: `P10 ${fmt1(mc.irrP10Pct)}%`, xAxis: mark(mc.irrP10Pct), lineStyle: { color: C.ink2 } },
              { name: `P50 ${fmt1(mc.irrP50Pct)}%`, xAxis: mark(mc.irrP50Pct), lineStyle: { color: C.s1 } },
              { name: `P90 ${fmt1(mc.irrP90Pct)}%`, xAxis: mark(mc.irrP90Pct), lineStyle: { color: C.ink2 } },
              { name: `CDI ${fmt1(cdiPct)}%`, xAxis: mark(cdiPct), lineStyle: { color: C.neg } },
            ],
          },
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => `${fmt0(v)} de ${fmt0(mc.runs)}` },
    };
  }, [mc, cdiPct]);
  return <EChart option={option} height={300} label="Distribuição da TIR em simulação de Monte Carlo" />;
}

export function TornadoChart({ rows, baseIrr }: { rows: SensitivityRow[]; baseIrr: number }) {
  const option = useMemo(() => {
    // linhas que só afetam o VPL (ex.: taxa de desconto) não mudam a TIR — ficam fora do tornado
    const sorted = rows
      .filter((r) => Math.abs(r.irrHighPct - baseIrr) > 0.005 || Math.abs(r.irrLowPct - baseIrr) > 0.005)
      .sort((a, b) => Math.abs(a.irrHighPct - a.irrLowPct) - Math.abs(b.irrHighPct - b.irrLowPct));
    return {
      ...base(),
      grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
      legend: { ...base().legend, data: ["Cenário desfavorável", "Cenário favorável"] },
      xAxis: valAxis(undefined, (v: number) => `${v > 0 ? "+" : ""}${fmt1(v)}`, { position: "top" }),
      yAxis: catAxis(sorted.map((r) => r.variable), { axisLabel: { color: C.ink2, fontSize: 11, width: 210, overflow: "truncate" } }),
      series: [
        {
          name: "Cenário desfavorável",
          type: "bar",
          itemStyle: { color: C.neg },
          stack: "t",
          barMaxWidth: 16,
          data: sorted.map((r) => {
            const d = Math.min(r.irrLowPct, r.irrHighPct) - baseIrr;
            return { value: +d.toFixed(2), itemStyle: { color: C.neg, borderRadius: [4, 0, 0, 4] } };
          }),
        },
        {
          name: "Cenário favorável",
          type: "bar",
          itemStyle: { color: C.s2 },
          stack: "t",
          barMaxWidth: 16,
          data: sorted.map((r) => {
            const d = Math.max(r.irrLowPct, r.irrHighPct) - baseIrr;
            return { value: +d.toFixed(2), itemStyle: { color: C.s2, borderRadius: [0, 4, 4, 0] } };
          }),
        },
      ],
      tooltip: {
        ...base().tooltip,
        formatter: (ps: { dataIndex: number }[]) => {
          const r = sorted[ps[0]?.dataIndex ?? 0];
          if (!r) return "";
          return `<b>${r.variable}</b><br/>${r.lowLabel}: TIR ${fmt1(r.irrLowPct)}%<br/>${r.highLabel}: TIR ${fmt1(r.irrHighPct)}%<br/><span style="color:${C.muted}">Base: ${fmt1(baseIrr)}%</span>`;
        },
      },
    };
  }, [rows, baseIrr]);
  return <EChart option={option} height={Math.max(220, rows.length * 38 + 70)} label="Análise de sensibilidade da TIR em pontos percentuais (tornado)" />;
}

export function BenchmarksChart({ benchmarks }: { benchmarks: Benchmark[] }) {
  const option = useMemo(() => {
    const sorted = [...benchmarks].sort((a, b) => a.finalValueOf1000BRL - b.finalValueOf1000BRL);
    return {
      ...base(),
      grid: { left: 8, right: 64, top: 12, bottom: 8, containLabel: true },
      legend: { show: false },
      // valores rotulados direto nas barras: eixo X sem rótulos para não poluir
      xAxis: valAxis(undefined, fmtMi, { axisLabel: { show: false }, splitLine: { show: false } }),
      yAxis: catAxis(sorted.map((b) => b.name), { axisLabel: { color: C.ink2, fontSize: 12 } }),
      series: [
        {
          name: "Valor final de R$ 1.000",
          type: "bar",
          itemStyle: { color: C.s2 },
          barMaxWidth: 20,
          label: { show: true, position: "right", color: C.ink2, fontSize: 11, formatter: (p: { value: number }) => `R$ ${fmtMi(p.value)}` },
          data: sorted.map((b) => ({
            value: Math.round(b.finalValueOf1000BRL),
            itemStyle: { color: b.name.startsWith("UFV") ? C.s1 : C.s2, borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
      tooltip: { ...base().tooltip, valueFormatter: (v: number) => `R$ ${fmt0(v)}` },
    };
  }, [benchmarks]);
  return <EChart option={option} height={Math.max(200, benchmarks.length * 44 + 30)} label="Comparação do valor final de R$ 1.000 entre investimentos" />;
}

export function ForecastChart({ forecast }: { forecast: LiveConditions["forecast"] }) {
  const option = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", timeZone: "UTC" });
    return {
      ...base(),
      grid: { ...base().grid, top: 28 },
      legend: { show: false },
      xAxis: catAxis(forecast.map((d) => fmtDay.format(new Date(`${d.date}T12:00:00Z`)))),
      yAxis: valAxis("MWh", fmt1),
      series: [{ name: "Energia prevista", type: "bar", barMaxWidth: 30, data: forecast.map((d) => ({ value: +d.energyMWh.toFixed(2), itemStyle: { color: C.s1, borderRadius: barRadius(1) } })) }],
      tooltip: {
        ...base().tooltip,
        formatter: (ps: { dataIndex: number }[]) => {
          const d = forecast[ps[0]?.dataIndex ?? 0];
          if (!d) return "";
          return `<b>${d.date.split("-").reverse().join("/")}</b><br/>Energia: ${fmt1(d.energyMWh)} MWh<br/>Irradiação: ${fmt1(d.ghiKWhM2)} kWh/m²<br/>Nuvens: ${fmt0(d.cloudCoverPct)}% · máx ${fmt0(d.tempMaxC)} °C`;
        },
      },
    };
  }, [forecast]);
  return <EChart option={option} height={220} label="Previsão de geração para os próximos dias" />;
}
