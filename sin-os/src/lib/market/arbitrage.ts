import { adf, engleGranger, halfLife } from "../quant/cointegration";
import { riskMetrics, type RiskMetrics } from "../quant/risk";
import { mean, round, std } from "../quant/stats";
import { naiveDayValue, optimizeStorageLP } from "../quant/bess";
import { valueStorageLSMC, type StorageSpec } from "../quant/storage";
import type { ZonePrices } from "../sources/europe";
import type { FxData } from "../sources/fx";
import { brtDate } from "../sources/time";
import { SUBS, type Sub, type SubPanel, type TimeSeries } from "../sources/types";
import type { ForecastInternal } from "./forecast";

// ---------------------------------------------------------------------------
// 1) Espacial — spreads entre submercados do SIN
// ---------------------------------------------------------------------------
export interface SpreadStat {
  a: Sub;
  b: Sub;
  current: number | null;
  mean: number;
  sd: number;
  z: number | null;
  decoupledPct: number;
  halfLifeH: number | null;
  adfP: number | null;
  cointegrated: boolean | null;
  hedgeRatio: number | null;
  signal: string;
  series: number[];
  seriesTs: number[];
}

export function submarketSpreads(panel: SubPanel, days = 30): SpreadStat[] {
  const now = Date.now();
  const idx = panel.ts.map((t, i) => [t, i] as const).filter(([t]) => t <= now && t > now - days * 86400_000).map(([, i]) => i);
  const pairs: [Sub, Sub][] = [["SE", "S"], ["SE", "NE"], ["SE", "N"], ["S", "NE"], ["NE", "N"], ["S", "N"]];
  return pairs.map(([a, b]) => {
    const xa: number[] = [];
    const xb: number[] = [];
    const ts: number[] = [];
    for (const i of idx) {
      const va = panel.values[a][i];
      const vb = panel.values[b][i];
      if (va !== null && vb !== null) { xa.push(va); xb.push(vb); ts.push(panel.ts[i]); }
    }
    const s = xa.map((v, i) => v - xb[i]);
    const m = mean(s);
    const sd = std(s);
    const current = s.length ? s[s.length - 1] : null;
    const decoupledPct = s.length ? (100 * s.filter((v) => Math.abs(v) > 1).length) / s.length : 0;
    const base: SpreadStat = {
      a, b, current, mean: m, sd, z: null, decoupledPct, halfLifeH: null, adfP: null, cointegrated: null, hedgeRatio: null,
      signal: "Acoplados", series: s.slice(-168).map((v) => round(v)), seriesTs: ts.slice(-168),
    };
    if (s.length < 48 || !(sd > 1e-6)) return base;
    const z = current !== null ? (current - m) / sd : null;
    let hl: number | null = null, adfP: number | null = null, coint: boolean | null = null, hedge: number | null = null;
    try { hl = halfLife(s); } catch { /* série degenerada */ }
    try { adfP = adf(s).pValue; } catch { /* idem */ }
    try {
      const eg = engleGranger(xa, xb);
      coint = eg.cointegrated5;
      hedge = eg.hedgeRatio;
    } catch { /* idem */ }
    let signal = "Monitorar";
    if (decoupledPct < 3) signal = "Acoplados";
    else if (z !== null && Math.abs(z) > 2 && hl !== null && hl < 48) signal = z > 0 ? `Spread alto: reversão esperada (${a} → ${b})` : `Spread baixo: reversão esperada (${b} → ${a})`;
    else if (adfP !== null && adfP > 0.1) signal = "Spread não estacionário: risco de submercado persistente";
    return { ...base, z, halfLifeH: hl !== null && Number.isFinite(hl) ? hl : null, adfP, cointegrated: coint, hedgeRatio: hedge, signal };
  });
}

// ---------------------------------------------------------------------------
// 2) Temporal — armazenamento (bateria BESS) no PLD
// ---------------------------------------------------------------------------
export const DEFAULT_BESS: StorageSpec = {
  capacityMWh: 120,
  powerMW: 30,
  etaCharge: 0.938,
  etaDischarge: 0.938, // ~88% ida-e-volta
  socInit: 0.5,
  degradationCost: 20, // R$/MWh movimentado
};

export interface StorageResult {
  spec: StorageSpec;
  horizonHours: number;
  /** Intrínseco EXATO (LP/HiGHS) na curva a termo = E[preço] das trajetórias. */
  intrinsicRS: number;
  /** Intrínseco exato + opcionalidade (LSMC). */
  lsmcRS: number;
  lsmcStdErr: number;
  /** LSMC − intrínseco na mesma grade e na mesma distribuição (viés de grade se cancela). */
  extrinsicRS: number;
  /** Média do ótimo exato (LP) trajetória a trajetória — teto teórico. */
  perfectForesightRS: number;
  risk: RiskMetrics;
  schedule: { ts: number; price: number; mw: number; soc: number }[];
  publishedTomorrow: {
    date: string;
    valueRS: number;
    cashRS: number;
    endSoc: number;
    spreadRS: number;
    schedule: { h: number; price: number; mw: number; soc: number }[];
  } | null;
  perMWDayRS: number;
  pnlHistogram: { from: number; to: number; count: number }[];
  solver: string;
  /**
   * Backtest ex-post sobre o PLD REALIZADO recente: teto de informação perfeita por dia
   * (LP) e uma política simples de limiar; capture = política / teto. Mostra o que uma
   * bateria teria capturado de fato — não é P&L transacionável (ver aviso na tela).
   */
  realized: { days: number; perMWDayRS: number; naivePerMWDayRS: number; captureRatio: number | null } | null;
  /** Diagnósticos de consistência numérica (ex.: LSMC abaixo do intrínseco na grade). */
  notes: string[];
}


function histogram(v: number[], bins = 24): StorageResult["pnlHistogram"] {
  if (v.length < 2) return [];
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const w = (hi - lo) / bins || 1;
  const counts = new Array<number>(bins).fill(0);
  for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  return counts.map((count, i) => ({ from: lo + i * w, to: lo + (i + 1) * w, count }));
}

/**
 * Valor de continuação V(e) da energia deixada no fim de amanhã: ótimo exato na curva
 * prevista dos dias seguintes para 5 níveis de SoC inicial. É côncavo em e (valor ótimo
 * de LP em função do lado direito), então vira segmentos de valor marginal decrescente.
 */
async function continuationValue(curve: number[], spec: StorageSpec): Promise<{ mwh: number; value: number }[]> {
  const levels = [0, 0.25, 0.5, 0.75, 1];
  const W = await Promise.all(levels.map((f) => optimizeStorageLP(curve, { ...spec, socInit: f, socEnd: spec.socInit ?? 0.5 }).then((r) => r.value)));
  const seg = spec.capacityMWh / (levels.length - 1);
  let prev = Infinity;
  return levels.slice(1).map((_, k) => {
    const v = Math.min(prev, (W[k + 1] - W[k]) / seg); // concavidade (ruído numérico)
    prev = v;
    return { mwh: seg, value: v };
  });
}

export async function bessArbitrage(fc: ForecastInternal, spec: StorageSpec = DEFAULT_BESS): Promise<StorageResult> {
  const half = Math.floor(fc.paths.length / 2);
  const mc = half >= 50;
  // curva a termo = E[preço]: o LEAR é ajustado em asinh e estima a MEDIANA; o valor
  // esperado de um despacho linear depende da média (desigualdade de Jensen)
  const curve = mc ? fc.horizon.point.map((_, t) => mean(fc.paths.map((p) => p[t]))) : fc.horizon.point.slice();
  const lp = await optimizeStorageLP(curve, spec);

  let extrinsic = 0, stdErr = 0, pf = lp.value;
  const notes: string[] = [];
  let pnl = [lp.value];
  if (mc) {
    const lsmc = valueStorageLSMC(fc.paths.slice(0, half), fc.paths.slice(half), spec);
    const rawExtrinsic = lsmc.value - lsmc.intrinsic;
    extrinsic = Math.max(0, rawExtrinsic);
    if (rawExtrinsic < -2 * lsmc.stdErr) {
      notes.push(`LSMC ficou ${rawExtrinsic.toFixed(0)} R$ abaixo do intrínseco na grade de SoC (erro de grade/amostra); a opcionalidade é mostrada como 0.`);
    }
    stdErr = lsmc.stdErr;
    // P&L da política LSMC, deslocado pelo viés da grade medido na curva média
    pnl = lsmc.pnl.map((v) => v + (lp.value - lsmc.intrinsic));
    const pfPaths = fc.paths.slice(half, half + 200);
    const pfVals: number[] = [];
    for (const p of pfPaths) pfVals.push((await optimizeStorageLP(p, spec)).value);
    pf = mean(pfVals);
    if (pf < lp.value + extrinsic) notes.push("Teto de informação perfeita (média de 200 trajetórias) ficou abaixo do valor com opcionalidade; o teto exibido é o maior dos dois.");
  }

  const tomorrow = fc.publishedAhead[0];
  let publishedTomorrow: StorageResult["publishedTomorrow"] = null;
  if (tomorrow) {
    // rolling intrinsic: despacho exato de amanhã (preço publicado) com o SoC final
    // valorizado pela previsão dos dias seguintes
    const tv = await continuationValue(curve, spec);
    const r = await optimizeStorageLP(tomorrow.prices, { ...spec, socEnd: 0 }, { terminalValue: tv });
    const vAt = (e: number) => {
      let left = e, v = 0;
      for (const s of tv) { const x = Math.min(left, s.mwh); v += x * s.value; left -= x; }
      return v;
    };
    const e0 = (spec.socInit ?? 0.5) * spec.capacityMWh;
    const eT = r.soc[r.soc.length - 1] * spec.capacityMWh;
    const cash = r.revenue - r.degradation;
    publishedTomorrow = {
      date: tomorrow.date,
      valueRS: cash + vAt(eT) - vAt(e0),
      cashRS: cash,
      endSoc: r.soc[r.soc.length - 1],
      spreadRS: Math.max(...tomorrow.prices) - Math.min(...tomorrow.prices),
      schedule: tomorrow.prices.map((price, h) => ({ h, price, mw: r.dischargeMW[h] - r.chargeMW[h], soc: r.soc[h] })),
    };
  }
  // coerência do Monte Carlo com o PLD real: variação intradiária Σ|p_{h+1} − p_h| mediana
  // das trajetórias (D+1) contra a dos últimos dias reais — se o MC oscila mais que o real,
  // a opcionalidade (LSMC) e o teto por trajetória saem otimistas
  if (mc && (fc.realizedDaily?.length ?? 0) >= 7) {
    const tv = (a: number[]) => a.slice(1).reduce((s, v, h) => s + Math.abs(v - a[h]), 0);
    const med = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const tvReal = med(fc.realizedDaily.filter((d) => d.length === 24).map(tv));
    const tvSim = med(fc.paths.map((p) => tv(p.slice(0, 24))));
    if (tvReal > 0 && tvSim > 1.15 * tvReal) {
      notes.push(`As trajetórias oscilam ${(tvSim / tvReal).toFixed(1).replace(".", ",")}× mais dentro do dia que o PLD real dos últimos dias: a opcionalidade e o teto por trajetória tendem a sair otimistas — use o intrínseco e o backtest realizado como referência.`);
    }
  }
  // backtest ex-post no PLD realizado: teto (informação perfeita) vs. política ingênua
  let realized: StorageResult["realized"] = null;
  const days = (fc.realizedDaily ?? []).filter((d) => d.length === 24);
  if (days.length >= 5) {
    // arbitragem intradiária pura: começa e termina vazia (mesmo enquadramento para teto e ingênua)
    const daySpec = { ...spec, dtHours: 1, socInit: 0, socEnd: 0 };
    let pfSum = 0, naiveSum = 0;
    for (const d of days) {
      pfSum += Math.max(0, (await optimizeStorageLP(d, daySpec)).value);
      // regra explícita da política simples: não opera no dia se o caixa seria < 0 (decisão
      // implementável — o PLD de D+1 é publicado na véspera)
      naiveSum += Math.max(0, naiveDayValue(d, daySpec));
    }
    const perMW = pfSum / days.length / spec.powerMW;
    const naivePerMW = naiveSum / days.length / spec.powerMW;
    // PLD quase plano (teto < 1 R$/MW·dia): a razão não tem significado ⇒ n/d
    realized = { days: days.length, perMWDayRS: perMW, naivePerMWDayRS: naivePerMW, captureRatio: perMW >= 1 ? Math.min(1, naivePerMW / perMW) : null };
  }
  const total = lp.value + extrinsic;
  return {
    spec,
    horizonHours: curve.length,
    intrinsicRS: lp.value,
    lsmcRS: total,
    lsmcStdErr: stdErr,
    extrinsicRS: extrinsic,
    perfectForesightRS: Math.max(pf, total),
    risk: riskMetrics(pnl),
    schedule: curve.slice(0, 72).map((price, i) => ({ ts: fc.horizon.ts[i], price, mw: lp.dischargeMW[i] - lp.chargeMW[i], soc: lp.soc[i] })),
    publishedTomorrow,
    perMWDayRS: total / spec.powerMW / (curve.length / 24),
    pnlHistogram: histogram(pnl),
    solver: `HiGHS ${lp.mip ? "MILP" : "LP"} (exato) + LSMC em grade`,
    realized,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 3) Europa — bateria 1 MW/2 MWh por zona e valor de congestionamento (FTR)
// ---------------------------------------------------------------------------
// dia de entrega do SDAC no horário de Bruxelas (CET/CEST — muda no horário de verão)
const cetDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" });

function lastFullDay(ts: number[], values: number[]) {
  const byDay = new Map<string, { ts: number[]; v: number[] }>();
  ts.forEach((t, i) => {
    const d = cetDay.format(t);
    const e = byDay.get(d) ?? { ts: [], v: [] };
    e.ts.push(t);
    e.v.push(values[i]);
    byDay.set(d, e);
  });
  const hoursOf = (e: { ts: number[] }) => (e.ts.length > 1 ? (e.ts.length * (e.ts[1] - e.ts[0])) / 3600_000 : 0);
  const full = [...byDay.entries()].filter(([, e]) => hoursOf(e) >= 23).sort(([a], [b]) => a.localeCompare(b));
  const last = full[full.length - 1];
  return last ? { date: last[0], ...last[1] } : null;
}

export interface EuZoneArb {
  bzn: string;
  name: string;
  date: string;
  avg: number;
  min: number;
  max: number;
  negativeHours: number;
  bessEurPerMWDay: number;
  resolutionMin: number;
}

/** Bateria 1 MW / 2 MWh por zona no último dia completo — ótimo exato (MILP se houver preço negativo). */
export async function euBattery(zones: ZonePrices): Promise<EuZoneArb[]> {
  const out: EuZoneArb[] = [];
  for (const [bzn, z] of Object.entries(zones)) {
    const day = lastFullDay(z.ts, z.values);
    if (!day) continue;
    const dtH = day.ts.length > 1 ? (day.ts[1] - day.ts[0]) / 3600_000 : 1;
    const r = await optimizeStorageLP(day.v, { capacityMWh: 2, powerMW: 1, etaCharge: 0.95, etaDischarge: 0.95, dtHours: dtH, socInit: 0, socEnd: 0, degradationCost: 5 });
    out.push({
      bzn,
      name: z.name,
      date: day.date,
      avg: mean(day.v),
      min: Math.min(...day.v),
      max: Math.max(...day.v),
      negativeHours: (day.v.filter((v) => v < 0).length * dtH),
      bessEurPerMWDay: r.value,
      resolutionMin: Math.round(dtH * 60),
    });
  }
  return out.sort((a, b) => b.bessEurPerMWDay - a.bessEurPerMWDay);
}

export interface BorderSpread {
  from: string;
  to: string;
  date: string;
  avgSpread: number;
  ftrFromTo: number; // EUR/MW·dia — Σ max(p_to − p_from, 0)·dt
  ftrToFrom: number;
  congestedPct: number;
}

const BORDERS: [string, string][] = [
  ["FR", "DE-LU"], ["DE-LU", "NL"], ["DE-LU", "PL"], ["DE-LU", "AT"], ["DE-LU", "DK1"], ["NO2", "DE-LU"],
  ["SE4", "DE-LU"], ["FR", "ES"], ["FR", "IT-North"], ["CH", "IT-North"], ["FR", "BE"], ["NL", "BE"],
];

export function euBorders(zones: ZonePrices): BorderSpread[] {
  const out: BorderSpread[] = [];
  for (const [a, b] of BORDERS) {
    const za = zones[a], zb = zones[b];
    if (!za || !zb) continue;
    const da = lastFullDay(za.ts, za.values);
    if (!da) continue;
    const mb = new Map(zb.ts.map((t, i) => [t, zb.values[i]]));
    const pairs = da.ts.map((t, i) => [da.v[i], mb.get(t)] as const).filter((p): p is readonly [number, number] => p[1] !== undefined);
    if (pairs.length < 20) continue;
    const dtH = da.ts.length > 1 ? (da.ts[1] - da.ts[0]) / 3600_000 : 1;
    const spreads = pairs.map(([pa, pb]) => pb - pa);
    out.push({
      from: a,
      to: b,
      date: da.date,
      avgSpread: mean(spreads),
      ftrFromTo: spreads.reduce((s, v) => s + Math.max(v, 0) * dtH, 0),
      ftrToFrom: spreads.reduce((s, v) => s + Math.max(-v, 0) * dtH, 0),
      congestedPct: (100 * spreads.filter((v) => Math.abs(v) > 0.5).length) / spreads.length,
    });
  }
  return out.sort((x, y) => Math.max(y.ftrFromTo, y.ftrToFrom) - Math.max(x.ftrFromTo, x.ftrToFrom));
}

// ---------------------------------------------------------------------------
// 4) Lente global — preço médio do dia em R$/MWh
// ---------------------------------------------------------------------------
export interface GlobalLens {
  market: string;
  region: string;
  localAvg: number;
  unit: string;
  brlAvg: number;
  vsSE: number;
}

export function globalLens(pld: SubPanel, zones: ZonePrices | null, ukMid: TimeSeries | null, fx: FxData | null): GlobalLens[] {
  const today = brtDate(Date.now());
  const idx = pld.ts.map((t, i) => [t, i] as const).filter(([t]) => brtDate(t) === today).map(([, i]) => i);
  const se = mean(idx.map((i) => pld.values.SE[i]).filter((v): v is number => v !== null));
  const out: GlobalLens[] = SUBS.map((s) => {
    const v = mean(idx.map((i) => pld.values[s][i]).filter((x): x is number => x !== null));
    return { market: `PLD ${s}`, region: "BR", localAvg: v, unit: "R$/MWh", brlAvg: v, vsSE: v - se };
  });
  if (fx && zones) {
    for (const bzn of ["DE-LU", "FR", "NO2", "ES", "IT-North", "PL"]) {
      const z = zones[bzn];
      if (!z) continue;
      const day = lastFullDay(z.ts, z.values);
      if (!day) continue;
      const v = mean(day.v);
      out.push({ market: `${z.name} (${bzn})`, region: "EU", localAvg: v, unit: "EUR/MWh", brlAvg: v * fx.EUR.rate, vsSE: v * fx.EUR.rate - se });
    }
  }
  if (fx && ukMid && ukMid.values.length) {
    const v = mean(ukMid.values.slice(-48));
    out.push({ market: "Reino Unido (MID)", region: "UK", localAvg: v, unit: "GBP/MWh", brlAvg: v * fx.GBP.rate, vsSE: v * fx.GBP.rate - se });
  }
  return out.filter((r) => Number.isFinite(r.brlAvg));
}
