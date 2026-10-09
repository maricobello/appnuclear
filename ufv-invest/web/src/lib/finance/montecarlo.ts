/**
 * Simulação de Monte Carlo do retorno do cotista.
 *
 * Cada rodada sorteia (gerador determinístico mulberry32 + Box-Muller, ver prng.ts) e recalcula o
 * fluxo com a MESMA função do caso-base (buildCashFlows):
 *  - geração anual = P50_ano × ε_ano × viés, com ε_ano ~ N(1, σ_interanual) i.i.d. por ano e um viés
 *    persistente ~ N(1, √(σ_dados² + σ_modelo²)) — erro de recurso/modelo que não "tira média" no tempo;
 *  - crescimento real da tarifa ~ N(base, 1,5 p.p.) (persistente na rodada);
 *  - sobrecusto de O&M ~ lognormal(μ = 0, σ = 0,2) (mediana 1, média ≈ 1,02);
 *  - taxa de degradação anual × U(0,6; 1,6);
 *  - perdas de receita (não compensação + inadimplência) ~ U(2 %; 10 %);
 *  - IPCA de longo prazo ~ N(base, 1 p.p.); a taxa de desconto nominal acompanha o IPCA sorteado
 *    (relação de Fisher), para que inflação maior não infle o VPL artificialmente.
 * Rodadas sem TIR definida (fluxos sem troca de sinal) entram nos percentis como −100 % e ficam fora do
 * histograma.
 */

import type { MonteCarloSummary, Plant } from "@/lib/types";
import { buildCashFlows, type ScenarioParams } from "./cashflow";
import { fmtNum } from "./format";
import { irr, npv, percentile } from "./metrics";
import { createRng } from "./prng";

export const MC_TARIFF_GROWTH_SD_PP = 1.5;
export const MC_OM_LOGNORMAL_SIGMA = 0.2;
export const MC_DEGRADATION_MULT: [number, number] = [0.6, 1.6];
export const MC_REVENUE_LOSS_PCT: [number, number] = [2, 10];
export const MC_IPCA_SD_PP = 1;
export const MC_HISTOGRAM_BINS = 20;

export interface MonteCarloInputs {
  plant: Plant;
  base: ScenarioParams;
  /** P50 anual com degradação do caso-base, MWh (índice 0 = ano 1) */
  baseEnergyMWh: number[];
  annualDegradationPct: number;
  interannualPct: number;
  biasPct: number;
  /** função que dá a taxa de desconto nominal para um IPCA */
  discountRateForIpca: (ipcaPct: number) => number;
  /** CDI de referência para P(TIR < CDI), % */
  cdiReferencePct: number;
  runs: number;
  seed: number;
}

export function runMonteCarlo(inp: MonteCarloInputs): MonteCarloSummary {
  const rng = createRng(inp.seed);
  const N = inp.baseEnergyMWh.length;
  const d = inp.annualDegradationPct / 100;
  const irrs: number[] = [];
  const npvs: number[] = [];
  let irrBelowCdi = 0;
  let npvNeg = 0;
  const energy = new Array<number>(N);

  for (let run = 0; run < inp.runs; run++) {
    // ordem fixa de sorteios → reprodutível
    const bias = rng.normal(1, inp.biasPct / 100);
    const tariffGrowth = rng.normal(inp.base.tariffRealGrowthPct, MC_TARIFF_GROWTH_SD_PP);
    const omMult = rng.lognormal(0, MC_OM_LOGNORMAL_SIGMA);
    const degMult = rng.uniformRange(MC_DEGRADATION_MULT[0], MC_DEGRADATION_MULT[1]);
    const revenueLoss = rng.uniformRange(MC_REVENUE_LOSS_PCT[0], MC_REVENUE_LOSS_PCT[1]);
    const ipca = rng.normal(inp.base.ipcaPct, MC_IPCA_SD_PP);
    for (let y = 0; y < N; y++) {
      const baseDeg = 1 - d * y;
      const degRatio = baseDeg > 0 ? Math.max(0, 1 - degMult * d * y) / baseDeg : 1;
      const eps = rng.normal(1, inp.interannualPct / 100);
      energy[y] = Math.max(0, inp.baseEnergyMWh[y] * degRatio * bias * eps);
    }
    const discount = inp.discountRateForIpca(ipca);
    const cf = buildCashFlows(inp.plant, {
      ...inp.base,
      energyMWh: energy,
      ipcaPct: ipca,
      tariffRealGrowthPct: tariffGrowth,
      omMult,
      revenueLossPct: revenueLoss,
      discountRatePct: discount,
    });
    const v = npv(discount, cf.flows);
    const r = irr(cf.flows);
    npvs.push(v);
    irrs.push(r ?? -100);
    if (r === null || r < inp.cdiReferencePct) irrBelowCdi++;
    if (v < 0) npvNeg++;
  }

  const irrSorted = Float64Array.from(irrs).sort();
  const npvSorted = Float64Array.from(npvs).sort();
  const valid = irrs.filter((x) => x > -100);
  const histogram: MonteCarloSummary["histogram"] = [];
  if (valid.length > 0) {
    let lo = Math.min(...valid);
    let hi = Math.max(...valid);
    if (hi - lo < 1e-9) {
      lo -= 0.5;
      hi += 0.5;
    }
    const w = (hi - lo) / MC_HISTOGRAM_BINS;
    const counts = new Array<number>(MC_HISTOGRAM_BINS).fill(0);
    for (const x of valid) counts[Math.min(MC_HISTOGRAM_BINS - 1, Math.floor((x - lo) / w))]++;
    for (let b = 0; b < MC_HISTOGRAM_BINS; b++) histogram.push({ fromPct: lo + b * w, toPct: lo + (b + 1) * w, count: counts[b] });
  }

  const runs = inp.runs;
  return {
    runs,
    seed: inp.seed,
    irrP10Pct: percentile(irrSorted, 10),
    irrP50Pct: percentile(irrSorted, 50),
    irrP90Pct: percentile(irrSorted, 90),
    npvP10BRL: percentile(npvSorted, 10),
    npvP50BRL: percentile(npvSorted, 50),
    npvP90BRL: percentile(npvSorted, 90),
    probIrrBelowCdiPct: runs > 0 ? (irrBelowCdi / runs) * 100 : 0,
    probNpvNegativePct: runs > 0 ? (npvNeg / runs) * 100 : 0,
    histogram,
    variables: [
      `Geração anual: variabilidade interanual N(1; σ = ${fmtNum(inp.interannualPct, 1)} %), independente a cada ano`,
      `Geração: viés persistente de recurso solar e modelo N(1; σ = ${fmtNum(inp.biasPct, 1)} %)`,
      `Crescimento real da tarifa: N(${fmtNum(inp.base.tariffRealGrowthPct, 1)} %; ${fmtNum(MC_TARIFF_GROWTH_SD_PP, 1)} p.p.) a.a.`,
      `Sobrecusto de O&M: lognormal (mediana 1; σ = ${fmtNum(MC_OM_LOGNORMAL_SIGMA, 1)})`,
      `Taxa de degradação anual × U(${fmtNum(MC_DEGRADATION_MULT[0], 1)}; ${fmtNum(MC_DEGRADATION_MULT[1], 1)})`,
      `Perdas de receita (não compensação + inadimplência): U(${fmtNum(MC_REVENUE_LOSS_PCT[0], 0)} %; ${fmtNum(MC_REVENUE_LOSS_PCT[1], 0)} %)`,
      `IPCA de longo prazo: N(${fmtNum(inp.base.ipcaPct, 1)} %; ${fmtNum(MC_IPCA_SD_PP, 0)} p.p.), com a taxa de desconto ajustada pela relação de Fisher`,
    ],
  };
}
