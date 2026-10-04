/**
 * Incerteza da produção anual e probabilidades de excedência (P50/P75/P90/P99).
 *
 * Prática usual de due diligence: incertezas independentes combinadas em quadratura e produção
 * anual tratada como normal em torno do P50 — Dobos, A. P., Gilman, P. & Kasberg, M. (2012),
 * "P50/P90 Analysis for Solar Energy Systems Using the System Advisor Model", NREL/CP-6A20-54488;
 * Thevenard, D. & Pelland, S. (2013), "Estimating the uncertainty in long-term photovoltaic yield
 * predictions", Solar Energy 91:432–445; IEC 61724-1 (monitoramento) para a definição de PR.
 *
 *   σ_total = √(σ_interanual² + σ_dados² + σ_modelo² + σ_degradação²)
 *   P_x = P50 · (1 − z_x · σ_total),  z75 = 0,6745, z90 = 1,2816, z99 = 2,3263
 *   P90 de 10 anos: σ_interanual/√10 (a média de 10 anos varia menos que um ano isolado).
 */

/** incerteza dos dados de recurso (satélite/reanálise vs. medição em solo), % */
export const SIGMA_RESOURCE_DATA_PCT = 5;
/**
 * quando TODO o recurso vem do fallback embarcado (médias aproximadas do Atlas INPE 2017, sem série
 * consultada), a incerteza dos dados é elevada para 7 % — honestidade estatística.
 */
export const SIGMA_RESOURCE_DATA_FALLBACK_PCT = 7;
/** incerteza do modelo de transposição/conversão (dia-tipo mensal), % */
export const SIGMA_MODEL_PCT = 3;
/** incerteza da degradação de longo prazo, % */
export const SIGMA_DEGRADATION_PCT = 1;

export const Z_P75 = 0.6745;
export const Z_P90 = 1.2816;
export const Z_P99 = 2.3263;

export interface UncertaintyBudget {
  interannualPct: number;
  resourceDataPct: number;
  modelPct: number;
  degradationPct: number;
  totalPct: number;
}

export function uncertaintyBudget(interannualPct: number, resourceDataPct = SIGMA_RESOURCE_DATA_PCT, modelPct = SIGMA_MODEL_PCT, degradationPct = SIGMA_DEGRADATION_PCT): UncertaintyBudget {
  const totalPct = Math.sqrt(interannualPct ** 2 + resourceDataPct ** 2 + modelPct ** 2 + degradationPct ** 2);
  return { interannualPct, resourceDataPct, modelPct, degradationPct, totalPct };
}

/** σ total para a média de `years` anos (variabilidade interanual dividida por √years) */
export function multiYearSigmaPct(u: UncertaintyBudget, years: number): number {
  return Math.sqrt(u.interannualPct ** 2 / years + u.resourceDataPct ** 2 + u.modelPct ** 2 + u.degradationPct ** 2);
}

/** Valor de excedência: P50 · (1 − z·σ) */
export function exceedance(p50: number, sigmaPct: number, z: number): number {
  return Math.max(0, p50 * (1 - (z * sigmaPct) / 100));
}
