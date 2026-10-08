import { parquetReadObjects } from "hyparquet";
import { cached } from "../cache";
import { balanceRowFrom, curtRowFrom, type BalanceRow, type CurtRow, type Tech } from "../market/renewables";
import { errMsg, fetchBuffer, HttpError, probesOf } from "./http";
import { ONS_S3 } from "./ons";
import { brtDate } from "./time";
import { emptyQuality, type Probe, type Quality, type SourceId, type SourceResult } from "./types";

/**
 * ONS — restrição de operação por constrained-off de eólicas e fotovoltaicas (por conjunto, meia
 * hora) e balanço de energia por subsistema (horário). Arquivos parquet do bucket público
 * (um por mês nas restrições, um por ano no balanço), lidos com hyparquet.
 */
const CURT_FILE: Record<Tech, { prefix: string; file: string }> = {
  eolica: { prefix: "restricao_coff_eolica_tm", file: "RESTRICAO_COFF_EOLICA" },
  solar: { prefix: "restricao_coff_fotovoltaica_tm", file: "RESTRICAO_COFF_FOTOVOLTAICA" },
};
const TTL = 3 * 3600_000;

export const curtailmentUrl = (tech: Tech, y: number, m: number) =>
  `${ONS_S3}/${CURT_FILE[tech].prefix}/${CURT_FILE[tech].file}_${y}_${String(m).padStart(2, "0")}.parquet`;
export const balanceUrl = (y: number) => `${ONS_S3}/balanco_energia_subsistema_ho/BALANCO_ENERGIA_SUBSISTEMA_${y}.parquet`;

async function readParquet(url: string): Promise<{ rows: Record<string, unknown>[]; probes: Probe[] }> {
  const { buf, probes } = await fetchBuffer(url, { timeoutMs: 60_000 });
  const rows = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[];
  return { rows, probes };
}

/** Meses (BRT) cobertos pela janela [now − days, now). */
export function monthsFor(now: number, days: number): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  for (let k = days; k >= 0; k--) {
    const [y, m] = brtDate(now - k * 86400_000).split("-").map(Number);
    if (!out.some((x) => x.y === y && x.m === m)) out.push({ y, m });
  }
  return out;
}

const notFound = (e: unknown) => probesOf(e).some((p) => p.status === 403 || p.status === 404);

/**
 * Lê os arquivos da janela. O mês mais recente pode ainda não existir no primeiro dia (o ONS
 * publica D−1): 403/404 nele é tolerado; nos demais é erro.
 */
/** `map` devolve null para linha inválida e undefined para linha ignorada de propósito (ex.: total SIN). */
async function loadFiles<T>(urls: string[], map: (o: Record<string, unknown>) => T | null | undefined, key: string) {
  const { value } = await cached(key, TTL, async () => {
    const probes: Probe[] = [];
    const rows: T[] = [];
    let invalid = 0;
    let loaded = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const r = await readParquet(urls[i]);
        probes.push(...r.probes);
        loaded++;
        for (const o of r.rows) {
          const x = map(o);
          if (x) rows.push(x);
          else if (x === null) invalid++;
        }
      } catch (e) {
        probes.push(...probesOf(e));
        const last = i === urls.length - 1;
        if (!(last && notFound(e) && loaded > 0)) throw new HttpError(errMsg(e), probes);
      }
    }
    return { rows, probes, invalid };
  });
  return value;
}

function qualityOf<T extends { ts: number }>(rows: T[], invalid: number, dailyTotals: number[], range: [number, number]): Quality {
  const q = emptyQuality();
  q.points = rows.length;
  q.invalid = invalid;
  q.latestTs = rows.reduce((m, r) => Math.max(m, r.ts), 0) || null;
  q.values = dailyTotals;
  q.range = range;
  return q;
}

async function wrap<T>(id: SourceId, fn: () => Promise<{ data: T; quality: Quality; probes: Probe[] }>): Promise<SourceResult<T>> {
  try {
    const { data, quality, probes } = await fn();
    return { id, ok: true, data, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    return { id, ok: false, data: null, error: errMsg(e), probes: probesOf(e), quality: emptyQuality(), simulated: false, fetchedAt: Date.now() };
  }
}

/** Intervalos de meia hora (eólica + solar) dos conjuntos com e sem restrição, últimos `days` dias. */
export const fetchCurtailment = (days = 14, now = Date.now()) =>
  wrap<CurtRow[]>("ons_curtailment", async () => {
    const months = monthsFor(now, days);
    const from = now - (days + 1) * 86400_000;
    const probes: Probe[] = [];
    const rows: CurtRow[] = [];
    let invalid = 0;
    for (const tech of ["eolica", "solar"] as Tech[]) {
      const urls = months.map(({ y, m }) => curtailmentUrl(tech, y, m));
      const r = await loadFiles(urls, (o) => curtRowFrom(o, tech), `parquet:${urls.join("|")}`);
      probes.push(...r.probes);
      invalid += r.invalid;
      for (const x of r.rows) if (x.ts >= from) rows.push(x);
    }
    if (!rows.length) throw new HttpError("restrições do ONS sem linhas na janela", probes);
    // totais diários cortados (MWh) alimentam a checagem de faixa do auditor
    const daily = new Map<string, number>();
    for (const r of rows) if (r.razao) daily.set(brtDate(r.ts), (daily.get(brtDate(r.ts)) ?? 0) + Math.max(0, r.apurada ?? 0) * 0.5);
    return { data: rows, probes, quality: qualityOf(rows, invalid, [...daily.values()], [0, 1_000_000]) };
  });

/** Balanço horário por subsistema (geração por fonte, carga e intercâmbio), últimos `days` dias. */
export const fetchBalance = (days = 14, now = Date.now()) =>
  wrap<BalanceRow[]>("ons_balanco", async () => {
    const years = [...new Set(monthsFor(now, days).map((x) => x.y))];
    const urls = years.map(balanceUrl);
    const from = now - (days + 1) * 86400_000;
    // o arquivo traz também a linha agregada do SIN; somamos os submercados nós mesmos
    const r = await loadFiles(urls, (o) => (String(o.id_subsistema ?? "").trim().toUpperCase() === "SIN" ? undefined : balanceRowFrom(o)), `parquet:${urls.join("|")}`);
    const rows = r.rows.filter((x) => x.ts >= from);
    if (!rows.length) throw new HttpError("balanço do ONS sem linhas na janela", r.probes);
    return { data: rows, probes: r.probes, quality: qualityOf(rows, r.invalid, rows.map((x) => x.carga ?? 0), [0, 120_000]) };
  });
