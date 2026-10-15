"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMemo } from "react";
import { ChevronRight, CircleCheck, Droplets, ShieldCheck, TrendingUp, TriangleAlert, Zap } from "lucide-react";
import type { ChartOption } from "@/components/EChart";
import { ChartFrame } from "@/components/EChart";
import { Appear, EASE } from "@/components/motion";
import { ConfidenceBar, Delta, Empty, MetricRow, ScrollX, sourceState, type DataState } from "@/components/ui";
import type { AlertasResp, AuditoriaLite, BessResp, BrasilResp, ClimaResp, PrevisaoResp, RenovaveisResp } from "@/lib/apiTypes";
import type { BessAsset } from "@/lib/asset";
import { band, baseOption, C, categoryAxis, line, SUB_COLOR, SUB_CSS, timeAxis, tooltipTime, valueAxis } from "@/lib/chart";
import { brl, compact, nf, num, pct } from "@/lib/fmt";
import type { Opportunity } from "@/lib/market/opportunities";
import { addDays, brtDate, brtHour } from "@/lib/sources/time";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";

const n2 = nf(2);
const n1 = nf(1);
const n0 = nf(0);

/* ============================================================ KPIs */

export interface KpiSpec {
  key: string;
  label: string;
  value: number | null;
  format: (v: number) => string;
  unit?: string;
  delta?: number | null;
  deltaSuffix?: string;
  deltaTitle?: string;
  spark?: (number | null)[];
  color?: string;
  swatch?: string;
  state?: DataState | null;
  at?: number | null;
  source?: string;
  detail?: string | null;
  foot?: string | null;
}

const lastAtOrBefore = (ts: number[], vals: (number | null)[], t: number) => {
  for (let i = ts.length - 1; i >= 0; i--) if (ts[i] <= t && vals[i] !== null) return i;
  return -1;
};

const hh = (t: number | null | undefined) => (t ? `${String(brtHour(t)).padStart(2, "0")}h` : "");

export function buildKpis(br?: BrasilResp, clima?: ClimaResp, renov?: RenovaveisResp, now = Date.now()): KpiSpec[] {
  const out: KpiSpec[] = [];
  const pldState = sourceState(br?.meta.pld, 2 * 3600_000, now);
  const pldSrc = br?.meta.pld.note?.startsWith("PLD oficial") ? "CCEE oficial" : br?.meta.pld.fallback ? "ONS · CMO→PLD" : "CCEE";
  for (const s of SUBS) {
    const k = br?.kpis?.find((x) => x.sub === s);
    out.push({
      key: `pld-${s}`,
      label: s === "SE" ? "SE/CO" : SUB_NAMES[s],
      value: k?.now ?? null,
      format: (v) => n2.format(v),
      unit: "R$/MWh",
      delta: k?.now != null && k?.dayAgo ? (100 * (k.now - k.dayAgo)) / k.dayAgo : null,
      deltaTitle: "vs. mesma hora de ontem",
      spark: k?.spark,
      color: SUB_COLOR[s],
      swatch: SUB_CSS[s],
      state: pldState,
      foot: k?.tomorrowAvg != null ? `amanhã ${n0.format(k.tomorrowAvg)}` : null,
      at: k?.at ?? br?.meta.pld.latestTs,
      source: `${pldSrc} · hora ${hh(k?.at)}${k?.tomorrowAvg != null ? ` · D+1 ${n0.format(k.tomorrowAvg)}` : ""}`,
      detail: br?.meta.pld.fallback ?? br?.meta.pld.note,
    });
  }
  // CMO SE (DESSEM)
  const cmo = br?.cmo;
  const ci = cmo ? lastAtOrBefore(cmo.ts, cmo.values.SE, now) : -1;
  out.push({
    key: "cmo",
    label: "CMO SE · DESSEM",
    value: ci >= 0 ? cmo!.values.SE[ci] : null,
    format: (v) => n2.format(v),
    unit: "R$/MWh",
    delta: ci >= 24 && cmo!.values.SE[ci - 24] ? (100 * (cmo!.values.SE[ci]! - cmo!.values.SE[ci - 24]!)) / cmo!.values.SE[ci - 24]! : null,
    deltaTitle: "vs. 24 h antes",
    spark: ci >= 0 ? cmo!.values.SE.slice(Math.max(0, ci - 47), ci + 1) : [],
    color: C.accent2,
    state: sourceState(br?.meta.cmo, 3 * 3600_000, now),
    at: ci >= 0 ? cmo!.ts[ci] : null,
    source: `ONS · hora ${ci >= 0 ? hh(cmo!.ts[ci]) : "—"}`,
    detail: br?.meta.cmo.fallback ?? br?.meta.cmo.error,
  });
  // carga do SIN (soma dos submercados)
  const load = br?.load;
  const sin = load ? load.ts.map((_, i) => (SUBS.every((s) => load.values[s][i] !== null) ? SUBS.reduce((a, s) => a + (load.values[s][i] as number), 0) : null)) : [];
  const li = load ? lastAtOrBefore(load.ts, sin, now) : -1;
  out.push({
    key: "load",
    label: "Carga do SIN",
    value: li >= 0 ? sin[li]! / 1000 : null,
    format: (v) => n1.format(v),
    unit: "GW",
    delta: li >= 24 && sin[li - 24] ? (100 * (sin[li]! - sin[li - 24]!)) / sin[li - 24]! : null,
    deltaTitle: "vs. mesma hora de ontem",
    spark: li >= 0 ? sin.slice(Math.max(0, li - 71), li + 1) : [],
    color: C.series[6],
    state: sourceState(br?.meta.load, 54 * 3600_000, now), // carga verificada sai com ~1 dia de defasagem
    at: li >= 0 ? load!.ts[li] : null,
    source: `ONS · verificada ${li >= 0 ? `${brtDate(load!.ts[li]).slice(8, 10)}/${brtDate(load!.ts[li]).slice(5, 7)} ${hh(load!.ts[li])}` : "—"}`,
    detail: br?.meta.load.fallback ?? br?.meta.load.error,
  });
  // reservatórios SE/CO
  const ear = br?.ear?.values.SE.filter((v): v is number => v !== null) ?? [];
  out.push({
    key: "ear",
    label: "Reservatórios SE/CO",
    value: ear.length ? ear[ear.length - 1] : null,
    format: (v) => n1.format(v),
    unit: "% EARmax",
    delta: ear.length > 8 ? ear[ear.length - 1] - ear[ear.length - 8] : null,
    deltaSuffix: " p.p.",
    deltaTitle: "variação em 7 dias",
    spark: br?.ear?.values.SE.slice(-60),
    color: SUB_COLOR.SE,
    state: sourceState(br?.meta.ear, 60 * 3600_000, now),
    at: br?.meta.ear.latestTs,
    source: `ONS · ${br?.ear?.dates.slice(-1)[0]?.split("-").reverse().slice(0, 2).join("/") ?? "—"}`,
    detail: br?.meta.ear.fallback ?? br?.meta.ear.error,
  });
  // eólica e solar: fator de capacidade previsto (Open-Meteo) nos polos
  const cf = (role: string) => {
    const hubs = clima?.hubs.filter((h) => h.role === role) ?? [];
    if (!hubs.length) return null;
    const key = role === "solar" ? "solarCf" : "windCf";
    const series = hubs[0].series.ts.map((_, i) => hubs.reduce((a, h) => a + (h.series[key][i] ?? 0), 0) / hubs.length);
    const start = Math.max(0, hubs[0].series.ts.findIndex((t) => t >= now - 3600_000));
    const next24 = series.slice(start, start + 24);
    const after = series.slice(start + 24, start + 48);
    const m = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const a = m(next24), b = m(after);
    return { value: a !== null ? 100 * a : null, delta: a !== null && b !== null ? 100 * (b - a) : null, spark: series.slice(start, start + 72).map((v) => 100 * v), names: hubs.map((h) => h.name).join(", ") };
  };
  const wind = cf("eólica");
  const sol = cf("solar");
  const wxState = sourceState(clima?.meta.weather, 12 * 3600_000 + 7 * 86400_000, now);
  out.push({
    key: "wind",
    label: "Eólica · FC previsto",
    value: wind?.value ?? null,
    format: (v) => n0.format(v),
    unit: "% próx. 24 h",
    delta: wind?.delta ?? null,
    deltaSuffix: " p.p.",
    deltaTitle: "amanhã (24–48 h) vs. próximas 24 h",
    spark: wind?.spark,
    color: C.series[2],
    state: wxState,
    at: clima?.generatedAt,
    source: `Open-Meteo · ${wind?.names ?? "polos NE"}`,
  });
  out.push({
    key: "solar",
    label: "Solar · FC previsto",
    value: sol?.value ?? null,
    format: (v) => n0.format(v),
    unit: "% próx. 24 h",
    delta: sol?.delta ?? null,
    deltaSuffix: " p.p.",
    deltaTitle: "amanhã (24–48 h) vs. próximas 24 h",
    spark: sol?.spark,
    color: C.series[3],
    state: wxState,
    at: clima?.generatedAt,
    source: `Open-Meteo · ${sol?.names ?? "polo MG"}`,
  });
  // corte de eólica + solar (ONS), último dia fechado
  const cd = renov?.curtailment?.daily ?? [];
  const dayTot = cd.map((x) => SUBS.reduce((a, sb) => a + x.eolica[sb] + x.solar[sb], 0) / 1000);
  out.push({
    key: "curt",
    label: "Corte eólica + solar",
    value: dayTot.length ? dayTot[dayTot.length - 1] : null,
    format: (v) => n0.format(v),
    unit: "GWh/dia",
    delta: dayTot.length >= 2 && dayTot[dayTot.length - 2] > 0 ? (100 * (dayTot[dayTot.length - 1] - dayTot[dayTot.length - 2])) / dayTot[dayTot.length - 2] : null,
    deltaTitle: "vs. dia anterior",
    spark: dayTot,
    color: C.series[2],
    state: sourceState(renov?.meta.curtailment, 54 * 3600_000, now),
    at: renov?.meta.curtailment.latestTs,
    source: cd.length ? `ONS · ${cd[cd.length - 1].date.slice(8, 10)}/${cd[cd.length - 1].date.slice(5, 7)} · constrained-off` : "ONS · constrained-off",
  });
  return out;
}

/* ================================================= gráfico principal */

export type Range = "24H" | "7D" | "30D";
export type Mode = "real" | "prev";

function hourly(br: BrasilResp, range: Range, now: number) {
  if (range === "30D" && br.aggregates) {
    const ts: number[] = [];
    const values = Object.fromEntries(SUBS.map((s) => [s, [] as (number | null)[]])) as Record<Sub, (number | null)[]>;
    br.aggregates.heatDates.forEach((d, di) => {
      for (let h = 0; h < 24; h++) {
        ts.push(Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`));
        for (const s of SUBS) values[s].push(br.aggregates!.heat[s][di]?.[h] ?? null);
      }
    });
    return { ts, values };
  }
  const p = br.pld!;
  const from = now - (range === "24H" ? 24 : 7 * 24) * 3600_000;
  const idx = p.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= from).map(([, i]) => i);
  return { ts: idx.map((i) => p.ts[i]), values: Object.fromEntries(SUBS.map((s) => [s, idx.map((i) => p.values[s][i])])) as Record<Sub, (number | null)[]> };
}

export function pldMainOption(br: BrasilResp, range: Range, mode: Mode, fc: Partial<Record<Sub, PrevisaoResp>>, now: number): ChartOption | null {
  if (!br.pld) return null;
  const { ts, values } = hourly(br, range, now);
  if (ts.length < 2) return null;
  const lastObs = ts[ts.length - 1];
  const forecastSeries: Record<string, unknown>[] = [];
  let end = lastObs;
  if (mode === "prev") {
    for (const s of SUBS) {
      const f = fc[s];
      if (!f) continue;
      const h = f.horizon;
      const pts = h.ts.map((t, i) => [t, (h.point ?? h.lear)[i]] as [number, number]).filter(([t]) => t > lastObs);
      if (!pts.length) continue;
      end = Math.max(end, pts[pts.length - 1][0]);
      forecastSeries.push(line(`${s} previsão`, pts, SUB_COLOR[s], { lineStyle: { width: 1.5, color: SUB_COLOR[s], type: [5, 4] }, z: 1 }));
      if (s === "SE") {
        const keep = h.ts.map((t, i) => [t, i] as const).filter(([t]) => t > lastObs).map(([, i]) => i);
        forecastSeries.push(...band("SE P05–P95", keep.map((i) => h.ts[i]), keep.map((i) => h.mc.p05[i]), keep.map((i) => h.mc.p95[i]), SUB_COLOR.SE, 0.1, "fcb"));
      }
    }
  }
  // janelas de ponta (18–21h BRT) em cada dia visível
  const days = [...new Set(ts.map(brtDate))];
  if (end > lastObs) for (let d = addDays(days[days.length - 1], 1); Date.parse(`${d}T00:00:00-03:00`) < end; d = addDays(d, 1)) days.push(d);
  const peaks = days.map((d) => [{ xAxis: Date.parse(`${d}T18:00:00-03:00`) }, { xAxis: Date.parse(`${d}T21:00:00-03:00`) }]);
  // o preço atual de cada submercado já está nos cartões acima; no gráfico fica só a marca de "agora"
  const nowMark = {
    symbol: "none",
    silent: true,
    data: [{ xAxis: now, lineStyle: { color: C.muted, type: "solid", width: 1, opacity: 0.6 }, label: { position: "end", formatter: "agora", color: C.muted, fontSize: 11 } }],
  };
  const base = baseOption();
  return {
    ...base,
    grid: { left: 8, right: 24, top: 46, bottom: 8, containLabel: true },
    // legenda curta (SE, S, NE, N); o nome completo aparece no tooltip
    legend: { ...base.legend, data: SUBS.map((s) => `${s} · ${SUB_NAMES[s]}`), formatter: (name: string) => name.split(" · ")[0] },
    tooltip: {
      ...base.tooltip,
      formatter: (params: { seriesName: string; value: [number, number | null]; color: string }[]) => {
        const ps = (Array.isArray(params) ? params : [params]).filter((p) => !p.seriesName.includes("P05") && p.value?.[1] != null);
        if (!ps.length) return "";
        const t = ps[0].value[0];
        const h = brtHour(t);
        const se = ps.find((p) => p.seriesName.startsWith("SE"))?.value[1] ?? null;
        const rows = ps
          .map((p) => {
            const v = p.value[1] as number;
            const diff = se !== null && !p.seriesName.startsWith("SE") ? `<span style="color:${C.muted};margin-left:6px">${v - se >= 0 ? "+" : ""}${n2.format(v - se)}</span>` : "";
            return `<div style="display:flex;justify-content:space-between;gap:16px;line-height:1.6"><span><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${p.color};margin-right:7px"></span>${p.seriesName}</span><span style="font-variant-numeric:tabular-nums;font-weight:600">${n2.format(v)}${diff}</span></div>`;
          })
          .join("");
        return `<div style="font-size:12px;color:${C.muted};margin-bottom:4px">${tooltipTime(t)}${h >= 18 && h < 21 ? ` · <span style="color:${C.warning}">ponta</span>` : ""}${t > lastObs ? ` · <span style="color:${C.accent}">previsão</span>` : ""}</div>${rows}`;
      },
    },
    xAxis: timeAxis({ max: end }),
    yAxis: valueAxis("R$/MWh"),
    dataZoom: [{ type: "inside", filterMode: "none", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false }],
    series: [
      ...SUBS.map((s, k) =>
        line(`${s} · ${SUB_NAMES[s]}`, ts.map((t, i) => [t, values[s][i]]), SUB_COLOR[s], {
          z: 10 - k,
          lineStyle: { width: 1.6, color: SUB_COLOR[s] },
          markLine: k === 0 ? nowMark : undefined,
          markArea: k === 0 ? { silent: true, itemStyle: { color: C.peakSoft }, data: peaks } : undefined,
        }),
      ),
      ...forecastSeries,
    ],
  };
}

/* ======================================================= oportunidades */

const KIND_TONE: Record<Opportunity["kind"], string> = {
  bess: "text-accent bg-accent/12",
  peak: "text-serious bg-serious/12",
  shift: "text-accent-2 bg-accent-2/12",
  floor: "text-good bg-good/12",
  spread: "text-ink-2 bg-surface-2",
  intl: "text-[var(--sub-n)] bg-[var(--sub-n)]/12",
};
const KIND_LABEL: Record<Opportunity["kind"], string> = { bess: "Bateria", peak: "Ponta", shift: "Deslocar", floor: "Armazenar", spread: "Spread", intl: "Exterior" };

/** Verde cobre o custo nivelado do ativo; amarelo não cobre; vermelho é margem negativa. */
function marginTone(r: Opportunity) {
  const vsCost = r.margin !== null && r.costPerMWDay !== null ? r.margin - r.costPerMWDay : null;
  return r.margin === null ? "text-muted" : r.margin <= 0 ? "text-critical" : vsCost !== null && vsCost < 0 ? "text-warning" : "text-good";
}

function Market({ market }: { market: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      {market.split("/").map((m, j) => (
        <span key={m} className="inline-flex items-center gap-1.5">
          {j ? <span className="px-1 text-muted">/</span> : null}
          {SUB_CSS[m] ? <span className="inline-block h-2 w-2 rounded-full" style={{ background: SUB_CSS[m] }} aria-hidden /> : null}
          <span className="text-ink-2">{m}</span>
        </span>
      ))}
    </span>
  );
}

/** No celular: lista no estilo iOS, a linha inteira é tocável e leva à página da estratégia. */
function OpportunityList({ rows }: { rows: Opportunity[] }) {
  return (
    <div className="sm:hidden">
      <div className="flex justify-between px-3 pb-1 text-[12px] text-muted">
        <span>Estratégia</span>
        <span>Margem R$/MW·dia</span>
      </div>
      <ul className="flex flex-col" aria-label="Oportunidades">
        {rows.map((r) => {
          const conf = r.confidence === null || !Number.isFinite(r.confidence) ? null : Math.round(100 * Math.min(1, Math.max(0, r.confidence)));
          return (
            <li key={r.id} className="border-b border-line last:border-0">
              <Link href={r.action.href} title={r.action.label} className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors active:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${KIND_TONE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                    <span className="truncate text-[15px] text-ink">{r.strategy}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
                    <Market market={r.market} />
                    {r.spread !== null ? <span className="tnum">· spread {n2.format(r.spread)} R$/MWh</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`tnum block text-[15px] font-semibold ${marginTone(r)}`}>{r.margin === null ? "indicador" : n0.format(r.margin)}</span>
                  {conf !== null ? <span className="tnum block text-[12px] text-muted" title={r.confidenceNote}>conf. {conf}%</span> : null}
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OpportunitiesTable({ rows }: { rows: Opportunity[] }) {
  if (!rows.length) return <Empty label="Sem oportunidades calculáveis agora (sem dia completo de PLD)." height={120} />;
  return (
    <>
      <OpportunityList rows={rows} />
      <div className="hidden sm:block">
        <OpportunityTable rows={rows} />
      </div>
    </>
  );
}

function OpportunityTable({ rows }: { rows: Opportunity[] }) {
  return (
    <ScrollX label="Oportunidades">
      <table className="w-full min-w-[720px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-line">
            {["Estratégia", "Mercado", "Spread", "Margem", "Confiança", ""].map((h, i) => (
              <th key={i} className={`whitespace-nowrap px-3 py-2 text-[12px] font-medium text-muted ${i === 2 || i === 3 ? "text-right" : "text-left"}`}>
                {h || <span className="sr-only">Abrir</span>}
                {h === "Spread" ? <span className="ml-1 font-normal">R$/MWh</span> : h === "Margem" ? <span className="ml-1 font-normal">R$/MW·dia</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => {
            const tone = marginTone(r);
            return (
              <motion.tr
                key={r.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE, delay: i * 0.02 }}
                className="border-b border-line last:border-0 hover:bg-surface-2/60"
                title={[r.detail, r.liquidity ? `liquidez: ${r.liquidity}` : null, r.mw !== null ? `${n0.format(r.mw)} MW` : null].filter(Boolean).join(" · ")}
              >
                <td className="px-3 py-2.5">
                  <span className={`mr-2.5 inline-block min-w-[76px] rounded-full px-2 py-0.5 text-center text-[12px] font-medium ${KIND_TONE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                  <span className="text-ink">{r.strategy}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <Market market={r.market} />
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">{r.spread === null ? "—" : n2.format(r.spread)}</td>
                <td className={`px-3 py-2.5 text-right font-semibold ${tone}`} title={r.costPerMWDay !== null ? `custo nivelado do ativo ≈ ${n0.format(r.costPerMWDay)} R$/MW·dia` : undefined}>
                  {r.margin === null ? "indicador" : n0.format(r.margin)}
                </td>
                <td className="px-3 py-2.5">
                  <ConfidenceBar value={r.confidence} title={r.confidenceNote} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <Link href={r.action.href} aria-label={r.action.label} title={r.action.label} className="inline-grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-accent sm:h-8 sm:w-8">
                    <ChevronRight size={18} aria-hidden />
                  </Link>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );
}

/* ====================================================== indicadores do sistema */

/** Os indicadores de contexto num só cartão, sem caixas internas. */
export function SystemStats({ items }: { items: KpiSpec[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.key} className="min-w-0" title={[k.source, k.detail].filter(Boolean).join(" · ") || undefined}>
          <div className="truncate text-[13px] text-muted">{k.label}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1">
            <span className="tnum text-[20px] font-semibold tracking-[-0.01em] text-ink">{k.value === null ? "—" : k.format(k.value)}</span>
            {k.unit ? <span className="text-[12px] text-muted">{k.unit}</span> : null}
          </div>
          {k.delta !== undefined ? (
            <div className="text-[13px]">
              <Delta value={k.delta} suffix={k.deltaSuffix} title={k.deltaTitle} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ========================================================= resumo do dia */

export function DaySummary({ br, fc, audit, alerts, now: nowTs }: { br?: BrasilResp; fc?: PrevisaoResp; audit?: AuditoriaLite; alerts?: AlertasResp; now: number }) {
  const items = useMemo(() => {
    const out: { Icon: typeof Zap; tone: string; text: React.ReactNode }[] = [];
    if (!br?.kpis || !br.pld || !nowTs) return out;
    // alertas de mercado ativos primeiro: é o que pede ação
    for (const a of alerts?.alerts ?? []) out.push({ Icon: TriangleAlert, tone: "text-serious", text: <b className="text-ink">{a.title}</b> });
    const today = brtDate(nowTs);
    const se = br.kpis.find((k) => k.sub === "SE");
    const agg = br.aggregates;
    const yIdx = agg ? agg.dates.indexOf(addDays(today, -1)) : -1;
    const ySE = yIdx >= 0 ? agg!.daily.SE[yIdx] : null;
    if (se?.todayAvg != null) {
      const idx = br.pld.ts.map((t, i) => [t, i] as const).filter(([t]) => brtDate(t) === today);
      const peak = idx.reduce((best, [t, i]) => ((br.pld!.values.SE[i] ?? -Infinity) > best.v ? { v: br.pld!.values.SE[i]!, t } : best), { v: -Infinity, t: 0 });
      out.push({
        Icon: Zap,
        tone: "text-accent",
        text: (
          <>
            PLD SE hoje, média <b className="text-ink">{brl(se.todayAvg)}</b>
            {ySE ? <> ({se.todayAvg >= ySE ? "+" : "−"}{n1.format(Math.abs((100 * (se.todayAvg - ySE)) / ySE))}% vs. ontem)</> : null}
            {Number.isFinite(peak.v) ? (Math.abs(peak.v - se.todayAvg) < 0.01 ? <>; estável o dia todo{Math.abs(peak.v - br.limits.min) < 0.01 ? " no piso regulatório" : ""}</> : <>; pico {brl(peak.v)} às {brtHour(peak.t)}h</>) : null}.
          </>
        ),
      });
    }
    const now = br.kpis.filter((k) => k.now !== null).sort((a, b) => b.now! - a.now!);
    if (now.length >= 2) {
      const hi = now[0], lo = now[now.length - 1];
      out.push({
        Icon: TrendingUp,
        tone: "text-warning",
        text: (
          <>
            Agora: maior preço no <b className="text-ink">{SUB_NAMES[hi.sub]}</b> ({brl(hi.now)}), menor no {SUB_NAMES[lo.sub]} ({brl(lo.now)}) — spread de {brl(hi.now! - lo.now!)}.
          </>
        ),
      });
    }
    if (se?.tomorrowAvg != null) {
      out.push({ Icon: CircleCheck, tone: "text-good", text: <>PLD de amanhã {br.meta.pld.fallback ? "estimado pelo DESSEM (ONS)" : "publicado"}: média SE <b className="text-ink">{brl(se.tomorrowAvg)}</b>{se.todayAvg ? ` (${se.tomorrowAvg >= se.todayAvg ? "+" : "−"}${n1.format(Math.abs((100 * (se.tomorrowAvg - se.todayAvg)) / se.todayAvg))}% vs. hoje)` : ""}.</> });
    } else {
      out.push({ Icon: TriangleAlert, tone: "text-muted", text: <>PLD de amanhã ainda não disponível (a CCEE publica na véspera, no fim da tarde).</> });
    }
    if (fc?.horizon.dailyMean.length) {
      const d = fc.horizon.dailyMean;
      const avg = d.reduce((a, x) => a + (x.point ?? x.lear), 0) / d.length;
      out.push({ Icon: TrendingUp, tone: "text-accent-2", text: <>Previsão SE 7 dias: média <b className="text-ink">{brl(avg)}</b>, faixa diária de {brl(Math.min(...d.map((x) => x.p05)))} a {brl(Math.max(...d.map((x) => x.p95)))} (90%).</> });
    }
    const ear = br.ear?.values.SE.filter((v): v is number => v !== null) ?? [];
    if (ear.length > 8) {
      const dv = ear[ear.length - 1] - ear[ear.length - 8];
      out.push({ Icon: Droplets, tone: "text-accent", text: <>Reservatórios SE/CO em <b className="text-ink">{pct(ear[ear.length - 1])}</b> ({dv >= 0 ? "+" : "−"}{n1.format(Math.abs(dv))} p.p. em 7 dias).</> });
    }
    const run = audit?.latest;
    if (run) {
      const bad = run.attention;
      out.push({ Icon: ShieldCheck, tone: run.overallScore >= 70 ? "text-good" : "text-warning", text: <>APIs: score <b className="text-ink">{run.overallScore}/100</b>{bad.length ? ` · atenção: ${bad.slice(0, 3).join(", ")}` : " · todas as fontes OK"}.</> });
    }
    return out;
  }, [br, fc, audit, alerts, nowTs]);
  if (!items.length) return <Empty label="Aguardando dados do PLD…" height={160} />;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <Appear as="li" key={i} delay={i * 0.04} className="flex gap-3 text-[14px] leading-snug text-ink-2">
          <it.Icon size={17} className={`mt-px shrink-0 ${it.tone}`} aria-hidden />
          <span>{it.text}</span>
        </Appear>
      ))}
    </ul>
  );
}

/* ================================================== SIN · fluxo (esquema) */

export function SinFlow({ br, now }: { br?: BrasilResp; now: number }) {
  const price = Object.fromEntries(SUBS.map((s) => [s, br?.kpis?.find((k) => k.sub === s)?.now ?? null])) as Record<Sub, number | null>;
  const load = br?.load;
  const loadNow = Object.fromEntries(
    SUBS.map((s) => {
      if (!load) return [s, null];
      const i = lastAtOrBefore(load.ts, load.values[s], now);
      return [s, i >= 0 ? load.values[s][i] : null];
    }),
  ) as Record<Sub, number | null>;
  const earNow = Object.fromEntries(SUBS.map((s) => [s, br?.ear?.values[s].filter((v): v is number => v !== null).slice(-1)[0] ?? null])) as Record<Sub, number | null>;
  const pos: Record<Sub, [number, number]> = { N: [70, 34], NE: [262, 34], SE: [166, 112], S: [166, 186] };
  const links: [Sub, Sub][] = [["N", "NE"], ["N", "SE"], ["NE", "SE"], ["SE", "S"]];
  return (
    <div>
      <svg viewBox="0 0 332 216" className="h-auto w-full" role="img" aria-label="Esquema dos submercados com preço, carga e reservatório">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" style={{ fill: "var(--muted)" }} />
          </marker>
        </defs>
        {links.map(([a, b]) => {
          const pa = price[a], pb = price[b];
          const d = pa !== null && pb !== null ? pb - pa : null;
          const coupled = d === null || Math.abs(d) < 0.5;
          const [x1, y1] = pos[a], [x2, y2] = pos[b];
          const [from, to] = coupled || d! > 0 ? [[x1, y1], [x2, y2]] : [[x2, y2], [x1, y1]];
          const shorten = (p: number[], q: number[], k: number) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
          const s1 = shorten(from, to, 0.28), s2 = shorten(from, to, 0.72);
          const mid = shorten(from, to, 0.5);
          return (
            <g key={`${a}${b}`}>
              <line x1={s1[0]} y1={s1[1]} x2={s2[0]} y2={s2[1]} style={{ stroke: coupled ? "var(--border-strong)" : "var(--muted)" }} strokeWidth={1.2} strokeDasharray={coupled ? "3 3" : undefined} markerEnd={coupled ? undefined : "url(#arr)"} />
              <text x={mid[0] + 6} y={mid[1] - 4} fontSize="9" style={{ fill: coupled ? "var(--muted)" : "var(--ink-2)" }} className="tnum">
                {d === null ? "" : coupled ? "acoplado" : `Δ ${n0.format(Math.abs(d))}`}
              </text>
            </g>
          );
        })}
        {SUBS.map((s) => {
          const [x, y] = pos[s];
          return (
            <g key={s} transform={`translate(${x - 52},${y - 20})`}>
              <rect width="104" height="40" rx="10" style={{ fill: "var(--surface-2)" }} />
              <circle cx="11" cy="11" r="3" style={{ fill: SUB_CSS[s] }} />
              <text x="18" y="14" fontSize="9" style={{ fill: "var(--muted)" }} fontWeight="500">{s === "SE" ? "SE/CO" : SUB_NAMES[s]}</text>
              <text x="8" y="31" fontSize="12.5" style={{ fill: "var(--ink)" }} fontWeight="600" className="tnum">{price[s] === null ? "—" : n2.format(price[s]!)}</text>
              <text x="98" y="14" fontSize="9" style={{ fill: "var(--muted)" }} textAnchor="end" className="tnum">{loadNow[s] === null ? "" : `${n1.format(loadNow[s]! / 1000)} GW`}</text>
              <text x="98" y="31" fontSize="9" style={{ fill: "var(--muted)" }} textAnchor="end" className="tnum">{earNow[s] === null ? "" : `${n0.format(earNow[s]!)}% EAR`}</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[12px] leading-snug text-muted">A seta vai do submercado mais barato para o mais caro; “acoplado” quando os PLDs coincidem.</p>
    </div>
  );
}

/* ======================================================== curva do dia */

/* ======================================================= BESS (mini) */

export function BessMini({ bess, asset, loading, error }: { bess?: BessResp; asset: BessAsset; loading?: boolean; error?: unknown }) {
  // dia publicado sem operação (PLD plano) ⇒ mostra o dia mediano da janela, rotulado
  const auto = bess?.refDay ?? null;
  const idle = auto ? auto.chargeMW.every((v) => v < 1e-6) && auto.dischargeMW.every((v) => v < 1e-6) : false;
  const r0 = idle ? (bess?.refDays?.median ?? auto) : auto;
  const opt = useMemo<ChartOption | null>(() => {
    const r = r0;
    if (!r) return null;
    const base = baseOption();
    return {
      ...base,
      grid: { left: 4, right: 4, top: 8, bottom: 4, containLabel: true },
      legend: { show: false },
      tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1, type: [3, 3] } } },
      xAxis: categoryAxis(r.ts.map((t) => `${brtHour(t)}h`), { axisLabel: { color: C.muted, fontSize: 9, interval: 5 } }),
      yAxis: [valueAxis(undefined, { splitNumber: 2, axisLabel: { show: false } }), valueAxis(undefined, { splitNumber: 2, splitLine: { show: false }, axisLabel: { show: false } })],
      series: [
        { name: "Descarga (MW)", type: "bar", stack: "p", data: r.dischargeMW.map((v) => +v.toFixed(1)), itemStyle: { color: C.good, borderRadius: [3, 3, 0, 0] }, barWidth: "60%" },
        { name: "Carga (MW)", type: "bar", stack: "p", data: r.chargeMW.map((v) => -+v.toFixed(1)), itemStyle: { color: C.accent, borderRadius: [0, 0, 3, 3] } },
        { name: "PLD (R$/MWh)", type: "line", yAxisIndex: 1, data: r.price.map((v) => +v.toFixed(2)), showSymbol: false, lineStyle: { width: 1.2, color: C.ink2 }, itemStyle: { color: C.ink2 } },
      ],
    };
  }, [r0]);
  return (
    <div className="flex flex-col gap-2">
      <ChartFrame option={opt} loading={loading} error={error} height={120} label="Despacho do BESS no dia de referência" />
      {bess ? (
        <div className="grid grid-cols-1">
          <MetricRow label="Receita média" hint="30 d" value={`${brl(bess.last30.revenuePerDay, 0)}/dia`} />
          <MetricRow label="Ciclos" value={`${n2.format(bess.last30.cyclesPerDay)}/dia`} />
          <MetricRow label="Spread líquido" value={bess.margin.netSpread === null ? "—" : `${n0.format(bess.margin.netSpread)} R$/MWh`} />
          <MetricRow label="vs. custo nivelado" value={bess.margin.netMargin === null ? "—" : `${bess.margin.netMargin >= 0 ? "+" : "−"}${n0.format(Math.abs(bess.margin.netMargin))}`} tone={bess.margin.netMargin !== null && bess.margin.netMargin >= 0 ? "good" : "critical"} />
        </div>
      ) : null}
      <p className="text-[12px] text-muted">
        {asset.pow} MW / {asset.cap} MWh · {asset.sub} · {idle ? "amanhã sem spread, exibindo o dia mediano" : (r0?.label ?? "")}
      </p>
    </div>
  );
}

/* =================================================== previsão de carga */

/* ============================================ reservatórios & afluências */

export function earOption(br: BrasilResp): ChartOption | null {
  const ear = br.ear;
  if (!ear || ear.dates.length < 10) return null;
  const n = Math.min(120, ear.dates.length);
  const ts = ear.dates.slice(-n).map((d) => Date.parse(`${d}T12:00:00-03:00`));
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${n1.format(v)}%`) },
    xAxis: timeAxis(),
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: SUBS.map((s) => line(s, ts.map((t, i) => [t, ear.values[s].slice(-n)[i]]), SUB_COLOR[s], { lineStyle: { width: 1.4, color: SUB_COLOR[s] } })),
  };
}

export function EnaRow({ br }: { br?: BrasilResp }) {
  const ena = br?.ena;
  if (!ena) return null;
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
      {SUBS.map((s) => {
        const v = ena.values[s].filter((x): x is number => x !== null);
        const last = v[v.length - 1];
        return (
          <div key={s} className="rounded-xl bg-surface-2 px-1 py-2" title="Energia natural afluente, % da média de longo termo">
            <div className="text-[12px] text-muted">ENA {s}</div>
            <div className="tnum text-[15px] font-semibold" style={{ color: last >= 100 ? "var(--good)" : last >= 70 ? "var(--ink)" : "var(--warning)" }}>
              {last === undefined ? "—" : `${n0.format(last)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ======================================================== auditor */

/* =================================================== previsão (leque) */

export function fanOption(f: PrevisaoResp): ChartOption {
  const h = f.horizon;
  const hist = f.history;
  const cut = Math.max(0, hist.ts.length - 72);
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, valueFormatter: (v: number) => (v == null ? "—" : brl(v)) },
    legend: { ...base.legend, data: ["Realizado", "Previsão", "P05–P95"] },
    xAxis: timeAxis(),
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: [
      ...band("P05–P95", h.ts, h.mc.p05, h.mc.p95, C.accent, 0.12, "a"),
      line("Realizado", hist.ts.slice(cut).map((t, i) => [t, hist.values[cut + i]]), C.ink2, { lineStyle: { width: 1.3, color: C.ink2 } }),
      line("Previsão", h.ts.map((t, i) => [t, (h.point ?? h.lear)[i]]), C.accent, { lineStyle: { width: 1.6, color: C.accent } }),
    ],
  };
}

export const compactBRL = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `R$ ${compact(v)}`);
export { num };
