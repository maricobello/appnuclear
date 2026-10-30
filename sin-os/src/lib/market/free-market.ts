import "server-only";
import { cached } from "../cache";
import { getPld, publicMeta } from "../data";
import { headlineBand, headlinePld, PLAN_STALE_DAYS, planAgeDays, sddp12, sddpPld, type PlanReport } from "../planning/report";
import { loadPlanReport } from "../planning/store";
import { brtDate, brtHour } from "../sources/time";
import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { limitsFor, PLD_LIMITS } from "./brazil";
import { daysOfMonths, equivalentDay } from "./calendar";
import { impliedRho, monthCap, type MonthBand } from "./contracting";
import { BANDEIRAS_RS_MWH } from "./radar";

/** Dias com dado para a forma horária do mês civil; abaixo disso usa a média dos 12 meses. */
const MIN_SHAPE_DAYS = 7;
/** Janela do PLD horário: forma dos dias (último ano) e correlação entre submercados (~2 anos). */
const PLD_DAYS = 760;
/** Meses com pelo menos este tanto de horas entram na correlação entre submercados. */
const MIN_MONTH_HOURS = 600;

type DayRows = Map<string, (number | null)[]>;

function dayRows(panel: SubPanel, s: Sub): DayRows {
  const days: DayRows = new Map();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    const row = days.get(d) ?? new Array<number | null>(24).fill(null);
    row[brtHour(t)] = panel.values[s][i];
    days.set(d, row);
  });
  return days;
}

const complete = (row: (number | null)[]): row is number[] => row.every((v) => v !== null && Number.isFinite(v));

/**
 * Forma horária média do PLD por submercado: desvio de cada hora em relação à média do dia, por mês
 * civil, nos dias completos da janela (usada no gráfico e quando falta um dia equivalente).
 */
export function hourlyShape(panel: SubPanel): Record<Sub, { dev: number[][]; dias: number[] }> {
  const out = {} as Record<Sub, { dev: number[][]; dias: number[] }>;
  for (const s of SUBS) {
    const sum = Array.from({ length: 12 }, () => new Array(24).fill(0));
    const dias = new Array(12).fill(0);
    for (const [d, row] of dayRows(panel, s)) {
      if (!complete(row)) continue;
      const mean = row.reduce((a, b) => a + b, 0) / 24;
      const c = Number(d.slice(5, 7)) - 1;
      row.forEach((v, h) => (sum[c][h] += v - mean));
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

/**
 * Desvio do PLD em cada hora do horizonte do contrato: o dia equivalente do histórico (mesmo tipo de
 * dia e mês civil, ~52 semanas antes) menos a média do mês dele. Sem dia equivalente, a forma média
 * do mês civil.
 */
export function contractDeviations(panel: SubPanel, months: string[]): Record<Sub, { dev: number[]; equivalentes: number; semEquivalente: number }> {
  const days = daysOfMonths(months);
  const shape = hourlyShape(panel);
  const out = {} as Record<Sub, { dev: number[]; equivalentes: number; semEquivalente: number }>;
  for (const s of SUBS) {
    const rows = dayRows(panel, s);
    const monthSum = new Map<string, { sum: number; n: number }>();
    for (const [d, row] of rows)
      for (const v of row)
        if (v !== null && Number.isFinite(v)) {
          const acc = monthSum.get(d.slice(0, 7)) ?? { sum: 0, n: 0 };
          acc.sum += v;
          acc.n++;
          monthSum.set(d.slice(0, 7), acc);
        }
    const has = (d: string) => {
      const r = rows.get(d);
      return !!r && complete(r);
    };
    const dev: number[] = [];
    let eqs = 0;
    let none = 0;
    for (const { date } of days) {
      const eq = equivalentDay(date, has);
      if (eq) {
        const ms = monthSum.get(eq.slice(0, 7))!;
        const mean = ms.sum / ms.n;
        for (const v of rows.get(eq) as number[]) dev.push(Math.round((v - mean) * 10) / 10);
        eqs++;
      } else {
        for (const v of shape[s].dev[Number(date.slice(5, 7)) - 1]) dev.push(Math.round(v * 10) / 10);
        none++;
      }
    }
    out[s] = { dev, equivalentes: eqs, semEquivalente: none };
  }
  return out;
}

/** Correlação entre as variações mensais do log do PLD médio de cada par de submercados. */
export function subCorrelation(panel: SubPanel): Record<Sub, Record<Sub, number | null>> {
  const monthly = {} as Record<Sub, Map<string, number>>;
  for (const s of SUBS) {
    const acc = new Map<string, { sum: number; n: number }>();
    panel.ts.forEach((t, i) => {
      const v = panel.values[s][i];
      if (v === null || !Number.isFinite(v)) return;
      const m = brtDate(t).slice(0, 7);
      const a = acc.get(m) ?? { sum: 0, n: 0 };
      a.sum += v;
      a.n++;
      acc.set(m, a);
    });
    monthly[s] = new Map([...acc].filter(([, a]) => a.n >= MIN_MONTH_HOURS).map(([m, a]) => [m, Math.log(a.sum / a.n)]));
  }
  const months = [...monthly.SE.keys()].sort();
  const diffs = (s: Sub) =>
    months.slice(1).map((m, i) => {
      const a = monthly[s].get(m);
      const b = monthly[s].get(months[i]);
      return a !== undefined && b !== undefined ? a - b : NaN;
    });
  const d = Object.fromEntries(SUBS.map((s) => [s, diffs(s)])) as Record<Sub, number[]>;
  const corr = (x: number[], y: number[]) => {
    const pairs = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (pairs.length < 8) return null;
    const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
    const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [a, b] of pairs) {
      sxy += (a - mx) * (b - my);
      sxx += (a - mx) ** 2;
      syy += (b - my) ** 2;
    }
    return sxx > 0 && syy > 0 ? Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000 : null;
  };
  return Object.fromEntries(SUBS.map((a) => [a, Object.fromEntries(SUBS.map((b) => [b, a === b ? 1 : corr(d[a], d[b])]))])) as Record<Sub, Record<Sub, number | null>>;
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
    const lims = ms.map((m) => limitsFor(Number(m.mes.slice(0, 4))));
    out[s] = ms.length === 12 && Number.isFinite(target) ? impliedRho(bands, target, lims.map((l) => l.min), lims.map(monthCap)) : null;
  }
  return out;
}

export async function buildFreeMarketInputs(now = Date.now()) {
  const [plan, pld] = await Promise.all([loadPlanReport().catch(() => null), getPld(PLD_DAYS)]);
  const report = plan?.report ?? null;
  const panel = pld.ok && pld.data && !pld.simulated ? pld.data : null;
  const key = `mercado-livre:v3:${report?.generatedAt ?? "-"}:${panel ? panel.ts[panel.ts.length - 1] : "-"}`;
  const { value } = await cached(key, 30 * 60_000, async () => {
    const ms = report ? fullMonths(report) : [];
    const meses = ms.map((m) => {
      const y = Number(m.mes.slice(0, 4));
      const lim = limitsFor(y);
      const pub = headlinePld(m);
      return {
        mes: m.mes,
        lim: { min: lim.min, maxHourly: lim.maxHourly, maxStructural: lim.maxStructural },
        limAno: lim.year,
        band: Object.fromEntries(SUBS.map((s) => [s, { mes: m.mes, p10: headlineBand(m, s).p10, p50: pub[s].p50, p90: headlineBand(m, s).p90 } satisfies MonthBand])) as Record<Sub, MonthBand>,
      };
    });
    return {
      meses,
      rho: report ? sddpRho(report) : null,
      forma: panel ? hourlyShape(panel) : null,
      horaria: panel && ms.length ? contractDeviations(panel, ms.map((m) => m.mes)) : null,
      correlacao: panel ? subCorrelation(panel) : null,
    };
  });
  const ageDays = report ? planAgeDays(report, now) : null;
  const notes: string[] = [];
  if (!report) notes.push("Sem relatório do planejamento: o simulador precisa das faixas de preço dos próximos 12 meses.");
  else if (ageDays !== null && ageDays > PLAN_STALE_DAYS) notes.push(`As faixas de preço vêm do relatório do planejamento de ${report.asof}; o worker diário está atrasado.`);
  if (!panel) notes.push("Sem o PLD horário do histórico: a forma das horas e dos dias não pôde ser medida.");
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
