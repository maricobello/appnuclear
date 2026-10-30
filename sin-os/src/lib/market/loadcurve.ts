import { dayType, equivalentDay, isoDate, type DayType } from "./calendar";
import type { ContractCalendar } from "./contracting";

/**
 * Leitura da curva de carga (memória de massa) em CSV: o dado que o Open Energy vai padronizar e que
 * hoje sai do portal da distribuidora ou do medidor. Roda no navegador: a curva não sai da máquina.
 *
 * Aceita: separador ; , ou tab; decimal com vírgula ou ponto; data ISO (2026-01-31 23:45) ou
 * brasileira (31/01/2026 23:45, com a hora na mesma coluna ou na seguinte); intervalos de 5 a 60 min;
 * valores em kWh por intervalo, kW, MWh ou MW (pelo cabeçalho; sem cabeçalho, kWh por intervalo).
 * Hora "24:00" indica que o horário marca o fim do intervalo, e então tudo recua um intervalo.
 */

export type LoadUnit = "kWh" | "kW" | "MWh" | "MW";

export interface HourPoint {
  key: number; // início da hora (relógio local, em ms "UTC" sem fuso)
  y: number;
  m: number; // 1–12
  d: number;
  h: number;
  mw: number;
}

export interface ParsedCurve {
  hourly: HourPoint[];
  intervalMin: number;
  unit: LoadUnit;
  unitGuessed: boolean;
  column: string;
  rows: number;
  skipped: number;
  days: number;
  first: string;
  last: string;
}

const ISO = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/;
const BR = /(\d{2})\/(\d{2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2}))?/;
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Número com vírgula decimal (1.234,5) ou ponto decimal (1234.5); null se não for número. */
export function parseNumber(raw: string, decimalComma: boolean): number | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const v = decimalComma ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function guessUnit(header: string): { unit: LoadUnit; guessed: boolean } {
  const h = header.toLowerCase();
  if (/mwh/.test(h)) return { unit: "MWh", guessed: false };
  if (/kwh/.test(h)) return { unit: "kWh", guessed: false };
  if (/\bmw\b/.test(h)) return { unit: "MW", guessed: false };
  if (/\bkw\b|demanda/.test(h)) return { unit: "kW", guessed: false };
  return { unit: "kWh", guessed: true };
}

/** Lê o CSV; `unit` força a unidade (senão vem do cabeçalho). */
export function parseLoadCsv(text: string, unit?: LoadUnit): ParsedCurve {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new Error("arquivo vazio ou curto demais");
  const sample = lines.slice(0, 20).join("\n");
  const delim = sample.includes(";") ? ";" : sample.includes("\t") ? "\t" : ",";
  const hasHeader = !ISO.test(lines[0]) && !BR.test(lines[0]);
  // vírgula decimal só se algum valor a usar (com ; há arquivos com ponto decimal)
  const decimalComma = delim !== "," && (hasHeader ? lines.slice(1) : lines).slice(0, 50).some((l) => l.split(delim).some((c) => /^\s*"?-?\d[\d.]*,\d+"?\s*$/.test(c)));
  const header = hasHeader ? lines[0].split(delim).map((c) => c.trim().replace(/^"|"$/g, "")) : [];
  const recs: { t: number; v: number; end: boolean }[] = [];
  let skipped = 0;
  let col = -1;
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = line.split(delim);
    let y = 0;
    let mo = 0;
    let d = 0;
    let hh: number | null = null;
    let mm = 0;
    let used = -1;
    for (let i = 0; i < cells.length && used < 0; i++) {
      const c = cells[i].trim().replace(/^"|"$/g, "");
      const iso = ISO.exec(c);
      const br = iso ? null : BR.exec(c);
      if (!iso && !br) continue;
      [y, mo, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(br![3]), Number(br![2]), Number(br![1])];
      const hm = iso ? [iso[4], iso[5]] : [br![4], br![5]];
      used = i;
      if (hm[0] !== undefined) {
        hh = Number(hm[0]);
        mm = Number(hm[1]);
      } else {
        const t = TIME.exec((cells[i + 1] ?? "").trim().replace(/^"|"$/g, ""));
        if (t) {
          hh = Number(t[1]);
          mm = Number(t[2]);
          used = i + 1;
        }
      }
    }
    if (used < 0 || hh === null || mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 24 || mm > 59) {
      skipped++;
      continue;
    }
    if (col < 0) {
      for (let j = used + 1; j < cells.length; j++) if (parseNumber(cells[j], decimalComma) !== null) {
        col = j;
        break;
      }
    }
    const v = col >= 0 ? parseNumber(cells[col] ?? "", decimalComma) : null;
    if (v === null || v < 0) {
      skipped++;
      continue;
    }
    recs.push({ t: Date.UTC(y, mo - 1, d, hh, mm), v, end: hh === 24 });
  }
  if (recs.length < 24) throw new Error("não encontrei data/hora e valor em linhas suficientes (mínimo de um dia)");
  recs.sort((a, b) => a.t - b.t);
  const diffs: number[] = [];
  for (let i = 1; i < recs.length; i++) {
    const dm = (recs[i].t - recs[i - 1].t) / 60_000;
    if (dm > 0) diffs.push(dm);
  }
  diffs.sort((a, b) => a - b);
  const interval = Math.min(60, Math.max(5, diffs[Math.floor(diffs.length / 2)] ?? 60));
  const endLabelled = recs.some((r) => r.end);
  const name = col >= 0 ? (header[col] ?? `coluna ${col + 1}`) : "valor";
  const u = unit ? { unit, guessed: false } : guessUnit(name);
  const toMw = (v: number) => (u.unit === "kWh" ? (v * 60) / interval / 1000 : u.unit === "MWh" ? (v * 60) / interval : u.unit === "kW" ? v / 1000 : v);
  const byHour = new Map<number, { sum: number; n: number }>();
  for (const r of recs) {
    const start = r.t - (endLabelled ? interval * 60_000 : 0);
    const key = Math.floor(start / 3_600_000) * 3_600_000;
    const acc = byHour.get(key) ?? { sum: 0, n: 0 };
    acc.sum += toMw(r.v);
    acc.n++;
    byHour.set(key, acc);
  }
  const hourly = [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, a]) => {
      const dt = new Date(key);
      return { key, y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mw: a.sum / a.n };
    });
  const iso = (k: number) => new Date(k).toISOString().slice(0, 16).replace("T", " ");
  return {
    hourly,
    intervalMin: interval,
    unit: u.unit,
    unitGuessed: u.guessed,
    column: name,
    rows: recs.length,
    skipped,
    days: new Set(hourly.map((p) => Math.floor(p.key / 86_400_000))).size,
    first: iso(hourly[0].key),
    last: iso(hourly[hourly.length - 1].key),
  };
}

export interface LoadStats {
  avgMw: number;
  peakMw: number;
  loadFactor: number;
  /** Fração da energia entre 18h e 21h (a ponta do PLD e da tarifa). */
  peakShare: number;
  monthsCovered: number;
}

/** Indicadores da curva medida. */
export function curveStats(c: ParsedCurve): LoadStats {
  const months = new Map<number, Set<number>>();
  let peak = 0;
  let tot = 0;
  let ponta = 0;
  for (const p of c.hourly) {
    const set = months.get(p.m) ?? new Set<number>();
    set.add(Math.floor(p.key / 86_400_000));
    months.set(p.m, set);
    peak = Math.max(peak, p.mw);
    tot += p.mw;
    if (p.h >= 18 && p.h <= 20) ponta += p.mw;
  }
  const avgMw = c.hourly.length ? tot / c.hourly.length : 0;
  return {
    avgMw,
    peakMw: peak,
    loadFactor: peak ? avgMw / peak : 0,
    peakShare: tot ? ponta / tot : 0,
    monthsCovered: [...months.values()].filter((d) => d.size >= 7).length,
  };
}

/**
 * Carga de cada hora do horizonte do contrato a partir da curva medida: cada dia usa o dia
 * equivalente da curva (mesmo tipo de dia e mês civil, o mais perto de 52 semanas antes); sem
 * equivalente, a média dos dias do mesmo tipo.
 */
export function contractLoad(c: ParsedCurve, cal: ContractCalendar): { load: Float64Array; equivalent: number; fallback: number } {
  const byDay = new Map<string, number[]>();
  for (const p of c.hourly) {
    const d = isoDate(p.y, p.m, p.d);
    const row = byDay.get(d) ?? new Array<number>(24).fill(NaN);
    row[p.h] = p.mw;
    byDay.set(d, row);
  }
  const complete = new Map([...byDay].filter(([, r]) => r.every((v) => Number.isFinite(v))));
  const avg: Record<DayType, number[]> = { util: new Array(24).fill(0), sab: new Array(24).fill(0), dom: new Array(24).fill(0) };
  const cnt: Record<DayType, number> = { util: 0, sab: 0, dom: 0 };
  for (const [d, r] of complete) {
    const t = dayType(d);
    r.forEach((v, h) => (avg[t][h] += v));
    cnt[t]++;
  }
  const all = Array.from({ length: 24 }, (_, h) => (avg.util[h] + avg.sab[h] + avg.dom[h]) / Math.max(1, cnt.util + cnt.sab + cnt.dom));
  const typical = (t: DayType) => (cnt[t] ? avg[t].map((v) => v / cnt[t]) : all);
  const load = new Float64Array(cal.total);
  let equivalent = 0;
  let fallback = 0;
  cal.days.forEach((day, i) => {
    const eq = equivalentDay(day.date, (d) => complete.has(d));
    const row = eq ? complete.get(eq)! : typical(dayType(day.date));
    if (eq) equivalent++;
    else fallback++;
    for (let h = 0; h < 24; h++) load[i * 24 + h] = row[h];
  });
  return { load, equivalent, fallback };
}
