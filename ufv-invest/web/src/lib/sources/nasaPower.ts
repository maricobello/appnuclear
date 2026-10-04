/**
 * NASA POWER (https://power.larc.nasa.gov/docs/services/api/) — recurso solar do local.
 *
 *  1. Climatologia mensal (community RE ⇒ irradiação em kWh/m²/dia): GHI, difusa, T2M, máx/mín, vento.
 *  2. Série mensal 2001..último ano completo de ALLSKY_SFC_SW_DWN ⇒ totais anuais (Σ média diária ×
 *     dias do mês), coeficiente de variação interanual e `annualSeries`.
 *
 * Valores −999 (fill value) são tratados como ausentes. Qualquer falha cai em `plant.fallbackClimate`
 * com `status: "fallback"`; cada consulta tem a sua procedência.
 */
import { z } from "zod";
import type { MonthlyClimate, Plant, Provenance, SolarResource } from "@/lib/types";
import { CLIMATE_FALLBACK_URL } from "./defaults";
import {
  DAY_SEC,
  SourceError,
  describeError,
  fetchJson,
  joinNotes,
  provenance,
  provenanceFromResult,
  warnSource,
  type FetchJsonResult,
  type SourceOptions,
} from "./http";
import {
  DAYS_IN_MONTH,
  cleanFill,
  coefficientOfVariationPct,
  dailyIrradiationFactorToKWh,
  daysInMonth,
  fmtCoord,
  isLeapYear,
  mean,
  round,
} from "./units";

const POWER_BASE = "https://power.larc.nasa.gov/api/temporal";
export const NASA_REVALIDATE_SEC = 7 * DAY_SEC;
const NASA_TIMEOUT_MS = 10_000;
/** primeiro ano da série interanual (início da climatologia CERES/MERRA-2 2001–2020) */
export const NASA_SERIES_START_YEAR = 2001;
/** mínimo de anos válidos para estimar o CV interanual */
const MIN_YEARS_FOR_CV = 5;

const MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const CLIMATOLOGY_PARAMS = ["ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DIFF", "T2M", "T2M_MAX", "T2M_MIN", "WS2M"];

export function nasaClimatologyUrl(lat: number, lon: number): string {
  return (
    `${POWER_BASE}/climatology/point?parameters=${CLIMATOLOGY_PARAMS.join(",")}` +
    `&community=RE&longitude=${fmtCoord(lon)}&latitude=${fmtCoord(lat)}&format=JSON`
  );
}

export function nasaMonthlyUrl(lat: number, lon: number, startYear: number, endYear: number): string {
  return (
    `${POWER_BASE}/monthly/point?parameters=ALLSKY_SFC_SW_DWN&community=RE` +
    `&longitude=${fmtCoord(lon)}&latitude=${fmtCoord(lat)}&start=${startYear}&end=${endYear}&format=JSON`
  );
}

// ─── Esquema (tolerante: só exige o que usamos) ─────────────────────────────────────────────

const powerValue = z.union([z.number(), z.string(), z.null()]);
export const powerResponseSchema = z.looseObject({
  properties: z.looseObject({
    parameter: z.record(z.string(), z.record(z.string(), powerValue)),
  }),
  header: z.record(z.string(), z.unknown()).optional().catch(undefined),
  parameters: z.record(z.string(), z.unknown()).optional().catch(undefined),
});
export type PowerResponse = z.infer<typeof powerResponseSchema>;

function fillValue(json: PowerResponse): number {
  const f = json.header?.fill_value;
  return typeof f === "number" && Number.isFinite(f) ? f : -999;
}

function unitsOf(json: PowerResponse, param: string): string | undefined {
  const meta = json.parameters?.[param];
  const u = meta && typeof meta === "object" ? (meta as { units?: unknown }).units : undefined;
  return typeof u === "string" ? u : undefined;
}

/** Período "AAAA–AAAA" a partir de header.start/end ou do texto de header.range */
function periodOf(json: PowerResponse): string | undefined {
  const h = json.header ?? {};
  const year = (v: unknown) => (typeof v === "string" || typeof v === "number" ? /^(\d{4})/.exec(String(v))?.[1] : undefined);
  const s = year(h.start);
  const e = year(h.end);
  if (s && e) return `${s}–${e}`;
  if (typeof h.range === "string") {
    const ys = h.range.match(/\b(19|20)\d{2}\b/g);
    if (ys && ys.length >= 2) return `${ys[0]}–${ys[ys.length - 1]}`;
  }
  return undefined;
}

/** 12 valores mensais (JAN..DEC) ou undefined se faltar algum (−999, null, texto inválido) */
function monthly12(values: Record<string, unknown> | undefined, fill: number, factor = 1, digits = 3): number[] | undefined {
  if (!values) return undefined;
  const out: number[] = [];
  for (const k of MONTH_KEYS) {
    const v = cleanFill(values[k], fill);
    if (v === undefined) return undefined;
    out.push(round(v * factor, digits));
  }
  return out;
}

export interface ParsedClimatology {
  monthly: MonthlyClimate;
  period?: string;
  notes: string[];
}

/**
 * Converte a resposta da climatologia em `MonthlyClimate`. Exige GHI completo e na faixa
 * plausível (0–12 kWh/m²/dia); sem T2M completo usa a temperatura do fallback (anotado);
 * parâmetros opcionais incompletos são omitidos.
 */
export function parseClimatology(json: PowerResponse, fallback: MonthlyClimate): ParsedClimatology {
  const fill = fillValue(json);
  const P = json.properties.parameter;
  const notes: string[] = [];
  const ghiFactor = dailyIrradiationFactorToKWh(unitsOf(json, "ALLSKY_SFC_SW_DWN"));
  const ghi = monthly12(P.ALLSKY_SFC_SW_DWN, fill, ghiFactor);
  if (!ghi) throw new SourceError("schema", "ALLSKY_SFC_SW_DWN ausente ou com valor de preenchimento (−999)");
  if (ghi.some((v) => v <= 0 || v > 12)) throw new SourceError("schema", "GHI fora da faixa plausível (0–12 kWh/m²/dia)");

  let tempC = monthly12(P.T2M, fill, 1, 2);
  if (!tempC) {
    tempC = fallback.tempC;
    notes.push("T2M ausente (−999): temperatura média do fallback embarcado");
  }
  const dhi = monthly12(P.ALLSKY_SFC_SW_DIFF, fill, dailyIrradiationFactorToKWh(unitsOf(json, "ALLSKY_SFC_SW_DIFF")));
  const tempMaxC = monthly12(P.T2M_MAX, fill, 1, 2);
  const tempMinC = monthly12(P.T2M_MIN, fill, 1, 2);
  const windMs = monthly12(P.WS2M, fill, 1, 2);
  const omitted = [!dhi && "difusa", !tempMaxC && "T máx", !tempMinC && "T mín", !windMs && "vento"].filter(Boolean);
  if (omitted.length) notes.push(`sem dado completo para: ${omitted.join(", ")}`);

  return {
    monthly: {
      ghiKWhM2Day: ghi,
      ...(dhi ? { dhiKWhM2Day: dhi } : {}),
      tempC,
      ...(tempMaxC ? { tempMaxC } : {}),
      ...(tempMinC ? { tempMinC } : {}),
      ...(windMs ? { windMs } : {}),
    },
    period: periodOf(json),
    notes,
  };
}

/**
 * Totais anuais de GHI (kWh/m²/ano) a partir da série mensal: chaves "AAAAMM", mês 13 = média anual.
 * Ano com os 12 meses válidos ⇒ Σ média diária × dias do mês (bissexto considerado). Ano sem
 * nenhum mês mas com o mês 13 ⇒ média anual × dias do ano. Ano com meses faltando ⇒ descartado.
 */
export function parseMonthlySeries(json: PowerResponse): { year: number; ghiKWhM2: number }[] {
  const values = json.properties.parameter.ALLSKY_SFC_SW_DWN;
  if (!values) throw new SourceError("schema", "ALLSKY_SFC_SW_DWN ausente na série mensal");
  const fill = fillValue(json);
  const factor = dailyIrradiationFactorToKWh(unitsOf(json, "ALLSKY_SFC_SW_DWN"));
  const byYear = new Map<number, { months: (number | undefined)[]; seen: number; annual?: number }>();
  for (const [key, raw] of Object.entries(values)) {
    const m = /^(\d{4})(\d{2})$/.exec(key);
    if (!m) continue;
    const year = Number(m[1]);
    const mo = Number(m[2]);
    const y = byYear.get(year) ?? { months: new Array<number | undefined>(12).fill(undefined), seen: 0 };
    byYear.set(year, y);
    const v = cleanFill(raw, fill);
    if (mo >= 1 && mo <= 12) {
      y.seen++;
      y.months[mo - 1] = v === undefined ? undefined : v * factor;
    } else if (mo === 13 && v !== undefined) {
      y.annual = v * factor;
    }
  }
  const out: { year: number; ghiKWhM2: number }[] = [];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const y = byYear.get(year)!;
    let total: number | undefined;
    if (y.months.every((v) => v !== undefined && v > 0)) {
      total = y.months.reduce<number>((acc, v, i) => acc + v! * daysInMonth(year, i), 0);
    } else if (y.seen === 0 && y.annual !== undefined && y.annual > 0) {
      total = y.annual * (isLeapYear(year) ? 366 : 365);
    }
    if (total !== undefined) out.push({ year, ghiKWhM2: round(total, 1) });
  }
  return out;
}

/** CV interanual (%) da irradiação anual; exige ≥ 5 anos */
export function interannualCvPct(series: { ghiKWhM2: number }[]): number {
  if (series.length < MIN_YEARS_FOR_CV) {
    throw new SourceError("schema", `série com ${series.length} anos válidos (mínimo ${MIN_YEARS_FOR_CV})`);
  }
  return round(coefficientOfVariationPct(series.map((s) => s.ghiKWhM2)), 2);
}

/** Irradiação anual (kWh/m²) a partir das médias diárias mensais × dias de cada mês (ano de 365 dias) */
export function annualFromMonthly(ghiKWhM2Day: number[]): number {
  return round(
    ghiKWhM2Day.reduce((acc, v, i) => acc + v * DAYS_IN_MONTH[i], 0),
    1,
  );
}

// ─── Função pública ─────────────────────────────────────────────────────────────────────────

const NAME_CLIM = "NASA POWER — climatologia mensal";
const NAME_SERIES = "NASA POWER — série mensal de GHI (variabilidade interanual)";

async function fetchPower(url: string, opts: SourceOptions): Promise<FetchJsonResult<PowerResponse>> {
  return fetchJson(url, powerResponseSchema, { timeoutMs: NASA_TIMEOUT_MS, revalidateSec: NASA_REVALIDATE_SEC, ...opts });
}

async function loadSeries(
  plant: Plant,
  endYear: number,
  opts: SourceOptions,
): Promise<{ series: { year: number; ghiKWhM2: number }[]; cvPct: number; prov: Provenance }> {
  const { lat, lon } = plant.location;
  let url = nasaMonthlyUrl(lat, lon, NASA_SERIES_START_YEAR, endYear);
  let res: FetchJsonResult<PowerResponse>;
  try {
    res = await fetchPower(url, opts);
  } catch (e) {
    // o último ano pode ainda não estar processado (HTTP 422/400) ⇒ tenta um ano antes
    if (!(e instanceof SourceError && e.isClientError)) throw e;
    url = nasaMonthlyUrl(lat, lon, NASA_SERIES_START_YEAR, endYear - 1);
    res = await fetchPower(url, opts);
  }
  const series = parseMonthlySeries(res.data);
  const cvPct = interannualCvPct(series);
  const first = series[0].year;
  const last = series[series.length - 1].year;
  const avg = round(mean(series.map((s) => s.ghiKWhM2)), 0);
  const prov = provenanceFromResult(
    "nasa-power-monthly",
    `${NAME_SERIES} ${first}–${last}`,
    res,
    `${series.length} anos; média ${avg} kWh/m²/ano; CV ${cvPct.toFixed(2)} %`,
  );
  return { series, cvPct, prov };
}

export async function getSolarResource(plant: Plant, opts: SourceOptions = {}): Promise<SolarResource> {
  const { lat, lon } = plant.location;
  const fb = plant.fallbackClimate;
  const nowDate = opts.now ? opts.now() : new Date();
  const nowIso = nowDate.toISOString();
  const endYear = nowDate.getUTCFullYear() - 1; // último ano completo
  const climUrl = nasaClimatologyUrl(lat, lon);

  const [climR, seriesR] = await Promise.allSettled([
    fetchPower(climUrl, opts).then((res) => ({ res, parsed: parseClimatology(res.data, fb) })),
    loadSeries(plant, endYear, opts),
  ]);

  const fallbackMonthly: MonthlyClimate = {
    ghiKWhM2Day: fb.ghiKWhM2Day,
    ...(fb.dhiKWhM2Day ? { dhiKWhM2Day: fb.dhiKWhM2Day } : {}),
    tempC: fb.tempC,
    ...(fb.tempMaxC ? { tempMaxC: fb.tempMaxC } : {}),
    ...(fb.tempMinC ? { tempMinC: fb.tempMinC } : {}),
    ...(fb.windMs ? { windMs: fb.windMs } : {}),
  };

  let monthly: MonthlyClimate;
  let climProv: Provenance;
  if (climR.status === "fulfilled") {
    const { res, parsed } = climR.value;
    monthly = parsed.monthly;
    climProv = provenanceFromResult(
      "nasa-power-climatology",
      parsed.period ? `${NAME_CLIM} ${parsed.period}` : NAME_CLIM,
      res,
      joinNotes("CERES/MERRA-2, community RE (kWh/m²/dia)", ...parsed.notes),
    );
  } else {
    const reason = describeError(climR.reason);
    warnSource(`NASA POWER climatologia (${plant.slug}): ${reason}`);
    monthly = fallbackMonthly;
    climProv = provenance(
      "nasa-power-climatology",
      fb.source,
      CLIMATE_FALLBACK_URL,
      "fallback",
      `NASA POWER indisponível (${reason}); usando climatologia de referência embarcada. Consulta: ${climUrl}`,
      nowIso,
    );
  }

  let interannual: number;
  let annualSeries: SolarResource["annualSeries"];
  let seriesProv: Provenance;
  if (seriesR.status === "fulfilled") {
    interannual = seriesR.value.cvPct;
    annualSeries = seriesR.value.series;
    seriesProv = seriesR.value.prov;
  } else {
    const reason = describeError(seriesR.reason);
    warnSource(`NASA POWER série mensal (${plant.slug}): ${reason}`);
    interannual = fb.interannualCvPct;
    seriesProv = provenance(
      "nasa-power-monthly",
      `CV interanual de referência (${fb.interannualCvPct} %) — fallback embarcado`,
      CLIMATE_FALLBACK_URL,
      "fallback",
      `série mensal NASA POWER indisponível (${reason})`,
      nowIso,
    );
  }

  return {
    monthly,
    annualGhiKWhM2: annualFromMonthly(monthly.ghiKWhM2Day),
    interannualCvPct: interannual,
    ...(annualSeries ? { annualSeries } : {}),
    provenance: [climProv, seriesProv],
  };
}
