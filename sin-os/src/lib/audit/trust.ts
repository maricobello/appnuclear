import { createHash } from "node:crypto";
import { brtDate, brtHour } from "../sources/time";
import { SUBS, type DailySubPanel, type SourceId, type Sub, type SubPanel } from "../sources/types";

/**
 * Camada de confiança nos dados abertos: bases públicas podem ser republicadas em silêncio
 * (o passado muda) ou chegar incompletas. Cada dia fechado vira uma impressão digital
 * persistida; quando o mesmo dia reaparece diferente, registramos a revisão com o tamanho da
 * mudança. Também medimos completude dos últimos dias. Funções puras — a persistência fica
 * em `trust-run.ts`.
 *
 * Origem: a comunidade de dados de energia relatou que o corte de eólica/solar do ONS não
 * reflete contestações e que bases "mudam" sem aviso; quem não guardou o histórico antigo
 * nunca percebeu.
 */
export type TrustSourceId = Extract<SourceId, "ccee_pld" | "ons_cmo" | "ons_carga" | "ons_ear" | "ons_ena">;
export const TRUST_SOURCES: TrustSourceId[] = ["ccee_pld", "ons_cmo", "ons_carga", "ons_ear", "ons_ena"];
export const HOURLY: ReadonlySet<TrustSourceId> = new Set<TrustSourceId>(["ccee_pld", "ons_cmo", "ons_carga"]);

/** Impressão digital de um dia fechado: valores arredondados (centavos), na ordem submercado × hora. */
export interface DayDigest {
  source: TrustSourceId;
  date: string;
  hash: string;
  /** Valores achatados: SE[0..], S[0..], NE[0..], N[0..] (24 por submercado; 1 se diário); null = ausente. */
  values: (number | null)[];
  /** Pontos esperados / presentes (completude do dia). */
  expected: number;
  present: number;
}

export interface Revision {
  source: TrustSourceId;
  date: string;
  detectedAt: number;
  changedPoints: number;
  maxAbsDiff: number;
  /** Maior mudança relativa (|novo−velho| / max(|velho|, 1)). */
  maxRelDiff: number;
  /** Mudança da média do dia (novo − velho). */
  meanShift: number;
  oldHash: string;
  newHash: string;
}

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const hashOf = (values: (number | null)[]) => createHash("sha1").update(values.map((v) => (v === null ? "n" : v.toFixed(2))).join(",")).digest("hex").slice(0, 16);

/** Datas dos últimos `windowDays` dias fechados (exclui hoje, que ainda muda). */
export function closedDates(now: number, windowDays: number): string[] {
  const out: string[] = [];
  for (let k = windowDays; k >= 1; k--) out.push(brtDate(now - k * 86400_000));
  return out;
}

export function digestHourly(source: TrustSourceId, panel: SubPanel, dates: string[]): DayDigest[] {
  const want = new Set(dates);
  const byDay = new Map<string, Record<Sub, (number | null)[]>>();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    if (!want.has(d)) return;
    const row = byDay.get(d) ?? (Object.fromEntries(SUBS.map((s) => [s, new Array<number | null>(24).fill(null)])) as Record<Sub, (number | null)[]>);
    for (const s of SUBS) row[s][brtHour(t)] = r2(panel.values[s][i]);
    byDay.set(d, row);
  });
  return dates.flatMap((date) => {
    const row = byDay.get(date);
    if (!row) return [];
    const values = SUBS.flatMap((s) => row[s]);
    return [{ source, date, hash: hashOf(values), values, expected: 96, present: values.filter((v) => v !== null).length }];
  });
}

export function digestDaily(source: TrustSourceId, panel: DailySubPanel, dates: string[]): DayDigest[] {
  return dates.flatMap((date) => {
    const i = panel.dates.indexOf(date);
    if (i < 0) return [];
    const values = SUBS.map((s) => r2(panel.values[s][i]));
    return [{ source, date, hash: hashOf(values), values, expected: 4, present: values.filter((v) => v !== null).length }];
  });
}

export function digestSource(source: TrustSourceId, data: unknown, now: number, windowDays = 10): DayDigest[] {
  if (!data) return [];
  const dates = closedDates(now, windowDays);
  return HOURLY.has(source) ? digestHourly(source, data as SubPanel, dates) : digestDaily(source, data as DailySubPanel, dates);
}

/** Compara o dia já guardado com o novo; null se idêntico (ou se o novo está menos completo, o que é lacuna, não revisão). */
export function diffDigest(prev: DayDigest, curr: DayDigest, now: number): Revision | null {
  if (prev.hash === curr.hash) return null;
  if (curr.present < prev.present) return null;
  let changed = 0;
  let maxAbs = 0;
  let maxRel = 0;
  const n = Math.max(prev.values.length, curr.values.length);
  const pv: number[] = [];
  const cv: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev.values[i] ?? null;
    const b = curr.values[i] ?? null;
    if (a === null && b === null) continue;
    if (a === null || b === null) {
      changed++; // ponto que apareceu depois: preenchimento tardio
      continue;
    }
    pv.push(a);
    cv.push(b);
    if (Math.abs(a - b) > 0.005) {
      changed++;
      maxAbs = Math.max(maxAbs, Math.abs(a - b));
      maxRel = Math.max(maxRel, Math.abs(a - b) / Math.max(Math.abs(a), 1));
    }
  }
  if (!changed) return null;
  const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0);
  return {
    source: curr.source,
    date: curr.date,
    detectedAt: now,
    changedPoints: changed,
    maxAbsDiff: Math.round(maxAbs * 100) / 100,
    maxRelDiff: Math.round(maxRel * 1000) / 1000,
    meanShift: Math.round((mean(cv) - mean(pv)) * 100) / 100,
    oldHash: prev.hash,
    newHash: curr.hash,
  };
}

export interface Completeness {
  source: TrustSourceId;
  days: number;
  completeDays: number;
  /** Datas dos últimos dias fechados sem o dia completo. */
  incomplete: string[];
}

export function completeness(digests: DayDigest[], dates: string[], source: TrustSourceId): Completeness {
  const byDate = new Map(digests.map((d) => [d.date, d]));
  const incomplete = dates.filter((d) => {
    const x = byDate.get(d);
    return !x || x.present < x.expected;
  });
  return { source, days: dates.length, completeDays: dates.length - incomplete.length, incomplete };
}

export interface TrustSeal {
  source: TrustSourceId;
  /** "alta" sem revisões e completo; "média" com lacunas ou revisões pequenas; "baixa" com revisões grandes. */
  level: "alta" | "média" | "baixa";
  revisions30d: number;
  biggestRevision: Revision | null;
  completeness: Completeness | null;
  reasons: string[];
}

export function sealOf(source: TrustSourceId, revisions: Revision[], comp: Completeness | null): TrustSeal {
  const mine = revisions.filter((r) => r.source === source);
  const biggest = mine.slice().sort((a, b) => b.maxRelDiff - a.maxRelDiff)[0] ?? null;
  const reasons: string[] = [];
  let level: TrustSeal["level"] = "alta";
  if (biggest) {
    reasons.push(`${mine.length} dia(s) republicado(s) com valores diferentes; maior mudança ${biggest.maxAbsDiff} (${Math.round(biggest.maxRelDiff * 100)}%) em ${biggest.date}`);
    level = biggest.maxRelDiff >= 0.1 || mine.length >= 5 ? "baixa" : "média";
  }
  if (comp && comp.incomplete.length) {
    reasons.push(`${comp.incomplete.length} dos últimos ${comp.days} dias fechados incompleto(s): ${comp.incomplete.slice(0, 4).join(", ")}${comp.incomplete.length > 4 ? "…" : ""}`);
    if (level === "alta") level = "média";
    if (comp.incomplete.length >= Math.ceil(comp.days / 2)) level = "baixa";
  }
  return { source, level, revisions30d: mine.length, biggestRevision: biggest, completeness: comp, reasons };
}
