/**
 * Modelo econômico-financeiro da Aferi Capital (perspectiva do cotista).
 *
 * API pública:
 *  - analyzeFinance(plant, generation, market, { monteCarloRuns?, seed? }) → FinancialResult
 *  - fioBChargedPct(accessRequestYear, calendarYear) → % do Fio B cobrado (Lei 14.300/2022)
 *  - npv(ratePct, cashFlows) / irr(cashFlows) → VPL em R$ / TIR em % (null sem troca de sinal)
 *  - projectCotas(finance, cotas) → aporte, rendimentos e payback de um investidor
 */

export { analyzeFinance, nominalDiscountRatePct, RISK_PREMIUM_PP } from "./analyze";
export { fioBChargedPct } from "./regulation";
export { npv, irr, paybackYears, percentile, realRatePct } from "./metrics";
export { projectCotas, type CotasProjection } from "./cotas";
export { buildCashFlows, type ScenarioParams } from "./cashflow";
export { cdiPathPct, longTermNominalPct } from "./benchmarks";
export { createRng, mulberry32 } from "./prng";
export { fmtBRL, fmtNum, fmtPct } from "./format";
