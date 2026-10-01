"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useMemo, useSyncExternalStore } from "react";
import { ArrowUpRight, BatteryCharging, CircleCheck, Droplets, Gauge, ShieldCheck, TrendingUp, TriangleAlert, Zap } from "lucide-react";
import type { ChartOption } from "@/components/EChart";
import { ChartFrame } from "@/components/EChart";
import { Appear, EASE } from "@/components/motion";
import { ConfidenceBar, Empty, MetricRow, sourceState, type DataState } from "@/components/ui";
import type { AuditoriaResp, BessResp, BrasilResp, ClimaResp, PrevisaoResp } from "@/lib/apiTypes";
import type { BessAsset } from "@/lib/asset";
import { band, baseOption, C, categoryAxis, line, SUB_COLOR, timeAxis, tooltipTime, valueAxis } from "@/lib/chart";
import { ago, brl, compact, nf, num, pct } from "@/lib/fmt";
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
}

const lastAtOrBefore = (ts: number[], vals: (number | null)[], t: number) => {
  for (let i = ts.length - 1; i >= 0; i--) if (ts[i] <= t && vals[i] !== null) return i;
  return -1;
};

const hh = (t: number | null | undefined) => (t ? `${String(brtHour(t)).padStart(2, "0")}h` : "");

export function buildKpis(br?: BrasilResp, clima?: ClimaResp, audit?: AuditoriaResp, now = Date.now()): KpiSpec[] {
  const out: KpiSpec[] = [];
  const pldState = sourceState(br?.meta.pld, 2 * 3600_000, now);
  const pldSrc = br?.meta.pld.note?.startsWith("PLD oficial") ? "CCEE oficial" : br?.meta.pld.fallback ? "ONS · CMO→PLD" : "CCEE";
  for (const s of SUBS) {
    const k = br?.kpis?.find((x) => x.sub === s);
    out.push({
      key: `pld-${s}`,
      label: `PLD ${s === "SE" ? "SE/CO" : SUB_NAMES[s]}`,
      value: k?.now ?? null,
      format: (v) => n2.format(v),
      unit: "R$/MWh",
      delta: k?.now != null && k?.dayAgo ? (100 * (k.now - k.dayAgo)) / k.dayAgo : null,
      deltaTitle: "vs. mesma hora de ontem",
      spark: k?.spark,
      color: SUB_COLOR[s],
      swatch: SUB_COLOR[s],
      state: pldState,
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
    state: sourceState(br?.meta.load, 6 * 3600_000, now),
    at: li >= 0 ? load!.ts[li] : null,
    source: `ONS · verificada ${li >= 0 ? hh(load!.ts[li]) : "—"}`,
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
  // saúde das APIs (agente auditor)
  const run = audit?.latest;
  const hist = audit?.history ?? [];
  out.push({
    key: "api",
    label: "Saúde das APIs",
    value: run?.overallScore ?? null,
    format: (v) => n0.format(v),
    unit: "/100",
    delta: hist.length >= 2 ? hist[hist.length - 1].overallScore - hist[hist.length - 2].overallScore : null,
    deltaSuffix: " pts",
    deltaTitle: "vs. execução anterior",
    spark: hist.slice(-30).map((h) => h.overallScore),
    color: C.good,
    state: run ? (now - run.startedAt > 25 * 3600_000 ? "STALE" : run.overallScore >= 70 ? "LIVE" : "FALLBACK") : null,
    at: run?.startedAt,
    source: run ? `${run.counts.ok} ok · ${run.counts.degraded} degr. · ${run.counts.down} fora · ${ago(run.startedAt)}` : "sem auditoria",
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
  const current = Object.fromEntries(SUBS.map((s) => [s, br.kpis?.find((k) => k.sub === s)?.now ?? null])) as Record<Sub, number | null>;
  const base = baseOption();
  return {
    ...base,
    grid: { left: 8, right: 64, top: 46, bottom: 34, containLabel: true },
    legend: { ...base.legend, data: SUBS.map((s) => `${s} · ${SUB_NAMES[s]}`) },
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
            return `<div style="display:flex;justify-content:space-between;gap:14px"><span><span style="display:inline-block;width:8px;height:2px;background:${p.color};margin-right:6px;vertical-align:middle"></span>${p.seriesName}</span><span style="font-variant-numeric:tabular-nums">${n2.format(v)}${diff}</span></div>`;
          })
          .join("");
        return `<div style="font-size:11px;color:${C.muted};margin-bottom:3px">${tooltipTime(t)}${h >= 18 && h < 21 ? ` · <span style="color:${C.warning}">ponta</span>` : ""}${t > lastObs ? ` · <span style="color:${C.accent}">previsão</span>` : ""}</div>${rows}`;
      },
    },
    xAxis: timeAxis({ max: end }),
    yAxis: valueAxis("R$/MWh"),
    dataZoom: [
      { type: "inside", filterMode: "none" },
      { type: "slider", height: 14, bottom: 4, borderColor: "transparent", backgroundColor: C.surface2, fillerColor: "rgba(59,158,255,0.12)", handleSize: 12, handleStyle: { color: C.axis, borderColor: C.muted }, textStyle: { color: C.muted, fontSize: 9 }, labelFormatter: () => "", dataBackground: { lineStyle: { color: C.axis }, areaStyle: { color: C.surface2 } }, moveHandleSize: 4 },
    ],
    series: [
      ...SUBS.map((s, k) =>
        line(`${s} · ${SUB_NAMES[s]}`, ts.map((t, i) => [t, values[s][i]]), SUB_COLOR[s], {
          z: 10 - k,
          lineStyle: { width: 1.6, color: SUB_COLOR[s] },
          markLine:
            current[s] !== null
              ? {
                  symbol: "none",
                  silent: true,
                  lineStyle: { color: SUB_COLOR[s], width: 1, type: [2, 3], opacity: 0.6 },
                  label: { position: "end", formatter: `${s} ${n2.format(current[s]!)}`, color: "#04111f", backgroundColor: SUB_COLOR[s], padding: [1, 4], borderRadius: 2, fontSize: 10 },
                  data: [{ yAxis: current[s]! }, ...(k === 0 ? [{ xAxis: now, lineStyle: { color: C.muted, type: "solid", opacity: 0.8 }, label: { position: "end", formatter: "agora", color: C.muted, backgroundColor: "transparent", fontSize: 10 } }] : [])],
                }
              : undefined,
          markArea: k === 0 ? { silent: true, itemStyle: { color: "rgba(242,182,58,0.045)" }, data: peaks } : undefined,
        }),
      ),
      ...forecastSeries,
    ],
  };
}

/* ======================================================= oportunidades */

const KIND_TONE: Record<Opportunity["kind"], string> = {
  bess: "text-accent border-accent/35",
  peak: "text-warning border-warning/35",
  shift: "text-accent-2 border-accent-2/35",
  floor: "text-good border-good/35",
  spread: "text-ink-2 border-line-strong",
  intl: "text-[#9085e9] border-[#9085e9]/40",
};
const KIND_LABEL: Record<Opportunity["kind"], string> = { bess: "BESS", peak: "PEAK", shift: "SHIFT", floor: "STORE", spread: "SPREAD", intl: "INTL" };

export function OpportunitiesTable({ rows }: { rows: Opportunity[] }) {
  if (!rows.length) return <Empty label="Sem oportunidades calculáveis agora (sem dia completo de PLD)." height={120} />;
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line-strong">
            {["#", "Estratégia", "Mercado", "Spread", "Margem", "MW", "Liquidez", "Confiança", "Ação"].map((h, i) => (
              <th key={h} className={`eyebrow whitespace-nowrap px-2 py-1.5 font-semibold ${i >= 3 && i <= 5 ? "text-right" : "text-left"}`}>
                {h}
                {h === "Spread" ? <span className="ml-1 normal-case tracking-normal text-muted">R$/MWh</span> : h === "Margem" ? <span className="ml-1 normal-case tracking-normal text-muted">R$/MW·dia</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => {
            const vsCost = r.margin !== null && r.costPerMWDay !== null ? r.margin - r.costPerMWDay : null;
            const tone = r.margin === null ? "text-muted" : r.margin <= 0 ? "text-critical" : vsCost !== null && vsCost < 0 ? "text-warning" : "text-good";
            return (
              <motion.tr
                key={r.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE, delay: i * 0.02 }}
                className="group border-b border-line/60 last:border-0 hover:bg-surface-2"
              >
                <td className="px-2 py-1.5 font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</td>
                <td className="px-2 py-1.5" title={r.detail}>
                  <span className={`mr-2 inline-block w-[52px] rounded-[3px] border px-1 text-center font-mono text-[9.5px] font-semibold tracking-wider ${KIND_TONE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                  <span className="text-ink">{r.strategy}</span>
                  <span className="ml-2 hidden text-[11px] text-muted 2xl:inline">{r.detail}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {r.market.split("/").map((m, j) => (
                    <span key={m} className="inline-flex items-center gap-1">
                      {j ? <span className="px-0.5 text-muted">/</span> : null}
                      {SUB_COLOR[m] ? <span className="inline-block h-1.5 w-1.5 rounded-[1px]" style={{ background: SUB_COLOR[m] }} aria-hidden /> : null}
                      <span className="font-mono text-ink-2">{m}</span>
                    </span>
                  ))}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-2">{r.spread === null ? "—" : n2.format(r.spread)}</td>
                <td className={`px-2 py-1.5 text-right font-mono font-semibold ${tone}`} title={r.costPerMWDay !== null ? `custo nivelado do ativo ≈ ${n0.format(r.costPerMWDay)} R$/MW·dia` : undefined}>
                  {r.margin === null ? "indicador" : n0.format(r.margin)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-2">{r.mw === null ? "—" : n0.format(r.mw)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-muted">{r.liquidity}</td>
                <td className="px-2 py-1.5">
                  <ConfidenceBar value={r.confidence} title={r.confidenceNote} />
                </td>
                <td className="px-2 py-1.5">
                  <Link href={r.action.href} className="inline-flex items-center gap-0.5 rounded-[4px] border border-line px-1.5 py-0.5 text-[11px] text-ink-2 transition-colors hover:border-accent/50 hover:text-accent">
                    {r.action.label}
                    <ArrowUpRight size={11} aria-hidden />
                  </Link>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================= resumo do dia */

export function DaySummary({ br, fc, audit, now: nowTs }: { br?: BrasilResp; fc?: PrevisaoResp; audit?: AuditoriaResp; now: number }) {
  const items = useMemo(() => {
    const out: { Icon: typeof Zap; tone: string; text: React.ReactNode }[] = [];
    if (!br?.kpis || !br.pld || !nowTs) return out;
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
            {Number.isFinite(peak.v) ? <>; pico {brl(peak.v)} às {brtHour(peak.t)}h</> : null}.
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
      out.push({ Icon: CircleCheck, tone: "text-good", text: <>PLD de amanhã publicado: média SE <b className="text-ink">{brl(se.tomorrowAvg)}</b>{se.todayAvg ? ` (${se.tomorrowAvg >= se.todayAvg ? "+" : "−"}${n1.format(Math.abs((100 * (se.tomorrowAvg - se.todayAvg)) / se.todayAvg))}% vs. hoje)` : ""}.</> });
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
      const bad = run.sources.filter((s) => s.status === "down" || s.status === "degraded");
      out.push({ Icon: ShieldCheck, tone: run.overallScore >= 70 ? "text-good" : "text-warning", text: <>APIs: score <b className="text-ink">{run.overallScore}/100</b>{bad.length ? ` · atenção: ${bad.map((s) => s.name).slice(0, 3).join(", ")}` : " · todas as fontes OK"}.</> });
    }
    return out;
  }, [br, fc, audit, nowTs]);
  if (!items.length) return <Empty label="Aguardando dados do PLD…" height={160} />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it, i) => (
        <Appear as="li" key={i} delay={i * 0.04} className="flex gap-2 text-[12px] leading-snug text-ink-2">
          <it.Icon size={13} className={`mt-0.5 shrink-0 ${it.tone}`} aria-hidden />
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
            <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
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
              <line x1={s1[0]} y1={s1[1]} x2={s2[0]} y2={s2[1]} stroke={coupled ? "var(--border-strong)" : "var(--muted)"} strokeWidth={1.2} strokeDasharray={coupled ? "3 3" : undefined} markerEnd={coupled ? undefined : "url(#arr)"} />
              <text x={mid[0] + 6} y={mid[1] - 4} fontSize="9" fill={coupled ? "var(--muted)" : "var(--ink-2)"} className="tnum">
                {d === null ? "" : coupled ? "acoplado" : `Δ ${n0.format(Math.abs(d))}`}
              </text>
            </g>
          );
        })}
        {SUBS.map((s) => {
          const [x, y] = pos[s];
          return (
            <g key={s} transform={`translate(${x - 52},${y - 20})`}>
              <rect width="104" height="40" rx="4" fill="var(--surface-2)" stroke="var(--border-strong)" />
              <rect width="3" height="40" rx="1.5" fill={SUB_COLOR[s]} />
              <text x="9" y="13" fontSize="9" fill="var(--muted)" fontWeight="600" letterSpacing="0.06em">{s === "SE" ? "SE/CO" : SUB_NAMES[s].toUpperCase()}</text>
              <text x="9" y="28" fontSize="12" fill="var(--ink)" fontWeight="600" className="tnum">{price[s] === null ? "—" : n2.format(price[s]!)}</text>
              <text x="98" y="13" fontSize="8.5" fill="var(--muted)" textAnchor="end" className="tnum">{loadNow[s] === null ? "" : `${n1.format(loadNow[s]! / 1000)} GW`}</text>
              <text x="98" y="28" fontSize="8.5" fill="var(--muted)" textAnchor="end" className="tnum">{earNow[s] === null ? "" : `${n0.format(earNow[s]!)}% EAR`}</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[10.5px] leading-snug text-muted">Seta = sentido sugerido pelo preço (do mais barato para o mais caro); “acoplado” quando os PLDs coincidem. O ONS não publica o intercâmbio em tempo real aqui.</p>
    </div>
  );
}

/* ======================================================== curva do dia */

export function priceCurveOption(br: BrasilResp, now: number): ChartOption | null {
  if (!br.pld) return null;
  const today = brtDate(now);
  const tomorrow = addDays(today, 1);
  const pick = (date: string, s: Sub) => {
    const row = new Array<number | null>(24).fill(null);
    br.pld!.ts.forEach((t, i) => {
      if (brtDate(t) === date) row[brtHour(t)] = br.pld!.values[s][i];
    });
    return row;
  };
  const hasTomorrow = br.pld.ts.some((t) => brtDate(t) === tomorrow);
  const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 8, bottom: 4, containLabel: true },
    legend: { show: false },
    tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1, type: [3, 3] } }, valueFormatter: (v: number) => (v == null ? "—" : brl(v)) },
    xAxis: categoryAxis(hours, { axisLabel: { color: C.muted, fontSize: 9, interval: 3 } }),
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: SUBS.flatMap((s) => [
      { name: `${s} hoje`, type: "line", data: pick(today, s), showSymbol: false, lineStyle: { width: 1.5, color: SUB_COLOR[s] }, itemStyle: { color: SUB_COLOR[s] } },
      ...(hasTomorrow ? [{ name: `${s} amanhã`, type: "line", data: pick(tomorrow, s), showSymbol: false, lineStyle: { width: 1.2, color: SUB_COLOR[s], type: [4, 3] }, itemStyle: { color: SUB_COLOR[s] } }] : []),
    ]),
  };
}

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
        { name: "Descarga (MW)", type: "bar", stack: "p", data: r.dischargeMW.map((v) => +v.toFixed(1)), itemStyle: { color: C.good }, barWidth: "60%" },
        { name: "Carga (MW)", type: "bar", stack: "p", data: r.chargeMW.map((v) => -+v.toFixed(1)), itemStyle: { color: C.accent } },
        { name: "PLD (R$/MWh)", type: "line", yAxisIndex: 1, data: r.price.map((v) => +v.toFixed(2)), showSymbol: false, lineStyle: { width: 1.2, color: C.ink2 }, itemStyle: { color: C.ink2 } },
      ],
    };
  }, [r0]);
  return (
    <div className="flex flex-col gap-2">
      <ChartFrame option={opt} loading={loading} error={error} height={110} label="Despacho do BESS no dia de referência" />
      {bess ? (
        <div className="grid grid-cols-1">
          <MetricRow label="Receita média" hint="30 d" value={`${brl(bess.last30.revenuePerDay, 0)}/dia`} />
          <MetricRow label="Ciclos" value={`${n2.format(bess.last30.cyclesPerDay)}/dia`} />
          <MetricRow label="Spread líquido" value={bess.margin.netSpread === null ? "—" : `${n0.format(bess.margin.netSpread)} R$/MWh`} />
          <MetricRow label="vs. custo nivelado" value={bess.margin.netMargin === null ? "—" : `${bess.margin.netMargin >= 0 ? "+" : "−"}${n0.format(Math.abs(bess.margin.netMargin))}`} tone={bess.margin.netMargin !== null && bess.margin.netMargin >= 0 ? "good" : "critical"} />
        </div>
      ) : null}
      <div className="flex items-center justify-between text-[10.5px] text-muted">
        <span>
          {asset.name} · {asset.pow} MW / {asset.cap} MWh · {asset.sub} · {idle ? "amanhã sem spread — exibindo o dia mediano" : (r0?.label ?? "")}
        </span>
        <Link href="/bess" className="text-accent hover:underline">
          abrir BESS →
        </Link>
      </div>
    </div>
  );
}

/* =================================================== previsão de carga */

export function loadOption(br: BrasilResp): ChartOption | null {
  const load = br.load;
  if (!load || load.ts.length < 48) return null;
  const sin = load.ts.map((_, i) => (SUBS.every((s) => load.values[s][i] !== null) ? SUBS.reduce((a, s) => a + (load.values[s][i] as number), 0) / 1000 : null));
  const byTs = new Map(load.ts.map((t, i) => [t, sin[i]]));
  let last = load.ts.length - 1;
  while (last > 0 && sin[last] === null) last--;
  const t0 = load.ts[last];
  // previsão ingênua semanal: mesma hora 7 dias antes (ou 24 h, se faltar)
  const fcst: [number, number | null][] = [];
  for (let k = 1; k <= 24; k++) {
    const t = t0 + k * 3600_000;
    fcst.push([t, byTs.get(t - 7 * 86400_000) ?? byTs.get(t - 86400_000) ?? null]);
  }
  const from = t0 - 72 * 3600_000;
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${n1.format(v)} GW`) },
    xAxis: timeAxis(),
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: [
      line("Verificada (ONS)", load.ts.map((t, i) => [t, sin[i]] as [number, number | null]).filter(([t]) => t >= from), C.series[6], { lineStyle: { width: 1.5, color: C.series[6] } }),
      line("Previsão ingênua (D−7)", [[t0, sin[last]], ...fcst], C.series[6], { lineStyle: { width: 1.2, color: C.series[6], type: [4, 3] } }),
    ],
  };
}

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
    <div className="mt-2 grid grid-cols-4 gap-1 text-center">
      {SUBS.map((s) => {
        const v = ena.values[s].filter((x): x is number => x !== null);
        const last = v[v.length - 1];
        return (
          <div key={s} className="rounded-[4px] border border-line px-1 py-1">
            <div className="text-[9.5px] text-muted">ENA {s}</div>
            <div className="tnum text-[12px] font-semibold" style={{ color: last >= 100 ? "var(--good)" : last >= 70 ? "var(--ink)" : "var(--warning)" }}>
              {last === undefined ? "—" : `${n0.format(last)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================ ativos & estratégias */

const CKEY = "sinos.carteira.v1";
const subscribeStorage = (cb: () => void) => {
  const on = (e: StorageEvent) => e.key === CKEY && cb();
  window.addEventListener("storage", on);
  return () => window.removeEventListener("storage", on);
};
const readContracts = () => {
  try {
    return localStorage.getItem(CKEY) ?? "[]";
  } catch {
    return "[]";
  }
};

export function AssetsPanel({ asset, bess, now }: { asset: BessAsset; bess?: BessResp; now: number }) {
  const raw = useSyncExternalStore(subscribeStorage, readContracts, () => "[]");
  const contracts = useMemo(() => {
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? (a as { submarket: Sub; side: "compra" | "venda"; volumeMWm: number; start: string; end: string }[]) : [];
    } catch {
      return [];
    }
  }, [raw]);
  const month = now ? brtDate(now).slice(0, 7) : "";
  const exposure = SUBS.map((s) => ({ s, net: contracts.filter((c) => c.submarket === s && c.start <= month && c.end >= month).reduce((a, c) => a + (c.side === "compra" ? 1 : -1) * c.volumeMWm, 0) })).filter((e) => e.net !== 0);
  const f = bess?.finance;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="eyebrow mb-1 flex items-center gap-1.5">
          <BatteryCharging size={12} className="text-accent" aria-hidden /> Ativo
        </div>
        <MetricRow label={asset.name} value={`${asset.pow} MW / ${asset.cap} MWh`} />
        <MetricRow label="Submercado · eficiência" value={`${asset.sub} · ${asset.rte}%`} />
        <MetricRow label="TIR (12 meses de PLD)" value={f ? (f.irr === null ? "não se paga" : pct(100 * f.irr)) : "—"} tone={f ? (f.irr !== null && f.irr >= asset.wacc / 100 ? "good" : "critical") : undefined} />
      </div>
      <div>
        <div className="eyebrow mb-1 flex items-center gap-1.5">
          <Gauge size={12} className="text-accent-2" aria-hidden /> Carteira ({contracts.length} contrato{contracts.length === 1 ? "" : "s"})
        </div>
        {exposure.length ? (
          exposure.map((e) => <MetricRow key={e.s} label={`Exposição ${e.s} · ${month}`} value={`${e.net > 0 ? "+" : "−"}${n1.format(Math.abs(e.net))} MWm`} tone={e.net > 0 ? "good" : "warning"} />)
        ) : (
          <p className="text-[11px] text-muted">Sem posição no mês. <Link href="/carteira" className="text-accent hover:underline">Cadastrar contratos →</Link></p>
        )}
      </div>
    </div>
  );
}

/* ======================================================== auditor */

export function AuditorPanel({ audit }: { audit?: AuditoriaResp }) {
  const run = audit?.latest;
  if (!run) return <Empty label="Sem auditoria registrada ainda." height={140} />;
  const report = audit.reports?.[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className={`tnum text-[28px] font-semibold leading-none ${run.overallScore >= 85 ? "text-good" : run.overallScore >= 60 ? "text-warning" : "text-critical"}`}>{run.overallScore}</span>
        <span className="text-[11px] text-muted">/100 · {ago(run.startedAt)}{audit.slo?.samples ? ` · saudável em ${n0.format(audit.slo.healthyPct)}% dos runs` : ""}</span>
      </div>
      <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
        {run.sources.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-ink-2">
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "ok" ? "bg-good" : s.status === "degraded" ? "bg-warning" : s.status === "down" ? "bg-critical" : "bg-muted"}`} aria-hidden />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="tnum shrink-0 font-mono text-[10px] text-muted">{s.latencyMs !== null ? `${s.latencyMs}ms` : s.status === "disabled" ? "off" : "—"}</span>
          </li>
        ))}
      </ul>
      {report ? <p className="line-clamp-2 text-[11px] text-muted">IA: {report.summary}</p> : null}
    </div>
  );
}

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
