/**
 * Comparativos de R$ 1.000 aplicados no mesmo horizonte da usina.
 *
 *  - CDI: CDB a 100 % do CDI mantido até o vencimento. Trajetória do CDI com reversão exponencial à
 *    média — do CDI atual para a taxa nominal neutra de longo prazo (1 + juro real)(1 + IPCA LP) − 1,
 *    meia-vida de 2 anos (avaliada no meio de cada ano). IR de 15 % sobre o ganho no resgate
 *    (tabela regressiva, prazo > 720 dias — Lei 11.033/2004, art. 1º).
 *  - Poupança: regra da Lei 12.703/2012 — Selic > 8,5 % a.a.: 0,5 % a.m. + TR; caso contrário 70 % da
 *    Selic + TR. TR assumida ≈ 0 (conservador; com a Selic alta a TR tem sido levemente positiva).
 *    Isenta de IR (pessoa física). Selic = trajetória do CDI + spread atual Selic − CDI.
 *  - Tesouro IPCA+: juro real atual (NTN-B) + IPCA de longo prazo, levado ao vencimento, IR de 15 %
 *    sobre o ganho nominal; sem taxa de custódia da B3 (0,20 % a.a.) e sem marcação a mercado.
 *  - Usina: soma das distribuições (sem reinvestimento), BRUTA — o tratamento tributário dos
 *    rendimentos do token deve ser verificado com contador; e, para comparação de valor final em
 *    base equivalente, a mesma usina com as distribuições reinvestidas em CDB 100 % CDI (líquido de IR).
 */

import type { Benchmark, MarketRates } from "@/lib/types";
import { fmtNum, fmtPct } from "./format";

export const CDI_HALF_LIFE_YEARS = 2;
export const FIXED_INCOME_TAX_RATE = 0.15;
export const POUPANCA_SELIC_THRESHOLD_PCT = 8.5;

/** Taxa nominal neutra de longo prazo: (1 + juro real)(1 + IPCA LP) − 1, % */
export function longTermNominalPct(market: MarketRates): number {
  return ((1 + market.realRatePct / 100) * (1 + market.ipcaLongTermPct / 100) - 1) * 100;
}

/** CDI projetado para cada ano 1..N, % a.a. */
export function cdiPathPct(market: MarketRates, years: number): number[] {
  const lt = longTermNominalPct(market);
  const k = Math.LN2 / CDI_HALF_LIFE_YEARS;
  return Array.from({ length: years }, (_, i) => lt + (market.cdiPct - lt) * Math.exp(-k * (i + 0.5)));
}

/** Média geométrica de uma trajetória de taxas, % a.a. */
export function geometricMeanPct(pathPct: number[]): number {
  if (pathPct.length === 0) return 0;
  const g = pathPct.reduce((acc, p) => acc * (1 + p / 100), 1);
  return (g ** (1 / pathPct.length) - 1) * 100;
}

function poupancaAnnualPct(selicPct: number): number {
  return selicPct > POUPANCA_SELIC_THRESHOLD_PCT ? (1.005 ** 12 - 1) * 100 : 0.7 * selicPct;
}

const netOfTax = (gross: number, principal: number) => principal + (gross - principal) * (1 - FIXED_INCOME_TAX_RATE);

/**
 * @param plantFlows fluxos do cotista (índice 0 = −captação)
 * @param plantIrrPct TIR nominal da usina, %
 */
export function computeBenchmarks(market: MarketRates, years: number, plantFlows: number[], plantIrrPct: number): Benchmark[] {
  const cdi = cdiPathPct(market, years);
  const cdiGross = cdi.reduce((acc, p) => acc * (1 + p / 100), 1000);
  const spread = market.selicPct - market.cdiPct;
  const poup = cdi.map((c) => poupancaAnnualPct(c + spread));
  const poupFinal = poup.reduce((acc, p) => acc * (1 + p / 100), 1000);
  const ipcaPlusPct = longTermNominalPct(market);
  const ipcaPlusGross = 1000 * (1 + ipcaPlusPct / 100) ** years;

  const investment = -plantFlows[0];
  const scale = investment > 0 ? 1000 / investment : 0;
  const distributions = plantFlows.slice(1).reduce((s, x) => s + x, 0) * scale;
  // reinvestimento de cada distribuição no CDI até o fim do horizonte, IR 15 % sobre o rendimento
  let reinvested = 0;
  for (let y = 1; y <= years; y++) {
    const d = (plantFlows[y] ?? 0) * scale;
    let growth = 1;
    for (let k = y; k < years; k++) growth *= 1 + cdi[k] / 100;
    reinvested += d > 0 ? netOfTax(d * growth, d) : d * growth;
  }
  const reinvestedPct = reinvested > 0 ? ((reinvested / 1000) ** (1 / years) - 1) * 100 : -100;

  return [
    {
      name: "UFV (distribuições acumuladas)",
      annualPct: plantIrrPct,
      finalValueOf1000BRL: distributions,
      note: `Soma das distribuições de R$ 1.000 em cotas ao longo de ${years} anos, sem reinvestimento; taxa = TIR nominal. Valor BRUTO: a tributação dos rendimentos do token deve ser verificada com um contador.`,
    },
    {
      name: "UFV (distribuições reinvestidas no CDI)",
      annualPct: reinvestedPct,
      finalValueOf1000BRL: reinvested,
      note: `Mesmas distribuições reinvestidas em CDB 100 % do CDI até o fim do horizonte (IR de 15 % sobre o rendimento do CDB): base equivalente para comparar valor final com as aplicações abaixo. Taxa = retorno anual equivalente (TIR modificada).`,
    },
    {
      name: "CDI (CDB 100 % do CDI)",
      annualPct: geometricMeanPct(cdi),
      finalValueOf1000BRL: netOfTax(cdiGross, 1000),
      note: `CDI de ${fmtPct(market.cdiPct)} hoje, convergindo para ${fmtPct(ipcaPlusPct)} (juro real ${fmtPct(market.realRatePct)} + IPCA ${fmtPct(market.ipcaLongTermPct)}) com meia-vida de ${fmtNum(CDI_HALF_LIFE_YEARS, 0)} anos; taxa = média geométrica bruta. Valor final líquido de IR de 15 % no resgate; garantia do FGC até o limite legal.`,
    },
    {
      name: "Tesouro IPCA+",
      annualPct: ipcaPlusPct,
      finalValueOf1000BRL: netOfTax(ipcaPlusGross, 1000),
      note: `Juro real de ${fmtPct(market.realRatePct, 2)} + IPCA de ${fmtPct(market.ipcaLongTermPct)} a.a., levado ao vencimento; valor final líquido de IR de 15 %. Sem taxa de custódia da B3 e sem marcação a mercado.`,
    },
    {
      name: "Poupança",
      annualPct: geometricMeanPct(poup),
      finalValueOf1000BRL: poupFinal,
      note: `Regra da Lei 12.703/2012: com Selic acima de 8,5 % a.a., 0,5 % a.m. + TR; abaixo, 70 % da Selic + TR. TR assumida ≈ 0. Isenta de IR para pessoa física.`,
    },
  ];
}
