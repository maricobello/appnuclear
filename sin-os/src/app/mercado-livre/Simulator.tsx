"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Button, Disclosure, Kpi, MetricRow, Panel, Segmented, Table } from "@/components/ui";
import type { MercadoLivreResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { brl, num, pct } from "@/lib/fmt";
import {
  avgLoadMw,
  contractCalendar,
  costHistogram,
  counterpartyExposure,
  createStats,
  evaluate,
  fairPrices,
  fillStats,
  monthTable,
  objective,
  optimizeContract,
  risk,
  TYPICAL,
  typicalLoad,
  unitCost,
  type Contract,
  type ContractTerms,
  type Exposure,
  type FlexRule,
  type Modulation,
  type MonthRow,
  type Optimum,
  type RiskStats,
  type SeasonMode,
  type Side,
  type Stats,
  type StatsInput,
} from "@/lib/market/contracting";
import { contractLoad, curveStats, parseLoadCsv, type LoadUnit, type ParsedCurve } from "@/lib/market/loadcurve";
import { BANDEIRA_LABEL, type Bandeira } from "@/lib/market/radar";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));
const N_SCENARIOS = 2000;
const CHUNK = 100;
const ALPHA = 0.95;

/** R$ em mil ou milhão, conforme o tamanho. */
const money = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e6 ? `R$ ${num(v / 1e6, 2)} mi` : a >= 1e3 ? `R$ ${num(v / 1e3, 0)} mil` : brl(v, 0);
};
/** Número digitado: aceita 1.234,56, 1234,56 e 1234.56. */
const numIn = (s: string) => {
  const t = s.trim();
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};
/** Preço digitado abaixo de R$ 10 só pode estar em R$/kWh: vira R$/MWh. */
const inKwh = (v: number) => v > 0 && v < 10;
const perMwh = (v: number) => (inKwh(v) ? v * 1000 : v);

/** Milhares de reais com sinal, curto (cabe no rodapé do indicador). */
const kMoney = (v: number) => `${v < 0 ? "−" : ""}${num(Math.abs(v) / 1000, 0)} mil`;
const pctIn = (s: string, fallback = 0, max = 1) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? Math.min(max, v / 100) : fallback;
};

const BETAS = [
  { value: "0", label: "Neutro", title: "Só o custo esperado: a resposta é tudo ou nada" },
  { value: "0.3", label: "Baixa" },
  { value: "0.6", label: "Moderada" },
  { value: "0.9", label: "Alta", title: "Quase só o pior cenário (CVaR 95%)" },
] as const;

/** Modelo de CSV (2 dias, 15 min, kWh) para quem quer ver o formato. */
function sampleCsv(): string {
  const rows = ["Data;Hora;Consumo ativo (kWh)"];
  for (let d = 1; d <= 2; d++)
    for (let i = 0; i < 96; i++) {
      const h = Math.floor(i / 4);
      const kwh = (TYPICAL.comercial.util[h] * 250).toFixed(1).replace(".", ",");
      rows.push(`0${d}/03/2026;${String(h).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")};${kwh}`);
    }
  return rows.join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls = "min-h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Cenários hora a hora calculados em blocos (a tela segue respondendo); recalcula quando a entrada muda. */
function useStats(inp: StatsInput | null): { st: Stats | null; progress: number } {
  const [res, setRes] = useState<{ inp: StatsInput; st: Stats } | null>(null);
  const [progress, setProgress] = useState<{ inp: StatsInput | null; done: number }>({ inp: null, done: 0 });
  useEffect(() => {
    if (!inp) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const st = createStats(inp);
      for (let s = 0; s < st.n; s += CHUNK) {
        if (cancelled) return;
        fillStats(st, inp, s, s + CHUNK);
        setProgress({ inp, done: st.done / st.n });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelled) setRes({ inp, st });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inp]);
  const ready = res && res.inp === inp ? res.st : null;
  return { st: ready, progress: progress.inp === inp ? progress.done : 0 };
}

interface Result {
  opt: Optimum;
  contract: Contract;
  table: MonthRow[];
  exposure: Exposure[];
  hist: { edges: number[]; counts: number[][] };
  frontier: { q: number; r: RiskStats }[];
  comps: { label: string; hint?: string; r: RiskStats }[];
  /**
   * Economia anual (R$) da flexibilidade e da sazonalização — no objetivo (1 − β)·E + β·CVaR, no esperado e no
   * pior 5% — e o prêmio no preço do contrato (R$/MWh) que zeraria essa economia: até quanto vale pagar a mais.
   */
  values: Record<"flex" | "season", { objective: number; mean: number; cvar: number; premium: number }>;
  atCap: boolean; // volume ótimo no limite de 150% da carga
  subs: { load: Sub; contract: Sub };
  energy: number;
  total: RiskStats; // em R$
  avg: number; // carga média com perdas (MWmed)
  fair: ReturnType<typeof fairPrices>;
  /** Média do ano por hora do dia: carga (MW) e PLD esperado no submercado da carga. */
  profile: { load: number[]; price: number[] };
}

function hourProfile(st: Stats, inp: StatsInput): Result["profile"] {
  const days = inp.cal.days.length;
  const load = new Array(24).fill(0);
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) load[h] += inp.load[d * 24 + h] / days;
  // PLD de cada hora do dia na média dos dias e dos cenários, como foi calculado (piso, tetos e recentragem)
  return { load: load.map((x) => Math.round(x * 1000) / 1000), price: Array.from(st.hourSum, (x) => Math.round(x / (st.done * days))) };
}

function analyse(
  st: Stats,
  inp: StatsInput,
  subs: Result["subs"],
  terms: ContractTerms,
  plan: { volume: number | null; season: SeasonMode; seasonLimit: number },
  beta: number,
  recovery: number,
): Result {
  const opt = optimizeContract(st, terms, plan, beta, ALPHA);
  const contract: Contract = { ...terms, volumes: opt.volumes };
  const ur = (c: Contract) => risk(unitCost(evaluate(st, c)), ALPHA);
  const avg = avgLoadMw(st) * (1 + terms.losses);
  const classic: Contract = { ...terms, volumes: new Array(st.M).fill(avg), flex: 0, modulation: "flat" };
  const spot: Contract = { ...terms, volumes: new Array(st.M).fill(0) };
  const noFlex: Contract = { ...contract, flex: 0 };
  const noSeason: Contract = { ...contract, volumes: new Array(st.M).fill(opt.q) };
  const qMax = Math.max(avg * 1.5, 1e-6);
  const frontier = Array.from({ length: 31 }, (_, i) => {
    const q = (qMax * i) / 30;
    return { q, r: ur({ ...contract, volumes: opt.shape.map((u) => q * u) }) };
  });
  const evOpt = evaluate(st, contract);
  const energy = evOpt.energy.reduce((a, b) => a + b, 0) / st.n;
  const gain = (without: Contract) => {
    const r = ur(without);
    const target = objective(r, beta);
    // o custo cresce com o preço em todo cenário: bisseção no prêmio que iguala o objetivo ao da estrutura sem a cláusula
    const gap = (dp: number) => objective(ur({ ...contract, price: contract.price + dp }), beta) - target;
    let premium = 0;
    if (gap(0) < 0) {
      let lo = 0;
      let hi = 25;
      while (gap(hi) < 0 && hi < 3200) hi *= 2;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) < 0) lo = mid;
        else hi = mid;
      }
      premium = (lo + hi) / 2;
    }
    return { objective: (target - objective(opt.risk, beta)) * energy, mean: (r.mean - opt.risk.mean) * energy, cvar: (r.cvar - opt.risk.cvar) * energy, premium };
  };
  return {
    opt,
    contract,
    table: monthTable(st, contract),
    exposure: counterpartyExposure(st, contract, recovery),
    hist: costHistogram(st, [classic, contract]),
    frontier,
    comps: [
      { label: "Tudo no PLD", hint: "sem contrato", r: ur(spot) },
      { label: "Flat clássico", hint: "100% da carga, sem flexibilidade nem sazonalização", r: ur(classic) },
      { label: "Estrutura escolhida sem flexibilidade", r: ur(noFlex) },
      { label: "Estrutura escolhida sem sazonalização", r: ur(noSeason) },
      { label: "Estrutura escolhida, volume ótimo", r: opt.risk },
    ],
    values: { flex: gain(noFlex), season: gain(noSeason) },
    atCap: plan.volume === null && opt.q >= qMax * 0.999,
    subs,
    energy,
    total: risk(evOpt.total, ALPHA),
    avg,
    fair: fairPrices(st),
    profile: hourProfile(st, inp),
  };
}

export function Simulator({ data, essPerMwh }: { data: MercadoLivreResp; essPerMwh: number | null }) {
  const [sub, setSub] = useState<Sub>("SE");
  const [subC, setSubC] = useState<Sub | "mesmo">("mesmo");
  const [source, setSource] = useState<"tipico" | "csv">("tipico");
  const [kind, setKind] = useState<keyof typeof TYPICAL>("comercial");
  const [avgMw, setAvgMw] = useState("2");
  const [raw, setRaw] = useState<{ name: string; text: string } | null>(null);
  const [unit, setUnit] = useState<LoadUnit | "auto">("auto");
  const [priceIn, setPriceIn] = useState("");
  const [beta, setBeta] = useState<(typeof BETAS)[number]["value"]>("0.6");
  const [volMode, setVolMode] = useState<"otimo" | "fixo">("otimo");
  const [volIn, setVolIn] = useState("");
  const [season, setSeason] = useState<SeasonMode>("otima");
  const [seasonLim, setSeasonLim] = useState("15");
  const [flexIn, setFlexIn] = useState("10");
  const [flexRule, setFlexRule] = useState<FlexRule>("carga");
  const [modulation, setModulation] = useState<Modulation>("flat");
  const [uncA, setUncA] = useState("5");
  const [uncM, setUncM] = useState("3");
  const [corrIn, setCorrIn] = useState("0");
  const [lossIn, setLossIn] = useState("0");
  const [recIn, setRecIn] = useState("0");
  const [te, setTe] = useState("");
  const [bandeira, setBandeira] = useState<Bandeira>("amarela");
  const [encIn, setEncIn] = useState("");

  const cal = useMemo(() => contractCalendar(data.meses.map((m) => m.mes)), [data.meses]);
  const parsed = useMemo<{ curve: ParsedCurve | null; error: string | null }>(() => {
    if (!raw?.text) return { curve: null, error: raw ? "Arquivo maior que 25 MB." : null };
    try {
      return { curve: parseLoadCsv(raw.text, unit === "auto" ? undefined : unit), error: null };
    } catch (e) {
      return { curve: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [raw, unit]);
  const fromCurve = useMemo(() => (parsed.curve ? { stats: curveStats(parsed.curve), ...contractLoad(parsed.curve, cal) } : null), [parsed.curve, cal]);
  const mwTypical = Math.max(0.01, numIn(avgMw) || 0);
  const load = useMemo(() => (source === "csv" && fromCurve ? fromCurve.load : typicalLoad(kind, mwTypical, cal)), [source, fromCurve, kind, mwTypical, cal]);

  const contractSub = subC === "mesmo" || subC === sub ? null : subC;
  const corrNum = numIn(corrIn);
  const unc = { annual: pctIn(uncA), monthly: pctIn(uncM), priceCorr: Number.isFinite(corrNum) ? Math.min(1, Math.max(-1, corrNum)) : 0 };
  const crossRho = contractSub ? (data.correlacao?.[sub]?.[contractSub] ?? null) : null;
  const statsInput = useMemo<StatsInput | null>(() => {
    if (!data.meses.length) return null;
    const sideOf = (s: Sub): Side => {
      const dev = data.horaria?.[s].dev ?? cal.days.flatMap((d) => data.forma?.[s].dev[Number(d.date.slice(5, 7)) - 1] ?? new Array(24).fill(0));
      return { bands: data.meses.map((m) => m.band[s]), lims: data.meses.map((m) => m.lim), dev, rho: data.rho?.[s] ?? 0.5 };
    };
    return {
      cal,
      load,
      loadSide: sideOf(sub),
      contractSide: contractSub ? sideOf(contractSub) : null,
      crossRho: crossRho ?? 0.9,
      uncertainty: { annual: unc.annual, monthly: unc.monthly, priceCorr: unc.priceCorr },
      n: N_SCENARIOS,
    };
  }, [data, cal, load, sub, contractSub, crossRho, unc.annual, unc.monthly, unc.priceCorr]);
  const { st, progress } = useStats(statsInput);

  const fair = useMemo(() => (st ? fairPrices(st) : null), [st]);
  const typed = perMwh(numIn(priceIn));
  // vazio = o PLD médio esperado dos próprios cenários, sem arredondar (arredondado, o contrato já nasceria com vantagem)
  const price = Number.isFinite(typed) && typed > 0 ? typed : fair ? Math.round(fair.flat * 100) / 100 : null;
  const flex = pctIn(flexIn);
  const losses = pctIn(lossIn, 0, 0.5);
  const recovery = pctIn(recIn);
  const lim = pctIn(seasonLim, 0.15);
  const volFixed = numIn(volIn);
  const plan = useMemo(
    () => ({ volume: volMode === "fixo" && Number.isFinite(volFixed) && volFixed >= 0 && volIn.trim() ? volFixed : null, season, seasonLimit: season === "flat" ? 0 : lim }),
    [volMode, volFixed, volIn, season, lim],
  );
  const terms = useMemo<ContractTerms | null>(() => (price !== null ? { price, flex, flexRule, modulation, losses } : null), [price, flex, flexRule, modulation, losses]);

  // o último resultado fica na tela (esmaecido) enquanto o novo é calculado
  const [result, setResult] = useState<{ key: unknown[]; r: Result } | null>(null);
  const key = useMemo(() => [st, terms, plan, beta, recovery], [st, terms, plan, beta, recovery]);
  useEffect(() => {
    if (!st || !terms || !statsInput) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const r = analyse(st, statsInput, { load: sub, contract: contractSub ?? sub }, terms, plan, Number(beta), recovery);
      if (!cancelled) setResult({ key, r });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [st, statsInput, sub, contractSub, terms, plan, beta, recovery, key]);
  const res = result?.r ?? null;
  const stale = !result || result.key !== key;
  const fairShown = fair ?? res?.fair ?? null; // enquanto os cenários novos são gerados, mostra os da última conta
  const status = !st
    ? `Gerando os cenários hora a hora: ${pct(100 * progress, 0)}`
    : stale
      ? "Otimizando volume e sazonalização…"
      : `${num(N_SCENARIOS)} cenários de preço e de carga × ${num(cal.total)} horas · ${num(res?.opt.evals ?? 0)} contratos avaliados na otimização`;

  const frontierChart = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    const avg = res.avg;
    const pt = (q: number, r: RiskStats) => [r.cvar, r.mean, q];
    const fmt = (p: { value: number[]; seriesName: string }) =>
      `${p.seriesName}<br/>${num(p.value[2], 2)} MWmed (${pct((100 * p.value[2]) / avg, 0)} da carga)<br/>custo esperado ${brl(p.value[1])}/MWh<br/>CVaR 95% ${brl(p.value[0])}/MWh`;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "item", formatter: fmt },
      grid: { ...baseOption().grid, right: 16, bottom: 30 },
      xAxis: valueAxis("CVaR 95% (R$/MWh)", { nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: valueAxis("Custo esperado (R$/MWh)"),
      series: [
        { name: "Volumes de 0% a 150% da carga", type: "line", data: res.frontier.map((f) => pt(f.q, f.r)), lineStyle: { width: 1.5, color: C.ink2 }, itemStyle: { color: C.ink2 }, symbolSize: 4 },
        { name: "Tudo no PLD", type: "scatter", data: [pt(0, res.comps[0].r)], itemStyle: { color: C.series[1] }, symbolSize: 11 },
        { name: "Flat clássico", type: "scatter", data: [pt(avg, res.comps[1].r)], itemStyle: { color: C.series[3] }, symbolSize: 11 },
        { name: "Ótimo", type: "scatter", data: [pt(res.opt.q, res.opt.risk)], itemStyle: { color: C.series[0] }, symbolSize: 14 },
      ],
    } as ChartOption;
  }, [res]);

  const distChart = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    const h = res.hist;
    const mid = h.edges.slice(0, -1).map((e, i) => Math.round((e + h.edges[i + 1]) / 2));
    const names = ["Flat clássico", "Estrutura ótima"];
    const colors = [C.series[3], C.series[0]];
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => pct(v, 1) },
      grid: { ...baseOption().grid, bottom: 30 },
      xAxis: categoryAxis(mid.map((x) => num(x, 0)), { name: "R$/MWh consumido", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: valueAxis("% dos cenários"),
      series: h.counts.map((c, i) => ({ name: names[i], type: "line", step: "middle", data: c.map((x) => 100 * x), lineStyle: { width: 1.8, color: colors[i] }, itemStyle: { color: colors[i] }, showSymbol: false, areaStyle: i === 1 ? { color: colors[i], opacity: 0.12 } : undefined })),
    } as ChartOption;
  }, [res]);

  const seasonChart = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    const t = res.table;
    const tip = (ps: { dataIndex: number }[]) => {
      const r = t[ps[0]?.dataIndex ?? 0];
      return [
        `<b>${monthLabel(r.mes)}</b>`,
        `Volume sazonalizado: ${num(r.volume, 3)} MWmed`,
        `Faixa da flexibilidade: ${num(r.min, 3)}–${num(r.max, 3)}`,
        `Volume tomado (esperado): ${num(r.tomado, 3)}`,
        `Carga esperada: ${num(r.carga, 3)}`,
        `PLD esperado: ${brl(r.pldContrato)}/MWh`,
      ].join("<br/>");
    };
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, formatter: tip },
      grid: { ...baseOption().grid, right: 8 },
      xAxis: categoryAxis(t.map((r) => monthLabel(r.mes))),
      yAxis: [valueAxis("MWmed"), valueAxis("R$/MWh", { splitLine: { show: false }, position: "right", nameTextStyle: { color: C.muted, fontSize: 10, align: "right" } })],
      series: [
        { name: "Volume", type: "bar", data: t.map((r) => r.volume), itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
        { name: "Faixa", type: "line", stack: "faixa", data: t.map((r) => r.min), lineStyle: { opacity: 0 }, showSymbol: false, itemStyle: { color: C.series[0] } },
        { name: "Faixa", type: "line", stack: "faixa", data: t.map((r) => r.max - r.min), lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: C.series[0], opacity: 0.16 }, itemStyle: { color: C.series[0] } },
        { name: "Carga", type: "line", data: t.map((r) => r.carga), lineStyle: { width: 2, color: C.series[2] }, itemStyle: { color: C.series[2] }, symbolSize: 5 },
        { name: "PLD", type: "line", yAxisIndex: 1, data: t.map((r) => r.pldContrato), lineStyle: { width: 1.5, color: C.series[1] }, itemStyle: { color: C.series[1] }, showSymbol: false },
      ],
    } as ChartOption;
  }, [res]);

  const expoChart = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => money(v * 1000) },
      xAxis: categoryAxis(res.exposure.map((e) => monthLabel(e.mes))),
      yAxis: valueAxis("R$ mil"),
      series: [
        { name: "Esperada (EE)", type: "bar", data: res.exposure.map((e) => e.ee / 1000), itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 },
        { name: "Potencial (PFE 95%)", type: "line", data: res.exposure.map((e) => e.pfe / 1000), lineStyle: { width: 2, color: C.critical }, itemStyle: { color: C.critical }, symbolSize: 5 },
        { name: "Sem recontratar", type: "line", data: res.exposure.map((e) => e.pfeSpot / 1000), lineStyle: { width: 1.5, type: [4, 3], color: C.ink2 }, itemStyle: { color: C.ink2 }, showSymbol: false },
      ],
    } as ChartOption;
  }, [res]);

  const profileChart = useMemo<ChartOption | null>(() => {
    if (!res) return null;
    return {
      ...baseOption(),
      grid: { ...baseOption().grid, right: 8 },
      xAxis: categoryAxis(Array.from({ length: 24 }, (_, h) => `${h}h`)),
      yAxis: [valueAxis("MW"), valueAxis("R$/MWh", { splitLine: { show: false }, position: "right", nameTextStyle: { color: C.muted, fontSize: 10, align: "right" } })],
      series: [
        { name: "Sua carga (média do ano)", type: "bar", data: res.profile.load, itemStyle: { color: C.series[2], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
        { name: "PLD esperado por hora", type: "line", yAxisIndex: 1, data: res.profile.price, lineStyle: { width: 2, color: C.series[1] }, itemStyle: { color: C.series[1] }, showSymbol: false },
      ],
    } as ChartOption;
  }, [res]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setRaw({ name: f.name, text: f.size > 25 * 1024 * 1024 ? "" : await f.text() });
    setSource("csv");
  };

  const encargos = encIn.trim() ? numIn(encIn) : essPerMwh !== null ? Math.round(essPerMwh * 100) / 100 : 0;
  const enc = Number.isFinite(encargos) ? encargos : 0;
  const teIn = perMwh(numIn(te));
  const teKwh = inKwh(numIn(te));
  const acrEnergy = res ? res.energy / (1 + res.contract.losses) : null; // no regulado as perdas já estão na tarifa
  const acr = res && acrEnergy !== null && Number.isFinite(teIn) && teIn > 0 ? acrEnergy * (teIn + data.bandeiras[bandeira]) : null;
  const acl = res ? res.total.mean + res.energy * enc : null;
  const aclBad = res ? res.opt.risk.cvar * res.energy + res.energy * enc : null;
  const peakPfe = res?.exposure.length ? Math.max(...res.exposure.map((e) => e.pfe)) : null;
  const peakEe = res?.exposure.length ? Math.max(...res.exposure.map((e) => e.ee)) : null;
  const avg = res?.avg ?? (st ? avgLoadMw(st) * (1 + losses) : null);
  const eqDays = data.horaria?.[sub];

  if (!data.meses.length) return null;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Contrato"
        subtitle="Volume, sazonalização, flexibilidade e modulação de um contrato bilateral para os próximos 12 meses, medidos em 2.000 cenários de preço e de carga, hora a hora"
        right={<Segmented label="Submercado da carga" value={sub} options={SUB_OPTS} onChange={setSub} size="xs" />}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-3 md:col-span-2">
            <Segmented
              label="Curva de carga"
              value={source}
              onChange={setSource}
              options={[
                { value: "tipico", label: "Perfil típico" },
                { value: "csv", label: "Minha curva (CSV)" },
              ]}
            />
            {source === "tipico" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Perfil (exemplo)">
                  <Select value={kind} onChange={setKind} options={Object.entries(TYPICAL).map(([k, v]) => ({ value: k as keyof typeof TYPICAL, label: v.label }))} />
                </Field>
                <Field label="Carga média (MWmed)">
                  <input className={inputCls} inputMode="decimal" value={avgMw} onChange={(e) => setAvgMw(e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} aria-label="Arquivo da curva de carga" className="text-[13px] text-ink-2 file:mr-3 file:rounded-full file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink" />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[170px]">
                    <Field label="Unidade">
                      <Select
                        value={unit}
                        onChange={setUnit}
                        options={[
                          { value: "auto", label: "Pelo cabeçalho" },
                          { value: "kWh", label: "kWh por intervalo" },
                          { value: "kW", label: "kW" },
                          { value: "MWh", label: "MWh por intervalo" },
                          { value: "MW", label: "MW" },
                        ]}
                      />
                    </Field>
                  </div>
                  <Button variant="ghost" onClick={() => download("modelo-curva-de-carga.csv", sampleCsv())}>
                    Baixar modelo
                  </Button>
                </div>
                {parsed.error ? (
                  <p role="alert" className="text-[13px] text-critical">
                    {parsed.error}
                  </p>
                ) : null}
                {parsed.curve && fromCurve ? (
                  <p className="text-[12px] leading-relaxed text-muted">
                    {raw?.name}: {num(parsed.curve.rows)} leituras de {parsed.curve.intervalMin} min, coluna “{parsed.curve.column}” em {parsed.curve.unit}
                    {parsed.curve.unitGuessed ? " (suposto: confira a unidade)" : ""}, {parsed.curve.first} a {parsed.curve.last}
                    {parsed.curve.skipped ? `, ${num(parsed.curve.skipped)} linhas ignoradas` : ""}. Média {num(fromCurve.stats.avgMw, 3)} MW, pico {num(fromCurve.stats.peakMw, 3)} MW, fator de carga {pct(100 * fromCurve.stats.loadFactor, 0)},{" "}
                    {pct(100 * fromCurve.stats.peakShare, 1)} da energia entre 18h e 21h. {fromCurve.equivalent} dos {cal.days.length} dias do contrato vêm de um dia equivalente da curva
                    {fromCurve.fallback ? `; ${fromCurve.fallback} usam a média do mesmo tipo de dia` : ""}.
                  </p>
                ) : (
                  <p className="text-[12px] leading-relaxed text-muted">
                    Curva de 15 min, 30 min ou horária, como sai do portal da distribuidora (e do Open Energy, quando as APIs chegarem). Cada dia do contrato usa o dia equivalente da curva (mesmo tipo de dia e mês). A leitura
                    acontece no seu navegador: o arquivo não é enviado.
                  </p>
                )}
              </div>
            )}
          </div>
          <Field label="Submercado do contrato" hint={contractSub ? `correlação com ${sub}: ${crossRho !== null ? num(crossRho, 2) : "padrão 0,90"} (variações mensais do PLD)` : "Outro submercado: você fica com o spread"}>
            <Select value={subC} onChange={setSubC} options={[{ value: "mesmo" as const, label: `O mesmo (${sub})` }, ...SUBS.filter((s) => s !== sub).map((s) => ({ value: s, label: `${s} — ${SUB_NAMES[s]}` }))]} />
          </Field>
          <Field
            label="Preço do contrato (R$/MWh)"
            hint={
              inKwh(numIn(priceIn))
                ? `Lido como R$/kWh: ${brl(typed)}/MWh`
                : fairShown
                  ? `Vazio = PLD médio esperado (${brl(fairShown.flat)}); conforme a carga: ${brl(fairShown.loadInContractSub)}`
                  : undefined
            }
          >
            <input className={inputCls} inputMode="decimal" placeholder={fairShown ? num(fairShown.flat, 2) : ""} value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
          </Field>
          <Field label="Volume anual">
            <div className="flex gap-2">
              <Select
                value={volMode}
                onChange={setVolMode}
                options={[
                  { value: "otimo", label: "Ótimo" },
                  { value: "fixo", label: "Fixo (MWmed)" },
                ]}
              />
              {volMode === "fixo" ? <input className={inputCls} inputMode="decimal" placeholder={avg !== null ? num(avg, 2) : ""} value={volIn} onChange={(e) => setVolIn(e.target.value)} aria-label="Volume fixo (MWmed)" /> : null}
            </div>
          </Field>
          <Field label="Sazonalização" hint="Volume de cada mês, decidido antes do ano">
            <div className="flex gap-2">
              <Select
                value={season}
                onChange={setSeason}
                options={[
                  { value: "otima", label: "Ótima" },
                  { value: "carga", label: "Conforme a carga" },
                  { value: "flat", label: "Flat" },
                ]}
              />
              {season !== "flat" ? (
                <div className="flex w-28 shrink-0 items-center gap-1">
                  <span className="text-[13px] text-muted">±</span>
                  <input className={inputCls} inputMode="decimal" value={seasonLim} onChange={(e) => setSeasonLim(e.target.value)} aria-label="Limite da sazonalização (%)" />
                  <span className="text-[13px] text-muted">%</span>
                </div>
              ) : null}
            </div>
          </Field>
          <Field label="Flexibilidade mensal" hint={
              flexRule === "carga"
                ? "Volume tomado = consumo medido, dentro da faixa (padrão de mercado)"
                : "O comprador escolhe o volume dentro da faixa depois do mês: uma opção, que o vendedor cobra no preço"
            }>
            <div className="flex gap-2">
              <div className="flex w-28 shrink-0 items-center gap-1">
                <span className="text-[13px] text-muted">±</span>
                <input className={inputCls} inputMode="decimal" value={flexIn} onChange={(e) => setFlexIn(e.target.value)} aria-label="Flexibilidade mensal (%)" />
                <span className="text-[13px] text-muted">%</span>
              </div>
              <Select
                value={flexRule}
                onChange={setFlexRule}
                options={[
                  { value: "carga", label: "Pelo consumo" },
                  { value: "livre", label: "Livre (opção)" },
                ]}
              />
            </div>
          </Field>
          <Field label="Modulação" hint="Como o volume do mês se distribui nas horas">
            <Select
              value={modulation}
              onChange={setModulation}
              options={[
                { value: "flat", label: "Flat (igual em todas as horas)" },
                { value: "carga", label: "Conforme a carga" },
              ]}
            />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-2">Aversão a risco</span>
            <Segmented label="Aversão a risco" value={beta} onChange={setBeta} options={BETAS.map((b) => ({ value: b.value, label: b.label, title: "title" in b ? b.title : undefined }))} size="xs" />
          </div>
        </div>
        <div className="mt-3">
          <Disclosure
            title="Premissas de carga e de risco"
            hint={`incerteza ${num(unc.annual * 100, 0)}% no ano e ${num(unc.monthly * 100, 0)}% no mês · correlação com o preço ${num(unc.priceCorr, 2)} · perdas ${num(losses * 100, 1)}% · recuperação ${num(recovery * 100, 0)}%`}
          >
            <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-2 xl:grid-cols-5">
              <Field label="Incerteza do consumo no ano (σ, %)" hint="Choque comum a todos os meses: produção acima ou abaixo do previsto">
                <input className={inputCls} inputMode="decimal" value={uncA} onChange={(e) => setUncA(e.target.value)} />
              </Field>
              <Field label="Incerteza do consumo no mês (σ, %)" hint="Choque próprio de cada mês">
                <input className={inputCls} inputMode="decimal" value={uncM} onChange={(e) => setUncM(e.target.value)} />
              </Field>
              <Field label="Correlação consumo × preço (−1 a 1)" hint="Positiva se você consome mais quando a energia está cara (calor, irrigação no período seco); negativa se produz menos quando o preço sobe">
                <input className={inputCls} inputMode="decimal" value={corrIn} onChange={(e) => setCorrIn(e.target.value)} />
              </Field>
              <Field label="Perdas da rede básica (%)" hint="Rateio da CCEE sobre o consumo medido no seu ponto">
                <input className={inputCls} inputMode="decimal" value={lossIn} onChange={(e) => setLossIn(e.target.value)} />
              </Field>
              <Field label="Recuperação se a comercializadora quebrar (%)" hint="Parte da perda recuperada na liquidação dela">
                <input className={inputCls} inputMode="decimal" value={recIn} onChange={(e) => setRecIn(e.target.value)} />
              </Field>
            </div>
          </Disclosure>
        </div>
        <p role="status" aria-live="polite" className="mt-3 text-[12px] text-muted">
          {status}
        </p>
      </Panel>

      {!res ? (
        <Panel title="Calculando" subtitle="2.000 cenários de preço e de carga em cada hora dos próximos 12 meses">
          <div className="flex flex-col gap-2 py-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(100 * (st ? 1 : progress))}%` }} />
            </div>
            <p className="text-[13px] text-muted">{st ? "Otimizando volume e sazonalização…" : `Cenários hora a hora: ${pct(100 * progress, 0)}`}</p>
          </div>
        </Panel>
      ) : null}

      {res ? (
        <div aria-busy={stale} className={`flex flex-col gap-5 transition-opacity ${stale ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi
              label="Volume anual"
              value={res.opt.q}
              format={(v) => num(v, 2)}
              unit="MWmed"
              foot={avg ? `${pct((100 * res.opt.q) / avg, 0)} da carga média${res.atCap ? " (no limite da busca)" : ""}` : undefined}
            />
            <Kpi label="Custo esperado" value={res.opt.risk.mean} format={(v) => num(v, 2)} unit="R$/MWh" foot={`pior 5%: ${brl(res.opt.risk.cvar)}`} />
            {(["flex", "season"] as const).map((k) => (
              <Kpi
                key={k}
                label={k === "flex" ? "Valor da flexibilidade" : "Valor da sazonalização"}
                value={res.values[k].objective}
                format={(v) => num(v / 1000, 0)}
                unit="R$ mil/ano"
                detail={`Economia no seu objetivo, (1 − β) × custo esperado + β × CVaR 95%, frente à mesma estrutura ${k === "flex" ? "sem flexibilidade" : "com volume flat"}`}
                foot={`esperado ${kMoney(res.values[k].mean)} · pior 5% ${kMoney(res.values[k].cvar)}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Comparação de estruturas" subtitle="Custo por MWh consumido: esperado · pior 5% (CVaR 95%)">
              {res.comps.map((c, i) => (
                <MetricRow key={c.label} label={c.label} hint={c.hint} value={`${brl(c.r.mean)} · ${brl(c.r.cvar)}`} tone={i === res.comps.length - 1 ? undefined : "muted"} />
              ))}
              <MetricRow
                label="Vale pagar a mais pela flexibilidade"
                hint="até, no preço do contrato"
                value={res.contract.flex === 0 ? "contrato sem flexibilidade" : res.values.flex.premium > 0 ? `${brl(res.values.flex.premium)}/MWh` : "não compensa"}
                tone={res.values.flex.premium > 0 ? "good" : "muted"}
              />
              <MetricRow
                label="Vale pagar a mais pela sazonalização"
                hint="até, no preço do contrato"
                value={res.opt.shape.every((u) => Math.abs(u - 1) < 1e-9) ? "volume flat" : res.values.season.premium > 0 ? `${brl(res.values.season.premium)}/MWh` : "não compensa"}
                tone={res.values.season.premium > 0 ? "good" : "muted"}
              />
              <MetricRow label="PLD médio esperado (contrato flat)" value={brl(res.fair.flat)} tone="muted" />
              <MetricRow label="PLD esperado da sua carga" hint={`${res.fair.load - res.fair.flat >= 0 ? "+" : "−"}${brl(Math.abs(res.fair.load - res.fair.flat))} pelo perfil`} value={brl(res.fair.load)} tone="muted" />
              <MetricRow label="Correlação entre meses" hint={data.rho?.[sub] != null ? "implícita nos cenários do SDDP" : "padrão (sem cenários do SDDP)"} value={num(data.rho?.[sub] ?? 0.5, 2)} tone="muted" />
              <MetricRow
                label="Dias com dia equivalente no PLD real"
                hint="mesmo tipo de dia e mês, ~52 semanas antes"
                value={eqDays ? `${num(eqDays.equivalentes)} de ${num(eqDays.equivalentes + eqDays.semEquivalente)}` : "sem histórico horário"}
                tone="muted"
              />
            </Panel>
            <Panel title="Sazonalização e flexibilidade" subtitle="Volume de cada mês (barras), faixa da flexibilidade (sombra), carga esperada e PLD esperado (eixo da direita)">
              {seasonChart ? <EChart option={seasonChart} height={300} label="Sazonalização do contrato" /> : null}
            </Panel>
          </div>

          <Panel title="Mês a mês" subtitle="Valores esperados nos 2.000 cenários">
            <Table
              label="Contrato mês a mês"
              head={["Mês", res.subs.contract === res.subs.load ? "PLD esperado" : `PLD esperado (${res.subs.contract})`, "Carga esperada", "Volume sazonalizado", "Faixa", "Volume tomado", "Custo"]}
              align={["left", "right", "right", "right", "right", "right", "right"]}
              rows={res.table.map((r) => [
                monthLabel(r.mes),
                brl(r.pldContrato),
                `${num(r.carga, 3)} MWmed`,
                `${num(r.volume, 3)} MWmed`,
                `${num(r.min, 2)}–${num(r.max, 2)}`,
                `${num(r.tomado, 3)} MWmed`,
                `${brl(r.custoMwh)}/MWh`,
              ])}
            />
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Fronteira eficiente" subtitle="Cada ponto é um volume anual com a sazonalização escolhida: mais contrato troca custo esperado por menos risco">
              {frontierChart ? <EChart option={frontierChart} height={300} label="Fronteira eficiente da contratação" /> : null}
            </Panel>
            <Panel title="Distribuição do custo" subtitle="Custo por MWh consumido nos 2.000 cenários (tudo no PLD vai bem mais longe: veja a comparação)">
              {distChart ? <EChart option={distChart} height={300} label="Distribuição do custo da energia" /> : null}
            </Panel>
            <Panel title="Sua carga × o preço de cada hora" subtitle="O preço da sua carga difere do flat pelo quanto você consome nas horas caras (fim de tarde) ou baratas (meio-dia, sol)">
              {profileChart ? <EChart option={profileChart} height={280} label="Perfil horário da carga e do PLD" /> : null}
            </Panel>
            <div id="contraparte" className="scroll-mt-20">
              <Panel
                title="Se a comercializadora quebrar"
                subtitle="Perda ao recontratar o resto do contrato a preço de mercado se a contraparte falhar no início de cada mês (a linha tracejada é ficar no PLD até o fim)"
              >
                {expoChart ? <EChart option={expoChart} height={240} label="Exposição de contraparte por mês" /> : null}
                <MetricRow label="Maior exposição potencial (PFE 95%)" hint="garantia que cobre 95% dos cenários" value={money(peakPfe)} tone="warning" />
                <MetricRow label="Maior exposição esperada (EE)" value={money(peakEe)} />
                <MetricRow label="Sem recontratar, quebra no início" hint="o ano todo no PLD, 95% dos cenários" value={money(res.exposure[0]?.pfeSpot ?? null)} tone="muted" />
              </Panel>
            </div>
          </div>

          <div id="comparacao" className="scroll-mt-20">
            <Panel title="Mercado regulado × livre" subtitle="Só a parcela de energia: a TUSD (fio) é paga nos dois ambientes">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex flex-col gap-3">
                  <Field
                    label="Tarifa de energia regulada — TE (R$/MWh)"
                    hint={teKwh ? `Lida como R$/kWh: ${brl(teIn)}/MWh` : "Na conta ou na resolução da sua distribuidora, sem impostos e sem TUSD"}
                  >
                    <input className={inputCls} inputMode="decimal" value={te} onChange={(e) => setTe(e.target.value)} placeholder="ex.: 300" />
                  </Field>
                  <Field label="Bandeira média esperada">
                    <Select value={bandeira} onChange={setBandeira} options={(Object.keys(BANDEIRA_LABEL) as Bandeira[]).map((b) => ({ value: b, label: `${BANDEIRA_LABEL[b]} (+${brl(data.bandeiras[b])}/MWh)` }))} />
                  </Field>
                  <Field
                    label="Encargos no mercado livre (R$/MWh)"
                    hint={essPerMwh !== null && !encIn.trim() ? `Vazio = ESS estimado da última semana (${brl(essPerMwh)}). Some EER, CCEE e a taxa da varejista.` : "ESS, EER, contribuição à CCEE e taxa da varejista"}
                  >
                    <input className={inputCls} inputMode="decimal" value={encIn} onChange={(e) => setEncIn(e.target.value)} placeholder={essPerMwh !== null ? num(essPerMwh, 2) : "0"} />
                  </Field>
                </div>
                <div className="flex flex-col lg:col-span-2">
                  <MetricRow label="Energia esperada no ano" hint={losses ? "com perdas, no mercado livre" : undefined} value={`${num(res.energy, 0)} MWh`} tone="muted" />
                  <MetricRow label="Mercado regulado" hint="TE + bandeira" value={money(acr)} />
                  <MetricRow label="Mercado livre, esperado" hint="contrato + liquidação + encargos" value={money(acl)} />
                  <MetricRow label="Mercado livre, pior 5%" hint="CVaR 95%" value={money(aclBad)} tone="muted" />
                  <MetricRow
                    label="Economia esperada"
                    value={acr !== null && acl !== null ? `${money(acr - acl)} (${pct((100 * (acr - acl)) / acr, 1)})` : "informe a TE"}
                    tone={acr !== null && acl !== null ? (acr - acl >= 0 ? "good" : "critical") : "muted"}
                  />
                  <MetricRow label="Economia no pior 5%" value={acr !== null && aclBad !== null ? money(acr - aclBad) : "—"} tone={acr !== null && aclBad !== null ? (acr - aclBad >= 0 ? "good" : "warning") : "muted"} />
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    Energia incentivada (desconto na TUSD) e impostos ficam de fora dos dois lados. {SUB_NAMES[sub]}: faixas do planejamento de {data.plano?.asof ?? "—"}, dias equivalentes do PLD real.
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
