/**
 * Análise econômico-financeira do cotista: caso-base, indicadores, comparativos, Monte Carlo e
 * sensibilidade. Toda a aritmética de caixa passa por buildCashFlows (cashflow.ts).
 *
 * Taxa de desconto nominal = (1 + juro real)(1 + IPCA LP) − 1 + prêmio de risco de 3,0 p.p. (risco de
 * projeto de GD: regulatório, de contraparte dos assinantes e de liquidez da cota).
 */

import type { FinancialResult, GenerationResult, MarketRates, Plant } from "@/lib/types";
import { cdiPathPct, computeBenchmarks, geometricMeanPct, longTermNominalPct } from "./benchmarks";
import { buildCashFlows, type ScenarioParams } from "./cashflow";
import { fmtBRL, fmtNum, fmtPct } from "./format";
import { discountFlows, irr, npv, paybackYears, realRatePct } from "./metrics";
import { MC_IPCA_SD_PP, runMonteCarlo } from "./montecarlo";
import { fioBChargedPct, GRANDFATHER_UNTIL_YEAR } from "./regulation";
import { FIOB_STRESS_FROM_YEAR, runSensitivity } from "./sensitivity";

/** prêmio de risco sobre a taxa livre de risco real + IPCA, p.p. */
export const RISK_PREMIUM_PP = 3.0;
export const DEFAULT_MC_RUNS = 2000;
export const DEFAULT_MC_SEED = 42;

/** Taxa de desconto nominal, % a.a. */
export function nominalDiscountRatePct(realPct: number, ipcaPct: number): number {
  return ((1 + realPct / 100) * (1 + ipcaPct / 100) - 1) * 100 + RISK_PREMIUM_PP;
}

/** Energia P50 de cada ano 1..N a partir de `generation.yearly` (extrapola com degradação linear se faltar) */
export function energyProfileMWh(plant: Plant, generation: GenerationResult, years: number): number[] {
  const byYear = new Map(generation.yearly.map((y) => [y.year, y.energyMWh]));
  const d = plant.tech.degradation.annualPct / 100;
  return Array.from({ length: years }, (_, i) => byYear.get(i + 1) ?? generation.annualP50MWh * Math.max(0, 1 - d * i));
}

/**
 * Analisa a usina do ponto de vista do cotista.
 * `irrNominalPct`/`irrRealPct` valem NaN se a TIR não existir (fluxos sem troca de sinal).
 */
export function analyzeFinance(plant: Plant, generation: GenerationResult, market: MarketRates, opts?: { monteCarloRuns?: number; seed?: number }): FinancialResult {
  const f = plant.finance;
  const runs = Math.max(0, Math.round(opts?.monteCarloRuns ?? DEFAULT_MC_RUNS));
  const seed = opts?.seed ?? DEFAULT_MC_SEED;
  const N = Math.max(1, Math.round(f.horizonYears));
  const energy = energyProfileMWh(plant, generation, N);
  const discountRatePct = nominalDiscountRatePct(market.realRatePct, market.ipcaLongTermPct);

  const base: ScenarioParams = {
    energyMWh: energy,
    ipcaPct: market.ipcaLongTermPct,
    tariffRealGrowthPct: f.tariffRealGrowthPct,
    tariffMult: 1,
    clientDiscountPct: f.clientDiscountPct,
    revenueLossPct: f.revenueLossPct,
    opexMult: 1,
    omMult: 1,
    capexMult: 1,
    fioBFullFromYear: null,
    discountRatePct,
  };
  const cf = buildCashFlows(plant, base);
  const investment = cf.investmentBRL;
  const flows = cf.flows;

  const npvBRL = npv(discountRatePct, flows);
  const irrNominalPct = irr(flows) ?? NaN;
  const irrRealPct = realRatePct(irrNominalPct, market.ipcaLongTermPct);
  const payback = paybackYears(flows);
  const discountedPayback = paybackYears(discountFlows(discountRatePct, flows));

  // LCOE = VP(captação + OPEX + reposições) / VP(energia)
  const r = discountRatePct / 100;
  let pvCosts = 0;
  let pvEnergy = 0;
  for (let t = 0; t < cf.costs.length; t++) {
    const v = (1 + r) ** -t;
    pvCosts += cf.costs[t] * v;
    if (t > 0) pvEnergy += energy[t - 1] * v;
  }
  const lcoe = pvEnergy > 0 ? pvCosts / pvEnergy : NaN;

  const distributions = flows.slice(1).reduce((s, x) => s + x, 0);
  const totalCotas = plant.token.totalCotas;

  const cdiPath = cdiPathPct(market, N);
  const cdiReferencePct = geometricMeanPct(cdiPath);
  const interannualPct = generation.uncertainty.interannualPct;
  const biasPct = Math.hypot(generation.uncertainty.resourceDataPct, generation.uncertainty.modelPct);

  const monteCarlo = runMonteCarlo({
    plant,
    base,
    baseEnergyMWh: energy,
    annualDegradationPct: plant.tech.degradation.annualPct,
    interannualPct,
    biasPct,
    discountRateForIpca: (ipca) => nominalDiscountRatePct(market.realRatePct, ipca),
    cdiReferencePct,
    runs,
    seed,
  });

  // cenários de geração para o investidor: conservador (P90), base (P50) e otimista (simétrico ao P90)
  const p90Ratio = generation.annualP50MWh > 0 ? generation.p90MWh / generation.annualP50MWh : 0.9;
  const scenarios = (
    [
      ["conservador", p90Ratio],
      ["base", 1],
      ["otimista", 2 - p90Ratio],
    ] as const
  ).map(([name, mult]) => {
    const sf = buildCashFlows(plant, { ...base, energyMWh: energy.map((e) => e * mult) }).flows;
    const dist = sf.slice(1).reduce((a, x) => a + x, 0);
    return { name, energyMult: mult, irrNominalPct: irr(sf) ?? NaN, avgMonthlyPerCotaBRL: dist / N / 12 / totalCotas };
  });

  return {
    scenarios,
    investmentBRL: investment,
    capexBRL: cf.capexBRL,
    discountRatePct,
    cashFlows: cf.rows,
    npvBRL,
    irrNominalPct,
    irrRealPct,
    paybackYears: payback,
    discountedPaybackYears: discountedPayback,
    lcoeBRLPerMWh: lcoe,
    roiTotalPct: ((distributions - investment) / investment) * 100,
    moic: distributions / investment,
    firstYearYieldPct: (flows[1] / investment) * 100,
    avgYieldPct: (distributions / N / investment) * 100,
    perCota: {
      priceBRL: plant.token.cotaPriceBRL,
      firstYearIncomeBRL: flows[1] / totalCotas,
      avgMonthlyIncomeBRL: distributions / N / 12 / totalCotas,
      totalIncomeBRL: distributions / totalCotas,
    },
    benchmarks: computeBenchmarks(market, N, flows, irrNominalPct),
    monteCarlo,
    sensitivity: runSensitivity(plant, base),
    assumptions: buildAssumptions(plant, generation, market, { N, investment, capex: cf.capexBRL, discountRatePct, cdiReferencePct, runs, seed, energyY1: energy[0] }),
  };
}

function buildAssumptions(
  plant: Plant,
  generation: GenerationResult,
  market: MarketRates,
  c: { N: number; investment: number; capex: number; discountRatePct: number; cdiReferencePct: number; runs: number; seed: number; energyY1: number },
): { label: string; value: string }[] {
  const f = plant.finance;
  const t = plant.tech;
  const tk = plant.token;
  const endYear = f.startYear + c.N - 1;
  const a: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => a.push({ label, value });

  add("Captação (cotas × preço)", `${fmtNum(tk.totalCotas, 0)} cotas × ${fmtBRL(tk.cotaPriceBRL, 2)} = ${fmtBRL(c.investment)}`);
  add("Custo de estruturação", `${fmtPct(tk.structuringFeePct)} da captação (${fmtBRL(c.investment - c.capex)}) — jurídico, auditoria e plataforma`);
  add("CAPEX da usina", `${fmtBRL(c.capex)} (${fmtBRL(c.capex / (t.dcKWp * 1000), 2)}/Wp)`);
  add("Estrutura de capital", "SPE 100 % capital próprio, sem dívida; caixa líquido anual distribuído integralmente aos cotistas");
  add("Horizonte", `${fmtNum(c.N, 0)} anos de operação (${f.startYear}–${endYear}); captação no ano 0 (${f.startYear - 1})`);
  add("Base monetária", `Tarifa, Fio B, PPA e OPEX em moeda do 1º ano de operação (${f.startYear}), reajustados anualmente a partir do ano 2`);
  add(
    "Energia P50 do ano 1",
    `${fmtNum(c.energyY1, 0)} MWh (${fmtNum(generation.specificYieldKWhPerKWp, 0)} kWh/kWp), degradação de ${fmtNum(t.degradation.annualPct, 2)} %/ano linear a partir do ano 2`,
  );

  if (f.revenueModel === "ppa") {
    add("Modelo de receita", "PPA (contrato de compra de energia de longo prazo)");
    add("Preço do PPA", `${fmtBRL(f.ppaPriceBRLPerMWh ?? 0, 2)}/MWh, reajustado pelo IPCA`);
  } else {
    add("Modelo de receita", "Geração compartilhada por assinatura: créditos de energia cedidos com desconto (Lei 14.300/2022)");
    add("Tarifa B1 (com impostos)", `${fmtBRL(f.tariffBRLPerKWh, 2)}/kWh`);
    add("TUSD Fio B", `${fmtBRL(f.fioBBRLPerKWh, 2)}/kWh`);
    if (f.accessRequestYear <= 2022) {
      add(
        "Regra do Fio B",
        `Solicitação de acesso em ${f.accessRequestYear}: direito adquirido (art. 26) — sem cobrança do Fio B até ${GRANDFATHER_UNTIL_YEAR}; 100 % a partir de ${GRANDFATHER_UNTIL_YEAR + 1}`,
      );
    } else {
      const sched = [2023, 2024, 2025, 2026, 2027, 2028].map((y) => `${y}: ${fioBChargedPct(f.accessRequestYear, y)} %`).join("; ");
      add("Regra do Fio B", `Solicitação de acesso em ${f.accessRequestYear}: transição do art. 27 (${sched}; 100 % a partir de 2029)`);
    }
    add("Fio B a partir de 2029", "Premissa: a valoração da ANEEL (art. 17) mantém a cobrança em 100 % do Fio B (sem crédito pelos benefícios da GD)");
    add("Art. 27, §1º (minigeração > 500 kW)", "Não aplicado: assume-se carteira pulverizada de assinantes, nenhum com ≥ 25 % dos créditos");
    add("Desconto ao assinante", `${fmtPct(f.clientDiscountPct)} sobre o valor do crédito`);
    add("Perdas de receita", `${fmtPct(f.revenueLossPct)} (energia não compensada + inadimplência)`);
    add("Crescimento real da tarifa", `${fmtNum(f.tariffRealGrowthPct, 2)} % a.a. acima do IPCA (aplicado à tarifa e ao Fio B)`);
  }

  add("O&M", `${fmtBRL(f.omBRLPerKWpYear, 2)}/kWp·ano (${fmtBRL(f.omBRLPerKWpYear * t.dcKWp)} no ano 1), reajuste pelo IPCA`);
  add("Seguro", `${fmtNum(f.insurancePctCapex, 2)} % do CAPEX a.a., reajuste pelo IPCA`);
  add("Arrendamento do terreno", `${fmtBRL(f.landLeaseBRLYear)}/ano, reajuste pelo IPCA`);
  add("Taxa de gestão (SPE/plataforma)", `${fmtPct(f.adminFeePctRevenue)} da receita`);
  add("Tributos sobre a receita", `${fmtNum(f.taxPctRevenue, 2)} % (lucro presumido: PIS/COFINS + IRPJ/CSLL)`);
  if (f.inverterReplacementYear >= 1 && f.inverterReplacementYear <= c.N) {
    add(
      "Reposição de inversores",
      `Ano ${f.inverterReplacementYear} (${f.startYear + f.inverterReplacementYear - 1}): ${fmtBRL(f.inverterReplacementBRLPerKW)}/kW × ${fmtNum(t.acKW, 0)} kW = ${fmtBRL(f.inverterReplacementBRLPerKW * t.acKW)} em moeda do ano 1, reajustado pelo IPCA`,
    );
  }

  add("Selic (meta)", `${fmtPct(market.selicPct, 2)} a.a.`);
  add("CDI", `${fmtPct(market.cdiPct, 2)} a.a.`);
  add("IPCA 12 meses", fmtPct(market.ipca12mPct, 2));
  add("IPCA de longo prazo (premissa do modelo)", `${fmtPct(market.ipcaLongTermPct, 2)} a.a.`);
  add("Juro real de longo prazo (NTN-B)", `${fmtPct(market.realRatePct, 2)} a.a.`);
  add(
    "Taxa de desconto nominal",
    `${fmtPct(c.discountRatePct, 2)} a.a. = (1 + ${fmtPct(market.realRatePct, 2)})(1 + ${fmtPct(market.ipcaLongTermPct, 2)}) − 1 + prêmio de risco de ${fmtNum(RISK_PREMIUM_PP, 1)} p.p.`,
  );
  add("TIR real", "Relação de Fisher: (1 + TIR nominal)/(1 + IPCA de longo prazo) − 1");
  add("LCOE", "VP(captação + OPEX + reposições) / VP(energia) à taxa de desconto nominal; não inclui os tributos sobre a receita");
  add("Payback", "Anos até o fluxo acumulado ficar positivo, com interpolação dentro do ano; o descontado usa a taxa de desconto nominal");
  add(
    "Monte Carlo",
    `${fmtNum(c.runs, 0)} rodadas, semente ${c.seed} (mulberry32 + Box-Muller); P(TIR < CDI) compara com o CDI médio projetado no horizonte (${fmtPct(c.cdiReferencePct, 2)} a.a.); IPCA sorteado com desvio de ${fmtNum(MC_IPCA_SD_PP, 0)} p.p.`,
  );
  add(
    "Sensibilidade",
    `CAPEX ±10 % altera a captação necessária na mesma proporção (mesma usina, mesmo fluxo), com seguro e reposição acompanhando; OPEX ±20 % sobre O&M, seguro e arrendamento; estresse regulatório com Fio B a 100 % desde ${FIOB_STRESS_FROM_YEAR}`,
  );
  add("Comparativos", `CDI convergindo para ${fmtPct(longTermNominalPct(market), 2)} a.a. (juro real + IPCA LP); IR de 15 % no CDI e no Tesouro IPCA+; poupança isenta; rendimento da usina bruto`);
  if (market.provenance.length > 0) {
    // resumo curto; o detalhe de cada fonte (URL, horário, status) fica na tabela de procedência
    const live = market.provenance.filter((p) => p.status === "live" || p.status === "cache").length;
    add("Fontes de mercado", `BCB (SGS, Focus) e cotações cripto — ${live} de ${market.provenance.length} ao vivo`);
  }
  return a;
}
