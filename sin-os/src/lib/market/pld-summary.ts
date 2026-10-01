import { brtDate, brtHour } from "../sources/time";
import { SUB_NAMES, SUBS, type Sub, type SubPanel } from "../sources/types";
import { latestBySub } from "./brazil";

/**
 * Resumo do PLD horário por submercado (usado por /api/pld e pela Iara): valor da hora
 * atual (ou o último publicado), estatísticas de hoje e de amanhã (se já publicado), último
 * dia completo e, opcionalmente, as médias diárias dos últimos dias completos.
 */
const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const brtStamp = (ts: number) => `${brtDate(ts)} ${String(brtHour(ts)).padStart(2, "0")}:00`;

/** Valores das 24 horas (BRT) de uma data, por submercado. */
export function dayRow(panel: SubPanel, date: string): Record<Sub, (number | null)[]> {
  const row = Object.fromEntries(SUBS.map((s) => [s, new Array<number | null>(24).fill(null)])) as Record<Sub, (number | null)[]>;
  panel.ts.forEach((t, i) => {
    if (brtDate(t) !== date) return;
    for (const s of SUBS) row[s][brtHour(t)] = panel.values[s][i];
  });
  return row;
}

export function dayStats(hours: (number | null)[]) {
  const pts = hours.map((v, h) => [h, v] as const).filter((x): x is readonly [number, number] => x[1] !== null && Number.isFinite(x[1]));
  if (!pts.length) return null;
  const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    horas: pts.length,
    media: r2(mean(pts.map((p) => p[1]))),
    min: { valor: r2(lo[1]), hora: `${String(lo[0]).padStart(2, "0")}h` },
    max: { valor: r2(hi[1]), hora: `${String(hi[0]).padStart(2, "0")}h` },
  };
}

/** Médias dos dias completos (24 h) até `lastDate`, da mais antiga para a mais recente. */
export function dailyMeans(panel: SubPanel, sub: Sub, lastDate: string, n: number): { data: string; media: number }[] {
  const byDay = new Map<string, (number | null)[]>();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    if (d > lastDate) return;
    const row = byDay.get(d) ?? new Array<number | null>(24).fill(null);
    row[brtHour(t)] = panel.values[sub][i];
    byDay.set(d, row);
  });
  return [...byDay.entries()]
    .filter(([, v]) => v.every((x) => x !== null && Number.isFinite(x)))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-Math.max(0, n))
    .map(([data, v]) => ({ data, media: r2(mean(v as number[]))! }));
}

export function pldSnapshot(panel: SubPanel, now: number, subs: readonly Sub[] = SUBS, days = 0) {
  const today = brtDate(now);
  const tomorrow = brtDate(now + 86400_000);
  const latest = latestBySub(panel, now);
  const rowToday = dayRow(panel, today);
  const rowTomorrow = dayRow(panel, tomorrow);
  return subs.map((s) => {
    const tm = dayStats(rowTomorrow[s]);
    const last = dailyMeans(panel, s, today, Math.max(1, days));
    return {
      sub: s,
      nome: SUB_NAMES[s],
      agora: latest[s] ? { valor: r2(latest[s]!.value), hora_brt: brtStamp(latest[s]!.ts) } : null,
      hoje: dayStats(rowToday[s]),
      amanha: tm && tm.horas === 24 ? tm : null,
      ultimo_dia_completo: last.length ? last[last.length - 1] : null,
      ...(days > 0 ? { medias_diarias: last } : {}),
    };
  });
}
