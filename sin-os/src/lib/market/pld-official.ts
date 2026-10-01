import { brtDate, brtHour, brtToUtc } from "../sources/time";
import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { limitsFor } from "./brazil";

/**
 * Dias de PLD oficial da CCEE (recebidos do coletor ou de outra fonte oficial) sobre a
 * estimativa pelo CMO do ONS: onde há dia oficial, ele vale; o resto continua estimado.
 */
export interface OfficialDay {
  date: string;
  values: Record<Sub, number[]>;
  source: string;
}

const complete = (v: Record<Sub, (number | null)[]>) => SUBS.every((s) => v[s]?.length === 24 && v[s].every((x) => x !== null && Number.isFinite(x)));

/**
 * Painel vindo do coletor → dias aceitos (completos, dentro do piso/teto do ano, até D+1) e
 * rejeitados com o motivo. Nada fora da regra regulatória entra como "oficial".
 */
export function officialDaysFromPanel(panel: SubPanel, now: number): { accepted: OfficialDay[]; rejected: { date: string; motivo: string }[] } {
  const byDay = new Map<string, Record<Sub, (number | null)[]>>();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    const row = byDay.get(d) ?? (Object.fromEntries(SUBS.map((s) => [s, new Array<number | null>(24).fill(null)])) as Record<Sub, (number | null)[]>);
    for (const s of SUBS) row[s][brtHour(t)] = panel.values[s][i];
    byDay.set(d, row);
  });
  const maxDate = brtDate(now + 86400_000);
  const accepted: OfficialDay[] = [];
  const rejected: { date: string; motivo: string }[] = [];
  for (const [date, v] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (date > maxDate) {
      rejected.push({ date, motivo: "data futura além de amanhã" });
      continue;
    }
    if (!complete(v)) {
      rejected.push({ date, motivo: "dia incompleto" });
      continue;
    }
    const lim = limitsFor(Number(date.slice(0, 4)));
    const bad = SUBS.flatMap((s) => (v[s] as number[]).filter((x) => x < lim.min - 0.01 || x > lim.maxHourly + 0.01));
    if (bad.length) {
      rejected.push({ date, motivo: `valor fora do piso/teto de ${lim.year} (${bad[0]})` });
      continue;
    }
    accepted.push({ date, values: v as Record<Sub, number[]>, source: "ccee" });
  }
  return { accepted, rejected };
}

/** Sobrepõe os dias oficiais à estimativa (une as horas; o oficial vence onde existir). */
export function mergeOfficialDays(est: SubPanel, days: OfficialDay[]): { data: SubPanel; days: string[]; coversLatest: boolean } {
  const official = days.filter((d) => d.source === "ccee" && complete(d.values)).sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map<number, Record<Sub, number | null>>();
  est.ts.forEach((t, i) => map.set(t, Object.fromEntries(SUBS.map((s) => [s, est.values[s][i]])) as Record<Sub, number | null>));
  for (const d of official) {
    const [y, m, dd] = d.date.split("-").map(Number);
    for (let h = 0; h < 24; h++) map.set(brtToUtc(y, m, dd, h), Object.fromEntries(SUBS.map((s) => [s, d.values[s][h]])) as Record<Sub, number | null>);
  }
  const ts = [...map.keys()].sort((a, b) => a - b);
  const data: SubPanel = { ts, values: Object.fromEntries(SUBS.map((s) => [s, ts.map((t) => map.get(t)![s])])) as SubPanel["values"], unit: est.unit };
  const lastEst = est.ts.length ? brtDate(est.ts[est.ts.length - 1]) : "";
  const lastOff = official.length ? official[official.length - 1].date : "";
  return { data, days: official.map((d) => d.date), coversLatest: !!lastOff && lastOff >= lastEst };
}
