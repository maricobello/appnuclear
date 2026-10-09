/**
 * Projeção para um investidor com `cotas` cotas: participação proporcional no caixa distribuído.
 */

import type { FinancialResult } from "@/lib/types";
import { paybackYears } from "./metrics";

export interface CotasProjection {
  investedBRL: number;
  firstYearIncomeBRL: number;
  avgMonthlyIncomeBRL: number;
  totalIncomeBRL: number;
  /** `cumulativeBRL` = rendimentos recebidos acumulados até o ano (sem descontar o aporte) */
  byYear: { year: number; calendarYear: number; incomeBRL: number; cumulativeBRL: number }[];
  paybackYears: number | null;
}

export function projectCotas(finance: FinancialResult, cotas: number): CotasProjection {
  const price = finance.perCota.priceBRL;
  const totalCotas = price > 0 ? finance.investmentBRL / price : 0;
  const n = Math.max(0, cotas);
  const share = totalCotas > 0 ? n / totalCotas : 0;
  const invested = n * price;
  const ops = finance.cashFlows.filter((c) => c.year >= 1);
  let cumulative = 0;
  const byYear = ops.map((c) => {
    const incomeBRL = c.netCashFlowBRL * share;
    cumulative += incomeBRL;
    return { year: c.year, calendarYear: c.calendarYear, incomeBRL, cumulativeBRL: cumulative };
  });
  const total = cumulative;
  return {
    investedBRL: invested,
    firstYearIncomeBRL: byYear[0]?.incomeBRL ?? 0,
    avgMonthlyIncomeBRL: ops.length > 0 ? total / (ops.length * 12) : 0,
    totalIncomeBRL: total,
    byYear,
    paybackYears: n > 0 ? paybackYears([-invested, ...byYear.map((b) => b.incomeBRL)]) : null,
  };
}
