import { adf, engleGranger, halfLife } from "../quant/cointegration";
import { riskMetrics, type RiskMetrics } from "../quant/risk";
import { mean, round, std } from "../quant/stats";
import { optimizeStorageDP, valueStorageLSMC, type StorageSpec } from "../quant/storage";
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
  intrinsicRS: number;
  lsmcRS: number;
  lsmcStdErr: number;
  extrinsicRS: number;
  perfectForesightRS: number;
  risk: RiskMetrics;
  schedule: { ts: number; price: number; mw: number; soc: number }[];
  publishedTomorrow: { date: string; valueRS: number; spreadRS: number } | null;
  perMWDayRS: number;
  pnlHistogram: { from: number; to: number; count: number }[];
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

export function bessArbitrage(fc: ForecastInternal, spec: StorageSpec = DEFAULT_BESS): StorageResult {
  const prices = fc.horizon.lear;
  const dp = optimizeStorageDP(prices, spec);
  const half = Math.floor(fc.paths.length / 2);
  let lsmc = { value: dp.value, stdErr: 0, intrinsic: dp.value, extrinsic: 0, perfectForesight: dp.value, pnl: [dp.value] };
  if (half >= 50) lsmc = valueStorageLSMC(fc.paths.slice(0, half), fc.paths.slice(half), spec);
  const tomorrow = fc.publishedAhead[0];
  let publishedTomorrow: StorageResult["publishedTomorrow"] = null;
  if (tomorrow) {
    const r = optimizeStorageDP(tomorrow.prices, { ...spec, socEnd: spec.socInit });
    publishedTomorrow = { date: tomorrow.date, valueRS: r.value, spreadRS: Math.max(...tomorrow.prices) - Math.min(...tomorrow.prices) };
  }
  return {
    spec,
    horizonHours: prices.length,
    intrinsicRS: dp.value,
    lsmcRS: lsmc.value,
    lsmcStdErr: lsmc.stdErr,
    extrinsicRS: lsmc.value - dp.value,
    perfectForesightRS: lsmc.perfectForesight,
    risk: riskMetrics(lsmc.pnl),
    schedule: dp.schedule.slice(0, 72).map((s, i) => ({ ts: fc.horizon.ts[i], price: s.price, mw: s.gridMW, soc: s.soc })),
    publishedTomorrow,
    perMWDayRS: lsmc.value / spec.powerMW / (prices.length / 24),
    pnlHistogram: histogram(lsmc.pnl),
  };
}

// ---------------------------------------------------------------------------
// 3) Europa — bateria 1 MW/2 MWh por zona e valor de congestionamento (FTR)
// ---------------------------------------------------------------------------
function lastFullDay(ts: number[], values: number[]) {
  const byDay = new Map<string, { ts: number[]; v: number[] }>();
  ts.forEach((t, i) => {
    const d = new Date(t + 3600_000).toISOString().slice(0, 10); // ≈ dia de entrega CET
    const e = byDay.get(d) ?? { ts: [], v: [] };
    e.ts.push(t);
    e.v.push(values[i]);
    byDay.set(d, e);
  });
  const full = [...byDay.entries()].filter(([, e]) => e.v.length >= 23).sort(([a], [b]) => a.localeCompare(b));
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

export function euBattery(zones: ZonePrices): EuZoneArb[] {
  const out: EuZoneArb[] = [];
  for (const [bzn, z] of Object.entries(zones)) {
    const day = lastFullDay(z.ts, z.values);
    if (!day) continue;
    const dtH = day.ts.length > 1 ? (day.ts[1] - day.ts[0]) / 3600_000 : 1;
    const r = optimizeStorageDP(day.v, { capacityMWh: 2, powerMW: 1, etaCharge: 0.95, etaDischarge: 0.95, dtHours: dtH, socInit: 0, socEnd: 0, degradationCost: 5 });
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
