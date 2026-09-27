"use client";

import { motion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, RefreshCw, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ChartOption } from "@/components/EChart";
import { EASE } from "@/components/motion";
import { Button, Segmented } from "@/components/ui";
import type { BessResp } from "@/lib/apiTypes";
import type { RefDay } from "@/lib/market/bess-study";
import { ASSET_PRESETS, DEFAULT_ASSET, type BessAsset } from "@/lib/asset";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { nf } from "@/lib/fmt";
import { bessFinance } from "@/lib/market/bess-finance";
import { brtHour } from "@/lib/sources/time";
import type { Sub } from "@/lib/sources/types";

const n0 = nf(0);
const n1 = nf(1);
const n2 = nf(2);

/* ============================================================ parâmetros */

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  const [text, setText] = useState(String(value).replace(".", ","));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // valor mudou por fora (preset/reset): sincroniza o texto (padrão "ajustar estado na renderização")
    setPrev(value);
    setText(String(value).replace(".", ","));
  }
  const commit = (raw: string) => {
    setText(raw);
    const v = Number(raw.replace(",", "."));
    if (raw.trim() !== "" && Number.isFinite(v)) onChange(v);
  };
  const bump = (dir: 1 | -1) => {
    const v = Math.min(max, Math.max(min, +(value + dir * step).toFixed(4)));
    onChange(v);
  };
  const invalid = !(value >= min && value <= max);
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between text-[11px] text-ink-2">
        {label}
        {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
      </span>
      <span className={`flex items-stretch overflow-hidden rounded-md border bg-surface-2 transition-colors focus-within:border-accent ${invalid ? "border-critical/60" : "border-line-strong"}`}>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(String(value).replace(".", ","))}
          aria-invalid={invalid}
          className="tnum min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none"
        />
        {suffix ? <span className="self-center pr-2 text-[10.5px] text-muted">{suffix}</span> : null}
        <span className="flex flex-col border-l border-line">
          <button type="button" tabIndex={-1} onClick={() => bump(1)} className="grid h-1/2 w-6 place-items-center text-muted hover:bg-surface-3 hover:text-ink" aria-label={`Aumentar ${label}`}>
            <ChevronUp size={11} />
          </button>
          <button type="button" tabIndex={-1} onClick={() => bump(-1)} className="grid h-1/2 w-6 place-items-center border-t border-line text-muted hover:bg-surface-3 hover:text-ink" aria-label={`Diminuir ${label}`}>
            <ChevronDown size={11} />
          </button>
        </span>
      </span>
      {invalid ? <span className="text-[10px] text-critical">entre {min} e {max}</span> : null}
    </label>
  );
}

const SUB_OPTS: { value: Sub; label: string }[] = [
  { value: "SE", label: "SE/CO" },
  { value: "S", label: "S" },
  { value: "NE", label: "NE" },
  { value: "N", label: "N" },
];

const LIMITS: Record<keyof Omit<BessAsset, "name" | "sub">, [number, number]> = {
  pow: [1, 2000],
  cap: [1, 8000],
  rte: [50, 99],
  deg: [0, 10],
  lcos: [0, 5000],
  wacc: [0, 30],
  life: [5, 40],
  opex: [0, 10],
  ref: [0.25, 3],
  maxc: [0.25, 3],
  days: [30, 365],
};

export function validAsset(a: BessAsset) {
  return (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).every((k) => a[k] >= LIMITS[k][0] && a[k] <= LIMITS[k][1]);
}

export function ParamPanel({ initial, onApply, busy }: { initial: BessAsset; onApply: (a: BessAsset) => void; busy: boolean }) {
  const [f, setF] = useState<BessAsset>(initial);
  const [adv, setAdv] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const valid = validAsset(f);
  const set = <K extends keyof BessAsset>(k: K) => (v: BessAsset[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (valid) onApply(f);
  };
  const preset = ASSET_PRESETS.find((p) => p.asset.name === f.name)?.id ?? "custom";
  return (
    <form onSubmit={submit} className="flex flex-col rounded-md border border-line bg-surface">
      <header className="flex h-9 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <SlidersHorizontal size={13} className="text-accent" aria-hidden /> Parâmetros do sistema
        </span>
        <button type="button" onClick={() => setF(DEFAULT_ASSET)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-accent" title="Voltar ao exemplo padrão">
          <RotateCcw size={11} aria-hidden /> Reset
        </button>
      </header>
      <div className="flex flex-col gap-2.5 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">Ativo de armazenamento</span>
          <select
            value={preset}
            onChange={(e) => setF(ASSET_PRESETS.find((p) => p.id === e.target.value)?.asset ?? f)}
            className="rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {ASSET_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.asset.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] leading-snug text-muted">Valores típicos de mercado — ajuste conforme o datasheet e o contrato.</span>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-2">Submercado (preço)</span>
          <Segmented label="Submercado" value={f.sub} options={SUB_OPTS} onChange={set("sub")} size="xs" />
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          <NumberField label="Potência" suffix="MW" value={f.pow} onChange={set("pow")} step={10} min={1} max={2000} />
          <NumberField label="Energia" suffix="MWh" value={f.cap} onChange={set("cap")} step={20} min={1} max={8000} hint={f.pow > 0 ? `${n1.format(f.cap / f.pow)} h` : undefined} />
          <NumberField label="Eficiência ida-volta" suffix="%" value={f.rte} onChange={set("rte")} step={1} min={50} max={99} />
          <NumberField label="Degradação" suffix="%/ano" value={f.deg} onChange={set("deg")} step={0.1} min={0} max={10} />
        </div>
        <NumberField label="Custo nivelado (LCOS)" suffix="R$/MWh" value={f.lcos} onChange={set("lcos")} step={5} min={0} max={5000} hint="CAPEX + OPEX + degr." />

        <button type="button" onClick={() => setAdv((a) => !a)} className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 hover:bg-surface-2" aria-expanded={adv}>
          Premissas financeiras e de despacho
          <ChevronDown size={13} className={`transition-transform ${adv ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <motion.div initial={false} animate={{ height: adv ? "auto" : 0, opacity: adv ? 1 : 0 }} transition={{ duration: 0.22, ease: EASE }} className="overflow-hidden">
          <div className="grid grid-cols-2 gap-2 pb-1">
            <NumberField label="WACC real" suffix="%" value={f.wacc} onChange={set("wacc")} step={0.5} min={0} max={30} />
            <NumberField label="Vida útil" suffix="anos" value={f.life} onChange={set("life")} step={1} min={5} max={40} />
            <NumberField label="OPEX" suffix="% CAPEX" value={f.opex} onChange={set("opex")} step={0.25} min={0} max={10} />
            <NumberField label="Ciclos ref. LCOS" suffix="/dia" value={f.ref} onChange={set("ref")} step={0.25} min={0.25} max={3} />
            <NumberField label="Máx. ciclos" suffix="/dia" value={f.maxc} onChange={set("maxc")} step={0.25} min={0.25} max={3} />
            <NumberField label="Janela de PLD" suffix="dias" value={f.days} onChange={(v) => set("days")(Math.round(v))} step={30} min={30} max={365} />
          </div>
        </motion.div>

        <Button type="submit" variant="primary" disabled={!valid || busy} className="mt-1 w-full py-2 text-[12.5px] uppercase tracking-wider">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} aria-hidden />
          {busy ? "Calculando…" : "Recalcular"}
        </Button>
        <p className={`text-center text-[10.5px] ${dirty ? "text-warning" : "text-muted"}`} role="status">
          {dirty ? "Parâmetros alterados — recalcule para atualizar a tela." : "Resultados atualizados com estes parâmetros."}
        </p>
      </div>
    </form>
  );
}

/* ============================================================ SOC ring */

export function SocRing({ soc, size = 112 }: { soc: number; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, soc));
  const color = pct >= 0.66 ? C.good : pct >= 0.33 ? C.accent2 : C.warning;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Estado de carga ${Math.round(pct * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={9} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={9}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ duration: 0.8, ease: EASE }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" fontSize={size * 0.2} fontWeight={600} fill="var(--ink)" className="tnum">
        {Math.round(pct * 100)}%
      </text>
      <text x="50%" y="64%" textAnchor="middle" fontSize={size * 0.085} fill="var(--muted)">
        SOC
      </text>
    </svg>
  );
}

/* ============================================================ gráficos */

const hourLabel = (t: number) => `${String(brtHour(t)).padStart(2, "0")}:00`;

/** Fluxo de energia em dois painéis sincronizados: preço (topo) e potência + SOC (base). */
export function flowOption(r: RefDay | null | undefined): ChartOption | null {
  if (!r) return null;
  const hours = r.ts.map(hourLabel);
  const base = baseOption();
  return {
    ...base,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    legend: { ...base.legend, data: ["Carga (consumo da rede)", "Descarga (injeção)", "SOC (%)", "PLD (R$/MWh)"] },
    tooltip: { ...base.tooltip, trigger: "axis" },
    grid: [
      { left: 8, right: 44, top: 46, height: "22%", containLabel: true },
      { left: 8, right: 44, top: "42%", bottom: 8, containLabel: true },
    ],
    xAxis: [
      categoryAxis(hours, { gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } }),
      categoryAxis(hours, { gridIndex: 1, axisLabel: { color: C.muted, fontSize: 10, hideOverlap: true } }),
    ],
    yAxis: [
      valueAxis("R$/MWh", { gridIndex: 0, splitNumber: 2 }),
      valueAxis("MW", { gridIndex: 1 }),
      valueAxis("SOC %", { gridIndex: 1, min: 0, max: 100, splitLine: { show: false }, position: "right", scale: false }),
    ],
    series: [
      {
        name: "PLD (R$/MWh)",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: r.price.map((v) => +v.toFixed(2)),
        showSymbol: false,
        step: "middle",
        lineStyle: { width: 1.5, color: C.ink2 },
        itemStyle: { color: C.ink2 },
        areaStyle: { color: "rgba(182,192,205,0.06)" },
      },
      { name: "Descarga (injeção)", type: "bar", xAxisIndex: 1, yAxisIndex: 1, stack: "p", data: r.dischargeMW.map((v) => +v.toFixed(2)), itemStyle: { color: C.good, borderRadius: [2, 2, 0, 0] }, barWidth: "62%" },
      { name: "Carga (consumo da rede)", type: "bar", xAxisIndex: 1, yAxisIndex: 1, stack: "p", data: r.chargeMW.map((v) => -+v.toFixed(2)), itemStyle: { color: C.accent, borderRadius: [0, 0, 2, 2] } },
      {
        name: "SOC (%)",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: r.soc.map((v) => +(100 * v).toFixed(1)),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 1.5, color: C.ink, type: [4, 3] },
        itemStyle: { color: C.ink },
      },
    ],
  };
}

/** Preço do dia com as horas de compra e venda e os preços médios ponderados da janela. */
export function marginOption(b: BessResp, r: RefDay | null | undefined): ChartOption | null {
  if (!r) return null;
  const hours = r.ts.map(hourLabel);
  const buy = r.price.map((p, h) => (r.chargeMW[h] > 1e-6 ? +p.toFixed(2) : null));
  const sell = r.price.map((p, h) => (r.dischargeMW[h] > 1e-6 ? +p.toFixed(2) : null));
  const base = baseOption();
  const ml = (y: number | null, label: string, color: string) => (y === null ? [] : [{ yAxis: +y.toFixed(2), label: { formatter: `${label} ${n0.format(y)}`, color, fontSize: 9.5, position: "insideEndTop" }, lineStyle: { color, type: [4, 3], width: 1 } }]);
  return {
    ...base,
    grid: { left: 4, right: 8, top: 26, bottom: 4, containLabel: true },
    legend: { ...base.legend, data: ["PLD", "Compra (carga)", "Venda (descarga)"] },
    tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1, type: [3, 3] } } },
    xAxis: categoryAxis(hours, { axisLabel: { color: C.muted, fontSize: 9, interval: 3 } }),
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: [
      {
        name: "PLD",
        type: "line",
        data: r.price.map((v) => +v.toFixed(2)),
        showSymbol: false,
        lineStyle: { width: 1.3, color: C.muted },
        itemStyle: { color: C.muted },
        markLine: { symbol: "none", silent: true, data: [...ml(b.margin.avgBuy, "compra média", C.accent), ...ml(b.margin.avgSell, "venda média", C.good)] },
      },
      { name: "Compra (carga)", type: "scatter", data: buy, symbolSize: 7, itemStyle: { color: C.accent } },
      { name: "Venda (descarga)", type: "scatter", data: sell, symbolSize: 7, itemStyle: { color: C.good } },
    ],
  };
}

export function dailyRevenueOption(b: BessResp): ChartOption | null {
  if (b.daily.length < 2) return null;
  const ts = b.daily.map((d) => Date.parse(`${d.date}T12:00:00-03:00`));
  const roll = b.daily.map((_, i) => {
    const w = b.daily.slice(Math.max(0, i - 29), i + 1);
    return w.reduce((a, d) => a + d.revenue, 0) / w.length / 1000;
  });
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 26, bottom: 4, containLabel: true },
    legend: { ...base.legend, data: ["Despacho ótimo", "Média móvel 30 d", "Política simples"] },
    tooltip: { ...base.tooltip, valueFormatter: (v: number) => (v == null ? "—" : `R$ ${n1.format(v)} mil`) },
    xAxis: { type: "time", axisLine: { lineStyle: { color: C.axis } }, axisLabel: { color: C.muted, fontSize: 10, hideOverlap: true, formatter: (v: number) => new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).format(new Date(v)).replace(".", "") }, splitLine: { show: false } },
    yAxis: valueAxis(undefined, { splitNumber: 3 }),
    series: [
      { name: "Despacho ótimo", type: "bar", data: ts.map((t, i) => [t, +(b.daily[i].revenue / 1000).toFixed(2)]), itemStyle: { color: "rgba(59,158,255,0.55)" }, barMaxWidth: 6 },
      { name: "Política simples", type: "line", data: ts.map((t, i) => [t, +(b.daily[i].naive / 1000).toFixed(2)]), showSymbol: false, lineStyle: { width: 0.8, color: C.muted, opacity: 0.6 }, itemStyle: { color: C.muted } },
      { name: "Média móvel 30 d", type: "line", data: ts.map((t, i) => [t, +roll[i].toFixed(2)]), showSymbol: false, lineStyle: { width: 1.8, color: C.accent2 }, itemStyle: { color: C.accent2 } },
    ],
  };
}

/** Curva de duração do spread diário (máx − mín do PLD): em quantos dias o spread passa de X. */
export function spreadDurationOption(b: BessResp): ChartOption | null {
  if (b.daily.length < 2) return null;
  const s = b.daily.map((d) => d.spread).sort((x, y) => y - x);
  const base = baseOption();
  const breakeven = b.params.lcos; // referência visual: custo nivelado por MWh
  return {
    ...base,
    grid: { left: 4, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1, type: [3, 3] } }, formatter: (p: { value: [number, number] }[]) => `${n0.format(p[0].value[0])}% dos dias<br/>spread ≥ <b>R$ ${n0.format(p[0].value[1])}</b>/MWh` },
    xAxis: { type: "value", min: 0, max: 100, axisLabel: { color: C.muted, fontSize: 10, formatter: "{value}%" }, splitLine: { show: false }, axisLine: { lineStyle: { color: C.axis } } },
    yAxis: valueAxis("R$/MWh", { splitNumber: 3 }),
    series: [
      {
        name: "Spread diário",
        type: "line",
        data: s.map((v, i) => [(100 * (i + 1)) / s.length, +v.toFixed(1)]),
        showSymbol: false,
        lineStyle: { width: 1.6, color: C.accent },
        itemStyle: { color: C.accent },
        areaStyle: { color: "rgba(59,158,255,0.10)" },
        markLine: { symbol: "none", silent: true, data: [{ yAxis: breakeven, label: { formatter: `LCOS ${n0.format(breakeven)}`, color: C.warning, fontSize: 9.5, position: "insideEndTop" }, lineStyle: { color: C.warning, type: [4, 3], width: 1 } }] },
      },
    ],
  };
}

/** Sensibilidade da TIR ao custo nivelado (mesma receita do despacho), com WACC e equilíbrio. */
export function sensitivityOption(b: BessResp): ChartOption | null {
  const f = b.finance;
  const p = b.params;
  const xs = Array.from({ length: 41 }, (_, i) => p.lcos * (0.4 + (i * 1.2) / 40));
  const pts = xs.map((lcos) => {
    const r = bessFinance({ ...p, lcos }, f.revenueYear1, f.dischargedYear1);
    return [+lcos.toFixed(1), r.irr === null ? null : +(100 * r.irr).toFixed(2)] as [number, number | null];
  });
  const base = baseOption();
  return {
    ...base,
    grid: { left: 4, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, axisPointer: { type: "line", lineStyle: { color: C.muted, width: 1, type: [3, 3] } }, formatter: (ps: { value: [number, number | null] }[]) => `LCOS R$ ${n0.format(ps[0].value[0])}/MWh<br/>TIR ${ps[0].value[1] === null ? "— (não se paga)" : `<b>${n1.format(ps[0].value[1])}%</b>`}` },
    xAxis: { type: "value", scale: true, axisLabel: { color: C.muted, fontSize: 10 }, splitLine: { show: false }, axisLine: { lineStyle: { color: C.axis } }, name: "LCOS R$/MWh", nameLocation: "middle", nameGap: 22, nameTextStyle: { color: C.muted, fontSize: 10 } },
    yAxis: valueAxis("TIR %", { splitNumber: 3 }),
    series: [
      {
        name: "TIR",
        type: "line",
        data: pts,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.8, color: C.good },
        itemStyle: { color: C.good },
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            { yAxis: p.waccPct, label: { formatter: `WACC ${n1.format(p.waccPct)}%`, color: C.muted, fontSize: 9.5, position: "insideEndTop" }, lineStyle: { color: C.muted, type: [4, 3], width: 1 } },
            { xAxis: +p.lcos.toFixed(1), label: { formatter: "atual", color: C.accent, fontSize: 9.5 }, lineStyle: { color: C.accent, type: [2, 3], width: 1 } },
            ...(f.breakevenLcos > 0 ? [{ xAxis: +f.breakevenLcos.toFixed(1), label: { formatter: "equilíbrio", color: C.warning, fontSize: 9.5 }, lineStyle: { color: C.warning, type: [2, 3], width: 1 } }] : []),
          ],
        },
      },
    ],
  };
}

export const fmtMoney = (v: number | null | undefined, digits = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}R$ ${nf(digits).format(a / 1e9)} bi`;
  if (a >= 1e6) return `${sign}R$ ${nf(digits).format(a / 1e6)} mi`;
  if (a >= 1e3) return `${sign}R$ ${nf(digits).format(a / 1e3)} mil`;
  return `${sign}R$ ${n0.format(a)}`;
};

export function SpecCard({ Icon, label, value, unit, caption, delay = 0 }: { Icon: typeof RefreshCw; label: string; value: ReactNode; unit?: string; caption?: ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay }} className="flex min-w-0 items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-accent/25 bg-accent/10 text-accent">
        <Icon size={14} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="eyebrow truncate">{label}</div>
        <div className="tnum mt-0.5 truncate text-[19px] font-semibold leading-tight tracking-tight text-ink">
          {value}
          {unit ? <span className="ml-1 text-[10.5px] font-normal tracking-normal text-muted">{unit}</span> : null}
        </div>
        {caption ? <div className="mt-0.5 truncate text-[10.5px] text-muted">{caption}</div> : null}
      </div>
    </motion.div>
  );
}

export { n0, n1, n2 };
