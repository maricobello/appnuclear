import "server-only";
import { cached } from "../cache";
import { getPld, publicMeta } from "../data";
import { headlineBand, headlinePld, PLAN_STALE_DAYS, planAgeDays, sddp12, sddpPld, type PlanReport } from "../planning/report";
import { loadPlanReport } from "../planning/store";
import { brtDate, brtHour } from "../sources/time";
import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { limitsFor, PLD_LIMITS } from "./brazil";
import { impliedRho, type MonthBand } from "./contracting";
import { BANDEIRAS_RS_MWH } from "./radar";

/** Dias com dado para a forma horária do mês civil; abaixo disso usa a média dos 12 meses. */
const MIN_SHAPE_DAYS = 7;

/**
 * Forma horária do PLD por submercado: desvio médio de cada hora em relação à média do dia, por mês
 * civil, nos dias completos da janela (o último ano).
 */
export function hourlyShape(panel: SubPanel): Record<Sub, { dev: number[][]; dias: number[] }> {
  const out = {} as Record<Sub, { dev: number[][]; dias: number[] }>;
  for (const s of SUBS) {
    const days = new Map<string, (number | null)[]>();
    panel.ts.forEach((t, i) => {
      const d = brtDate(t);
      const row = days.get(d) ?? new Array<number | null>(24).fill(null);
      row[brtHour(t)] = panel.values[s][i];
      days.set(d, row);
    });
    const sum = Array.from({ length: 12 }, () => new Array(24).fill(0));
    const dias = new Array(12).fill(0);
    for (const [d, row] of days) {
      if (row.some((v) => v === null || !Number.isFinite(v))) continue;
      const mean = (row as number[]).reduce((a, b) => a + b, 0) / 24;
      const c = Number(d.slice(5, 7)) - 1;
      row.forEach((v, h) => (sum[c][h] += (v as number) - mean));
      dias[c]++;
    }
    const tot = dias.reduce((a, b) => a + b, 0);
    const avg = Array.from({ length: 24 }, (_, h) => (tot ? sum.reduce((a, r) => a + r[h], 0) / tot : 0));
    out[s] = {
      dev: sum.map((r, c) => (dias[c] >= MIN_SHAPE_DAYS ? r.map((x) => x / dias[c]) : avg).map((x) => Math.round(x * 100) / 100)),
      dias,
    };
  }
  return out;
}

/** Meses cheios do horizonte do planejamento (o primeiro mês civil depois do início, até 12). */
const fullMonths = (r: PlanReport) => r.resultado.meses.filter((m) => m.cobertura >= 0.999 && m.mes > r.start.slice(0, 7)).slice(0, 12);

/** ρ entre meses que reproduz, na faixa dos cenários do SDDP, a largura da média de 12 meses que o SDDP produziu. */
export function sddpRho(r: PlanReport): Record<Sub, number | null> {
  const ms = fullMonths(r);
  const s12 = sddp12(r);
  const out = {} as Record<Sub, number | null>;
  for (const s of SUBS) {
    const bands: MonthBand[] = ms.map((m) => ({ mes: m.mes, p10: sddpPld(m)[s].p10, p50: sddpPld(m)[s].p50, p90: sddpPld(m)[s].p90 }));
    const widths = bands.map((b) => (b.p90 ?? NaN) - (b.p50 ?? NaN));
    const w = widths.reduce((a, b) => a + b, 0) / widths.length;
    const q = s12?.[s];
    const target = q && q.p90 !== null && q.p50 !== null && w > 1e-6 ? (q.p90 - q.p50) / w : NaN;
    out[s] = ms.length === 12 && Number.isFinite(target) ? impliedRho(bands, target, ms.map((m) => limitsFor(Number(m.mes.slice(0, 4))).min)) : null;
  }
  return out;
}

export async function buildFreeMarketInputs(now = Date.now()) {
  const [plan, pld] = await Promise.all([loadPlanReport().catch(() => null), getPld(400)]);
  const report = plan?.report ?? null;
  const panel = pld.ok && pld.data && !pld.simulated ? pld.data : null;
  const key = `mercado-livre:${report?.generatedAt ?? "-"}:${panel ? panel.ts[panel.ts.length - 1] : "-"}`;
  const { value } = await cached(key, 30 * 60_000, async () => {
    const ms = report ? fullMonths(report) : [];
    const meses = ms.map((m) => {
      const y = Number(m.mes.slice(0, 4));
      const lim = limitsFor(y);
      const pub = headlinePld(m);
      return {
        mes: m.mes,
        lim: { min: lim.min, maxHourly: lim.maxHourly },
        limAno: lim.year,
        band: Object.fromEntries(SUBS.map((s) => [s, { mes: m.mes, p10: headlineBand(m, s).p10, p50: pub[s].p50, p90: headlineBand(m, s).p90 } satisfies MonthBand])) as Record<Sub, MonthBand>,
      };
    });
    return { meses, rho: report ? sddpRho(report) : null, forma: panel ? hourlyShape(panel) : null };
  });
  const ageDays = report ? planAgeDays(report, now) : null;
  const notes: string[] = [];
  if (!report) notes.push("Sem relatório do planejamento: o simulador precisa das faixas de preço dos próximos 12 meses.");
  else if (ageDays !== null && ageDays > PLAN_STALE_DAYS) notes.push(`As faixas de preço vêm do relatório do planejamento de ${report.asof}; o worker diário está atrasado.`);
  if (!panel) notes.push("Sem o PLD horário do último ano: a forma das horas não pôde ser medida.");
  if (value.meses.some((m) => m.limAno < Number(m.mes.slice(0, 4)))) notes.push(`Os limites do PLD de ${new Date(now).getUTCFullYear() + 1} ainda não foram publicados: valem os de ${PLD_LIMITS.year}.`);
  return {
    generatedAt: now,
    plano: report ? { asof: report.asof, generatedAt: report.generatedAt, ageDays, stale: ageDays !== null && ageDays > PLAN_STALE_DAYS, combinacao: !!report.combinacao } : null,
    ...value,
    pld: { meta: publicMeta(pld), simulated: pld.simulated, fallback: pld.fallback ?? null },
    bandeiras: BANDEIRAS_RS_MWH,
    notes,
  };
}

export type FreeMarketInputs = Awaited<ReturnType<typeof buildFreeMarketInputs>>;
