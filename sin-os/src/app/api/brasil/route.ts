import { getBrazilBundle, publicMeta } from "@/lib/data";
import { latestBySub, PLD_LIMITS } from "@/lib/market/brazil";
import { mean } from "@/lib/quant/stats";
import { errorResponse, jsonResponse } from "@/lib/services";
import { brtDate, brtHour } from "@/lib/sources/time";
import { SUBS, type DailySubPanel, type Sub, type SubPanel } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function slice(p: SubPanel | null, from: number) {
  if (!p) return null;
  const idx = p.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= from).map(([, i]) => i);
  return {
    ts: idx.map((i) => p.ts[i]),
    values: Object.fromEntries(SUBS.map((s) => [s, idx.map((i) => p.values[s][i])])) as Record<Sub, (number | null)[]>,
    unit: p.unit,
  };
}

function dailyTail(p: DailySubPanel | null, n: number) {
  if (!p) return null;
  return {
    dates: p.dates.slice(-n),
    values: Object.fromEntries(SUBS.map((s) => [s, p.values[s].slice(-n)])) as Record<Sub, (number | null)[]>,
    unit: p.unit,
  };
}

/** Médias diárias e matriz dia×hora (heatmap) por submercado. */
function aggregates(p: SubPanel, days: number) {
  const byDay = new Map<string, Record<Sub, (number | null)[]>>();
  p.ts.forEach((t, i) => {
    const d = brtDate(t);
    const row = byDay.get(d) ?? (Object.fromEntries(SUBS.map((s) => [s, new Array(24).fill(null)])) as Record<Sub, (number | null)[]>);
    for (const s of SUBS) row[s][brtHour(t)] = p.values[s][i];
    byDay.set(d, row);
  });
  const dates = [...byDay.keys()].sort().slice(-days);
  const daily = Object.fromEntries(
    SUBS.map((s) => [s, dates.map((d) => {
      const v = byDay.get(d)![s].filter((x): x is number => x !== null);
      return v.length ? mean(v) : null;
    })]),
  ) as Record<Sub, (number | null)[]>;
  const heat = Object.fromEntries(SUBS.map((s) => [s, dates.slice(-31).map((d) => byDay.get(d)![s])])) as Record<Sub, (number | null)[][]>;
  return { dates, daily, heatDates: dates.slice(-31), heat };
}

export async function GET() {
  try {
    const b = await getBrazilBundle();
    const pld = b.pld.data;
    const now = Date.now();
    const today = brtDate(now);
    let kpis = null;
    let agg = null;
    if (pld) {
      const latest = latestBySub(pld, now);
      const dayAgo = latestBySub(pld, now - 86400_000);
      const tomorrowIdx = pld.ts.map((t, i) => [t, i] as const).filter(([t]) => brtDate(t) > today).map(([, i]) => i);
      const todayIdx = pld.ts.map((t, i) => [t, i] as const).filter(([t]) => brtDate(t) === today).map(([, i]) => i);
      const avg = (idx: number[], s: Sub) => {
        const v = idx.map((i) => pld.values[s][i]).filter((x): x is number => x !== null);
        return v.length ? mean(v) : null;
      };
      kpis = SUBS.map((s) => ({
        sub: s,
        now: latest[s]?.value ?? null,
        at: latest[s]?.ts ?? null,
        dayAgo: dayAgo[s]?.value ?? null,
        todayAvg: avg(todayIdx, s),
        tomorrowAvg: tomorrowIdx.length ? avg(tomorrowIdx, s) : null,
        spark: pld.values[s].slice(-48),
      }));
      agg = aggregates(pld, 90);
    }
    return jsonResponse({
      generatedAt: now,
      limits: PLD_LIMITS,
      meta: { pld: publicMeta(b.pld), cmo: publicMeta(b.cmo), ear: publicMeta(b.ear), ena: publicMeta(b.ena), load: publicMeta(b.load) },
      kpis,
      pld: slice(pld, now - 10 * 86400_000),
      aggregates: agg,
      cmo: slice(b.cmo.data, now - 4 * 86400_000),
      ear: dailyTail(b.ear.data, 365),
      ena: dailyTail(b.ena.data, 365),
      load: slice(b.load.data, now - 7 * 86400_000),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
