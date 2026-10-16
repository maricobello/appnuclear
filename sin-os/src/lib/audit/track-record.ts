import type { DayMatrix } from "../market/brazil";
import type { ForecastInternal } from "../market/forecast";
import { naiveForecast } from "../quant/lear";
import { mean, quantile } from "../quant/stats";

/**
 * Registro das previsões PUBLICADAS: o primeiro dia previsto pelo modelo, gravado na primeira vez
 * em que a previsão daquele dia sai, e conferido depois contra o PLD realizado. É a validação mais
 * direta que existe — o que a tela mostrou contra o que aconteceu, sem reconstruir nada.
 */
export interface LoggedForecast {
  /** Dia previsto (BRT). */
  date: string;
  issuedAt: number;
  /** Último dia observado quando a previsão saiu. */
  basedOn: string;
  point: number[];
  /** Banda horária publicada (ACI 90%). */
  lo: number[];
  hi: number[];
  /** Faixa publicada de 90% da média do dia. */
  dayLo: number;
  dayHi: number;
  /** Faixa 5–95% da média do dia nas trajetórias do Monte Carlo. */
  mcLo: number | null;
  mcHi: number | null;
}

export const TRACK_MIN_DAYS = 14;
export const TRACK_MAX_DAYS = 90;

const r2 = (v: number) => Math.round(v * 100) / 100;

export function snapshotForecast(fc: Pick<ForecastInternal, "firstForecastDate" | "generatedAt" | "lastObservedDate" | "horizon" | "paths">): LoggedForecast {
  const day = fc.horizon.dailyMean[0];
  const dms = fc.paths.length >= 50 ? fc.paths.map((p) => mean(p.slice(0, 24))) : [];
  return {
    date: fc.firstForecastDate,
    issuedAt: fc.generatedAt,
    basedOn: fc.lastObservedDate,
    point: fc.horizon.point.slice(0, 24).map(r2),
    lo: fc.horizon.aciLo.slice(0, 24).map(r2),
    hi: fc.horizon.aciHi.slice(0, 24).map(r2),
    dayLo: r2(day.p05),
    dayHi: r2(day.p95),
    mcLo: dms.length ? r2(quantile(dms, 0.05)) : null,
    mcHi: dms.length ? r2(quantile(dms, 0.95)) : null,
  };
}

/** Acrescenta a previsão do dia se ainda não houver uma (vale a primeira publicada), mantendo os últimos dias. */
export function appendLog(items: LoggedForecast[], entry: LoggedForecast, max = TRACK_MAX_DAYS): LoggedForecast[] | null {
  if (items.some((x) => x.date === entry.date)) return null;
  return [...items, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-max);
}

export interface TrackRecord {
  /** Dias com previsão registrada e PLD realizado completo (não interpolado). */
  days: number;
  from: string | null;
  to: string | null;
  /** MAE das previsões publicadas e do ingênuo nos mesmos dias (R$/MWh) e a razão. */
  mae: number | null;
  maeNaive: number | null;
  rmae: number | null;
  /** Cobertura da banda horária, da faixa da média do dia e da faixa do Monte Carlo. */
  hourCoverage: number | null;
  dayCoverage: number | null;
  mcDayCoverage: number | null;
}

// no piso a média de 24 valores iguais sai 57,309999… por arredondamento
const EPS = 1e-6;
const inside = (v: number, lo: number, hi: number) => v >= lo - EPS && v <= hi + EPS;

export function evaluateTrackRecord(items: LoggedForecast[], dm: DayMatrix): TrackRecord {
  const at = new Map(dm.dates.map((d, i) => [d, i]));
  const imputed = new Set(dm.imputed);
  let hours = 0, hitH = 0, hitD = 0, nMc = 0, hitMc = 0, errM = 0, errN = 0;
  const used: string[] = [];
  for (const x of items) {
    const i = at.get(x.date);
    if (i === undefined || i < 7 || imputed.has(x.date) || x.point.length !== 24) continue;
    const a = dm.rows[i];
    const nv = naiveForecast(dm.rows.slice(0, i), dm.dows[i]);
    for (let h = 0; h < 24; h++) {
      errM += Math.abs(a[h] - x.point[h]);
      errN += Math.abs(a[h] - nv[h]);
      hitH += inside(a[h], x.lo[h], x.hi[h]) ? 1 : 0;
      hours++;
    }
    const am = mean(a);
    hitD += inside(am, x.dayLo, x.dayHi) ? 1 : 0;
    if (x.mcLo !== null && x.mcHi !== null) {
      nMc++;
      hitMc += inside(am, x.mcLo, x.mcHi) ? 1 : 0;
    }
    used.push(x.date);
  }
  const n = used.length;
  return {
    days: n,
    from: used[0] ?? null,
    to: used[n - 1] ?? null,
    mae: hours ? errM / hours : null,
    maeNaive: hours ? errN / hours : null,
    rmae: hours && errN > 0 ? errM / errN : null,
    hourCoverage: hours ? hitH / hours : null,
    dayCoverage: n ? hitD / n : null,
    mcDayCoverage: nMc ? hitMc / nMc : null,
  };
}
