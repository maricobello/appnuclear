import { cached } from "../cache";
import { byYearDesc, ckanPackage, subOf } from "./ckan";
import { findCol, num, parseCsv } from "./csv";
import { errMsg, fetchText, probesOf } from "./http";
import { brtDate, parseBrtDateTime } from "./time";
import {
  emptyQuality,
  SUBS,
  type DailySubPanel,
  type Probe,
  type Quality,
  type SourceId,
  type SourceResult,
  type Sub,
  type SubPanel,
} from "./types";

/**
 * ONS — Portal de Dados Abertos (CKAN + S3 ons-aws-prod-opendata).
 * CSV UTF‑8, separador ';', decimal '.'. Um arquivo por ano.
 * https://dados.ons.org.br
 */
export const ONS_BASE = "https://dados.ons.org.br/api/3/action";

async function onsYearCsvs(pkg: string, years: number) {
  const { resources, probes } = await ckanPackage(ONS_BASE, pkg);
  const csvs = byYearDesc(resources, (r) => /csv/i.test(r.format ?? "") || /\.csv(\?|$)/i.test(r.url));
  if (!csvs.length) throw new Error(`nenhum CSV anual em ${pkg}`);
  return { files: csvs.slice(0, years).map((x) => x.r.url), probes };
}

async function loadCsv(url: string, ttlMs: number) {
  const { value } = await cached(`csv:${url}`, ttlMs, async () => {
    const { text, probes } = await fetchText(url, { timeoutMs: 45_000 });
    return { ...parseCsv(text, ";"), probes };
  });
  return value;
}

interface Parsed<T> {
  data: T;
  quality: Quality;
}

type RowParser = (header: string[]) => {
  issues: string[];
  parse: (row: string[]) => { sub: Sub; ts: number; values: number[] } | null;
};

async function loadSeries(pkg: string, years: number, ttlMs: number, parser: RowParser) {
  const probes: Probe[] = [];
  const { files, probes: p0 } = await onsYearCsvs(pkg, years);
  probes.push(...p0);
  const out: { sub: Sub; ts: number; values: number[] }[] = [];
  const quality = emptyQuality();
  for (const url of files) {
    const csv = await loadCsv(url, ttlMs);
    probes.push(...csv.probes);
    const { issues, parse } = parser(csv.header);
    if (issues.length) {
      quality.schemaIssues.push(...issues.map((i) => `${i} (${url.split("/").pop()})`));
      continue;
    }
    for (const row of csv.rows) {
      const r = parse(row);
      if (!r) quality.invalid++;
      else out.push(r);
    }
  }
  if (!out.length) throw new Error(quality.schemaIssues.join("; ") || `sem linhas válidas em ${pkg}`);
  return { rows: out, probes, quality };
}

function hourlyPanel(rows: { sub: Sub; ts: number; values: number[] }[], daysBack: number, unit: string, quality: Quality): Parsed<SubPanel> {
  // agrega sub-horário (ex.: semi-horário) pela média na hora cheia
  const acc = new Map<number, Partial<Record<Sub, { s: number; n: number }>>>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.sub}:${r.ts}`;
    if (seen.has(key)) { quality.duplicates++; continue; }
    seen.add(key);
    const h = Math.floor(r.ts / 3600_000) * 3600_000;
    const row = acc.get(h) ?? {};
    const cell = row[r.sub] ?? { s: 0, n: 0 };
    cell.s += r.values[0];
    cell.n++;
    row[r.sub] = cell;
    acc.set(h, row);
  }
  const all = [...acc.keys()].sort((a, b) => a - b);
  const cutoff = all[all.length - 1] - daysBack * 86400_000;
  const ts = all.filter((t) => t > cutoff);
  const values = Object.fromEntries(
    SUBS.map((s) => [s, ts.map((t) => { const c = acc.get(t)?.[s]; return c ? c.s / c.n : null; })]),
  ) as SubPanel["values"];
  quality.points = ts.length * 4;
  quality.expectedPoints = (Math.round((ts[ts.length - 1] - ts[0]) / 3600_000) + 1) * 4;
  quality.latestTs = ts[ts.length - 1];
  quality.values = SUBS.flatMap((s) => values[s].slice(-168)).filter((v): v is number => v !== null);
  return { data: { ts, values, unit }, quality };
}

function dailyPanel(rows: { sub: Sub; ts: number; values: number[] }[], daysBack: number, unit: string, quality: Quality, idx = 0): Parsed<DailySubPanel> {
  const acc = new Map<string, Partial<Record<Sub, number>>>();
  for (const r of rows) {
    const d = brtDate(r.ts);
    const row = acc.get(d) ?? {};
    if (row[r.sub] !== undefined) quality.duplicates++;
    row[r.sub] = r.values[idx];
    acc.set(d, row);
  }
  const dates = [...acc.keys()].sort().slice(-daysBack);
  const values = Object.fromEntries(SUBS.map((s) => [s, dates.map((d) => acc.get(d)?.[s] ?? null)])) as DailySubPanel["values"];
  quality.points = dates.length * 4;
  quality.latestTs = dates.length ? Date.parse(`${dates[dates.length - 1]}T12:00:00-03:00`) : null;
  quality.values = SUBS.flatMap((s) => values[s].slice(-30)).filter((v): v is number => v !== null);
  return { data: { dates, values, unit }, quality };
}

const subTimeValue =
  (timeRe: RegExp[], valueRes: RegExp[][]): RowParser =>
  (header) => {
    const iSub = findCol(header, /^id_subsistema$/, /^nom_subsistema$/, /subsistema/);
    const iTime = findCol(header, ...timeRe);
    const iVals = valueRes.map((res) => findCol(header, ...res));
    const issues: string[] = [];
    if (iSub < 0) issues.push("coluna de subsistema ausente");
    if (iTime < 0) issues.push("coluna de data/hora ausente");
    iVals.forEach((i, k) => i < 0 && issues.push(`coluna de valor ausente (${valueRes[k].map(String).join(" | ")})`));
    return {
      issues,
      parse: (row) => {
        const sub = subOf(row[iSub]) ?? subOf(row[findCol(header, /^nom_subsistema$/)]);
        const ts = parseBrtDateTime(row[iTime] ?? "");
        const values = iVals.map((i) => num(row[i]));
        if (!sub || !Number.isFinite(ts) || values.some((v) => !Number.isFinite(v))) return null;
        return { sub, ts, values };
      },
    };
  };

async function wrap<T>(id: SourceId, fn: () => Promise<{ data: T; quality: Quality; probes: Probe[] }>): Promise<SourceResult<T>> {
  try {
    const { data, quality, probes } = await fn();
    return { id, ok: true, data, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    return { id, ok: false, data: null, error: errMsg(e), probes: probesOf(e), quality: emptyQuality(), simulated: false, fetchedAt: Date.now() };
  }
}

const yearsNeeded = (daysBack: number) => (new Date().getUTCMonth() * 30 + new Date().getUTCDate() < daysBack ? 2 : 1);

/** CMO semi-horário por subsistema (DESSEM), agregado para horário. Inclui o programado de D+1. */
export const fetchCmoHourly = (daysBack = 120) =>
  wrap<SubPanel>("ons_cmo", async () => {
    const { rows, probes, quality } = await loadSeries(
      "cmo-semi-horario",
      yearsNeeded(daysBack),
      30 * 60_000,
      subTimeValue([/^din_instante$/, /instante/, /^dat/], [[/^val_cmo$/, /cmo/]]),
    );
    const p = hourlyPanel(rows, daysBack, "R$/MWh", quality);
    p.quality.range = [-1, 5000];
    return { ...p, probes };
  });

/** Energia Armazenada (EAR) diária por subsistema, % da capacidade máxima. */
export const fetchEarDaily = (daysBack = 365) =>
  wrap<DailySubPanel>("ons_ear", async () => {
    const { rows, probes, quality } = await loadSeries(
      "ear-diario-por-subsistema",
      2,
      3 * 3600_000,
      subTimeValue([/^ear_data$/, /data/, /instante/], [[/^ear_verif_subsistema_percentual$/, /percentual/]]),
    );
    const p = dailyPanel(rows, daysBack, "% EARmax", quality);
    p.quality.range = [0, 100.5];
    return { ...p, probes };
  });

/** Energia Natural Afluente (ENA) bruta diária por subsistema, % da MLT. */
export const fetchEnaDaily = (daysBack = 365) =>
  wrap<DailySubPanel>("ons_ena", async () => {
    const { rows, probes, quality } = await loadSeries(
      "ena-diario-por-subsistema",
      2,
      3 * 3600_000,
      subTimeValue([/^ena_data$/, /data/, /instante/], [[/^ena_bruta_.*percentualmlt$/, /bruta.*mlt/, /percentual/]]),
    );
    const p = dailyPanel(rows, daysBack, "% MLT", quality);
    p.quality.range = [0, 1000];
    return { ...p, probes };
  });

/** Curva de carga horária por subsistema (MWmed). */
export const fetchLoadHourly = (daysBack = 60) =>
  wrap<SubPanel>("ons_carga", async () => {
    const { rows, probes, quality } = await loadSeries(
      "curva-carga",
      yearsNeeded(daysBack),
      60 * 60_000,
      subTimeValue([/^din_instante$/, /instante/, /^dat/], [[/^val_cargaenergiahomwmed$/, /carga/]]),
    );
    const p = hourlyPanel(rows, daysBack, "MWmed", quality);
    p.quality.range = [0, 120_000];
    return { ...p, probes };
  });
