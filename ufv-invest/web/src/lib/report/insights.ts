/**
 * Leituras derivadas da análise, usadas no sumário executivo e no texto do relatório. Funções
 * puras (testáveis) que não inventam dados: só combinam o que já está em `PlantAnalysis`.
 */
import type { PlantAnalysis, Provenance, SourceStatus } from "@/lib/types";
import { fmtBRLCompact, fmtBRL, fmtMultiple, fmtNum, fmtPct, fmtPctSigned, fmtYears } from "./format";
import type { Run } from "./layout";
import { C } from "./theme";

/** Alíquota de IR de renda fixa para prazos acima de 720 dias */
export const IR_LONG_TERM = 0.15;

export function cdiNetPct(a: PlantAnalysis): number {
  return a.market.cdiPct * (1 - IR_LONG_TERM);
}

/** Cronograma do Fio B (Lei 14.300/2022, art. 27) para acesso solicitado a partir de 2023 */
export function fioBRuleText(a: PlantAnalysis): string {
  const f = a.plant.finance;
  if (f.revenueModel === "ppa") return "Contrato bilateral (PPA): sem compensação de créditos na distribuidora.";
  if (f.accessRequestYear < 2023)
    return "Solicitação de acesso anterior a 07/01/2023: direito à compensação integral (sem cobrança do Fio B) até 31/12/2045 (Lei 14.300/2022, art. 26).";
  const flows = a.finance.cashFlows.filter((c) => c.year > 0);
  const first = flows[0];
  const full = flows.find((c) => c.fioBChargedPct >= 100);
  const parts: string[] = [];
  if (first) parts.push(`${fmtNum(first.fioBChargedPct, 0)} % em ${first.calendarYear}`);
  if (full && full !== first) parts.push(`100 % a partir de ${full.calendarYear} (hipótese para a regra ANEEL pós-2028)`);
  return `Cobrança gradual do Fio B (Lei 14.300/2022, art. 27)${parts.length ? ": " + parts.join(", ") : ""}.`;
}

/** Regra do Fio B em poucas palavras (para listas de fatos) */
export function fioBShortText(a: PlantAnalysis): string {
  const f = a.plant.finance;
  if (f.revenueModel === "ppa") return "Não se aplica (PPA)";
  if (f.accessRequestYear < 2023) return "Isenta até 2045 (direito adquirido, acesso antes de 07/01/2023)";
  const flows = a.finance.cashFlows.filter((c) => c.year > 0);
  const first = flows[0];
  const full = flows.find((c) => c.fioBChargedPct >= 100);
  const parts: string[] = [];
  if (first) parts.push(`${fmtNum(first.fioBChargedPct, 0)} % cobrado em ${first.calendarYear}`);
  if (full && full !== first) parts.push(`100 % a partir de ${full.calendarYear}`);
  return parts.join("; ") || "Cobrança gradual (transição da Lei 14.300)";
}

export function statusCounts(list: Provenance[]): Record<SourceStatus, number> {
  const out: Record<SourceStatus, number> = { live: 0, cache: 0, fallback: 0, error: 0 };
  for (const p of list) out[p.status] = (out[p.status] ?? 0) + 1;
  return out;
}

export function statusSummary(list: Provenance[]): string {
  const c = statusCounts(list);
  const parts: string[] = [];
  if (c.live) parts.push(`${c.live} ao vivo`);
  if (c.cache) parts.push(`${c.cache} em cache`);
  if (c.fallback) parts.push(`${c.fallback} em fallback`);
  if (c.error) parts.push(`${c.error} com erro`);
  if (parts.length === 0) return "nenhuma fonte registrada";
  const last = parts.pop()!;
  return parts.length ? `${parts.join(", ")} e ${last}` : last;
}

export function crossCheckDeviation(a: PlantAnalysis): { source: string; deviationPct: number; annualMWh: number } | null {
  const g = a.generation;
  if (g.crossCheck && Number.isFinite(g.crossCheck.deviationPct)) return g.crossCheck;
  if (a.pvgis && Number.isFinite(a.pvgis.annualKWhPerKWp) && a.pvgis.annualKWhPerKWp > 0) {
    const mwh = (a.pvgis.annualKWhPerKWp * a.plant.tech.dcKWp) / 1000;
    return { source: "PVGIS", annualMWh: mwh, deviationPct: ((g.annualP50MWh - mwh) / mwh) * 100 };
  }
  return null;
}

const B = (text: string, color?: (typeof C)[keyof typeof C]): Run => ({ text, font: "semibold", color });
const T = (text: string): Run => ({ text });

/** Itens do parecer resumido do sumário executivo (texto rico). */
export function verdictItems(a: PlantAnalysis, provenance: Provenance[]): Run[][] {
  const f = a.finance;
  const g = a.generation;
  const mc = f.monteCarlo;
  const items: Run[][] = [];
  const cdiNet = cdiNetPct(a);
  const spread = f.irrNominalPct - cdiNet;

  items.push([
    T("A TIR nominal P50 de "),
    B(`${fmtPct(f.irrNominalPct)} a.a.`, C.navy),
    T(` (real ${fmtPct(f.irrRealPct)} a.a.) `),
    T(spread >= 0 ? "supera o CDI líquido de IR (" : "fica abaixo do CDI líquido de IR ("),
    T(`${fmtPct(cdiNet)} a.a.) em `),
    B(`${fmtNum(Math.abs(spread), 1)} p.p.`, spread >= 0 ? C.green : C.redStrong),
    T("; probabilidade de TIR abaixo do CDI: "),
    B(fmtPct(mc.probIrrBelowCdiPct), mc.probIrrBelowCdiPct > 20 ? C.redStrong : C.navy),
    T(` (Monte Carlo, ${fmtNum(mc.runs, 0)} cenários; P10–P90 de ${fmtPct(mc.irrP10Pct)} a ${fmtPct(mc.irrP90Pct)}).`),
  ]);

  const npvPositive = f.npvBRL >= 0;
  items.push([
    T("Payback simples de "),
    B(fmtYears(f.paybackYears)),
    T(` (descontado: ${fmtYears(f.discountedPaybackYears)}); VPL `),
    B(npvPositive ? fmtBRLCompact(f.npvBRL) : `negativo de ${fmtBRLCompact(Math.abs(f.npvBRL))}`, npvPositive ? C.green : C.redStrong),
    T(` à taxa de ${fmtPct(f.discountRatePct)} a.a.; múltiplo sobre o capital de ${fmtMultiple(f.moic)} em ${a.plant.finance.horizonYears} anos.`),
  ]);

  const xc = crossCheckDeviation(a);
  const genRuns: Run[] = [
    T("Geração P50 de "),
    B(`${fmtNum(g.annualP50MWh, 0)} MWh/ano`),
    T(` (${fmtNum(g.specificYieldKWhPerKWp, 0)} kWh/kWp, PR ${fmtPct(g.performanceRatioPct)}); P90 de ${fmtNum(g.p90MWh, 0)} MWh/ano (${fmtPctSigned(((g.p90MWh - g.annualP50MWh) / g.annualP50MWh) * 100)}).`),
  ];
  if (xc) {
    const ok = Math.abs(xc.deviationPct) <= 5;
    genRuns.push(
      T(" Desvio frente ao PVGIS: "),
      B(fmtPctSigned(xc.deviationPct), ok ? C.green : C.amberDark),
      T(ok ? " (dentro da faixa de ±5 %)." : " (fora da faixa de ±5 %: revisar premissas)."),
    );
  } else genRuns.push(T(" Validação cruzada com o PVGIS indisponível nesta emissão."));
  items.push(genRuns);

  items.push([
    T("Renda estimada de "),
    B(`${fmtBRL(f.perCota.avgMonthlyIncomeBRL)} por cota/mês`),
    T(` em média (${fmtBRL(f.perCota.firstYearIncomeBRL)} no ano 1 por cota de ${fmtBRL(f.perCota.priceBRL)}; yield de ${fmtPct(f.firstYearYieldPct)} no ano 1).`),
  ]);

  items.push([T(fioBRuleText(a) + " Efeito já refletido no fluxo de caixa.")]);

  const counts = statusCounts(provenance);
  const degraded = counts.fallback + counts.error;
  items.push([
    T(`Fontes de dados: ${statusSummary(provenance)}`),
    T(degraded > 0 ? " — valores de referência sinalizados na seção 8." : "."),
  ]);
  return items;
}
