/**
 * Leituras para o investidor (versão "resumo" do relatório): simulação de um aporte em cotas e
 * trajetórias de patrimônio acumulado da usina × Selic/CDI, Tesouro IPCA+ e Poupança.
 *
 * Usa as mesmas regras do módulo financeiro (`@/lib/finance/benchmarks`): trajetória do CDI com
 * reversão à média, IR de 15 % sobre o ganho no resgate, poupança pela Lei 12.703/2012. No fim do
 * horizonte os valores coincidem com `finance.benchmarks` (base R$ 1.000) × aporte / 1.000.
 * Funções puras, sem pdf-lib.
 */
import {
  cdiPathPct,
  FIXED_INCOME_TAX_RATE,
  longTermNominalPct,
  POUPANCA_SELIC_THRESHOLD_PCT,
} from "@/lib/finance/benchmarks";
import { projectCotas } from "@/lib/finance/cotas";
import type { Benchmark, PlantAnalysis, SensitivityRow } from "@/lib/types";
import { cdiNetPct } from "./insights";

export type WealthKey = "usina" | "cdi" | "ipca" | "poupanca";

export interface WealthSeries {
  key: WealthKey;
  name: string;
  /** patrimônio ao fim de cada ano 0..N, líquido de IR se resgatado naquele ano */
  values: number[];
  finalBRL: number;
  /** taxa anual equivalente (do benchmark do módulo financeiro, quando disponível) */
  annualPct: number;
  /** valor final do benchmark correspondente × aporte / 1.000 (quando existe) */
  benchmarkFinalBRL: number | null;
  note: string;
}

export interface InvestmentComparison {
  amountBRL: number;
  cotas: number;
  investedBRL: number;
  years: number;
  /** ano-calendário de cada ponto 0..N (0 = aporte) */
  calendarYears: number[];
  incomeByYear: number[];
  firstYearIncomeBRL: number;
  avgMonthlyIncomeBRL: number;
  totalIncomeBRL: number;
  paybackYears: number | null;
  series: WealthSeries[];
  /** primeiro ano em que a renda da usina reinvestida no CDI supera o CDI direto */
  crossoverYear: number | null;
}

const netOfTax = (gross: number, principal: number) => principal + (gross - principal) * (1 - FIXED_INCOME_TAX_RATE);

function poupancaAnnualPct(selicPct: number): number {
  return selicPct > POUPANCA_SELIC_THRESHOLD_PCT ? (1.005 ** 12 - 1) * 100 : 0.7 * selicPct;
}

const BENCH_MATCH: Record<WealthKey, (b: Benchmark) => boolean> = {
  usina: (b) => /reinvest/i.test(b.name),
  cdi: (b) => /CDI/.test(b.name) && !/UFV|usina|reinvest/i.test(b.name),
  ipca: (b) => /IPCA\+|Tesouro/i.test(b.name),
  poupanca: (b) => /poupan/i.test(b.name),
};

export function findBenchmark(benchmarks: Benchmark[] | undefined, key: WealthKey): Benchmark | undefined {
  return (benchmarks ?? []).find(BENCH_MATCH[key]);
}

/** Simula `amountBRL` em cotas (pro-rata do fluxo P50) e as alternativas no mesmo horizonte. */
export function buildInvestmentComparison(a: PlantAnalysis, amountBRL = 10_000): InvestmentComparison {
  const f = a.finance;
  const price = f.perCota.priceBRL || a.plant.token.cotaPriceBRL;
  const cotas = price > 0 ? Math.max(1, Math.floor(amountBRL / price + 1e-9)) : 0;
  const proj = projectCotas(f, cotas);
  const invested = proj.investedBRL;
  const years = proj.byYear.length;
  const income = proj.byYear.map((b) => b.incomeBRL);
  const cdi = cdiPathPct(a.market, years);
  const spread = a.market.selicPct - a.market.cdiPct;
  const lt = longTermNominalPct(a.market);
  const scale = invested / 1000;

  // usina: cada distribuição reinvestida no CDI até o ano t (IR de 15 % sobre o rendimento do CDB)
  const usina: number[] = [0];
  for (let t = 1; t <= years; t++) {
    let w = 0;
    for (let y = 1; y <= t; y++) {
      const d = income[y - 1] ?? 0;
      let g = 1;
      for (let k = y; k < t; k++) g *= 1 + cdi[k] / 100;
      w += d > 0 ? netOfTax(d * g, d) : d * g;
    }
    usina.push(w);
  }
  const cdiVals: number[] = [invested];
  const ipcaVals: number[] = [invested];
  const poupVals: number[] = [invested];
  let gCdi = invested;
  let gPoup = invested;
  for (let t = 1; t <= years; t++) {
    gCdi *= 1 + cdi[t - 1] / 100;
    gPoup *= 1 + poupancaAnnualPct(cdi[t - 1] + spread) / 100;
    cdiVals.push(netOfTax(gCdi, invested));
    ipcaVals.push(netOfTax(invested * (1 + lt / 100) ** t, invested));
    poupVals.push(gPoup);
  }

  const mk = (key: WealthKey, name: string, values: number[], note: string): WealthSeries => {
    const b = findBenchmark(f.benchmarks, key);
    const final = values[values.length - 1] ?? 0;
    const eq = invested > 0 && final > 0 && years > 0 ? ((final / invested) ** (1 / years) - 1) * 100 : NaN;
    return {
      key,
      name,
      values,
      finalBRL: final,
      annualPct: b && Number.isFinite(b.annualPct) ? b.annualPct : eq,
      benchmarkFinalBRL: b && Number.isFinite(b.finalValueOf1000BRL) ? b.finalValueOf1000BRL * scale : null,
      note,
    };
  };

  const series: WealthSeries[] = [
    mk("usina", "Usina (renda reinvestida no CDI)", usina, "Distribuições reinvestidas em CDB 100 % do CDI; sem valor residual das cotas."),
    mk("cdi", "Selic/CDI direto", cdiVals, "CDB 100 % do CDI até o fim do horizonte; IR de 15 % no resgate."),
    mk("ipca", "Tesouro IPCA+", ipcaVals, "Juro real atual + IPCA de longo prazo; IR de 15 % no resgate."),
    mk("poupanca", "Poupança", poupVals, "Lei 12.703/2012, TR ≈ 0; isenta de IR."),
  ];
  let crossoverYear: number | null = null;
  for (let t = 1; t <= years; t++) {
    if (usina[t] >= cdiVals[t]) {
      crossoverYear = t;
      break;
    }
  }
  const startCal = f.cashFlows.find((c) => c.year === 0)?.calendarYear ?? (proj.byYear[0]?.calendarYear ?? a.plant.finance.startYear) - 1;
  return {
    amountBRL,
    cotas,
    investedBRL: invested,
    years,
    calendarYears: Array.from({ length: years + 1 }, (_, i) => startCal + i),
    incomeByYear: income,
    firstYearIncomeBRL: proj.firstYearIncomeBRL,
    avgMonthlyIncomeBRL: proj.avgMonthlyIncomeBRL,
    totalIncomeBRL: proj.totalIncomeBRL,
    paybackYears: proj.paybackYears,
    series,
    crossoverYear,
  };
}

export interface RateHeadline {
  irrPct: number;
  selicPct: number;
  /** TIR − Selic, p.p. */
  vsSelicPp: number;
  cdiNetPct: number;
  /** TIR − CDI líquido de IR, p.p. */
  vsCdiNetPp: number;
  probIrrBelowCdiPct: number;
}

export function rateHeadline(a: PlantAnalysis): RateHeadline {
  const irrPct = a.finance.irrNominalPct;
  const cdiNet = cdiNetPct(a);
  return {
    irrPct,
    selicPct: a.market.selicPct,
    vsSelicPp: irrPct - a.market.selicPct,
    cdiNetPct: cdiNet,
    vsCdiNetPp: irrPct - cdiNet,
    probIrrBelowCdiPct: a.finance.monteCarlo?.probIrrBelowCdiPct ?? NaN,
  };
}

/** As `n` premissas que mais movem a TIR (maior amplitude primeiro). */
export function topDrivers(rows: SensitivityRow[] | undefined, n = 3): SensitivityRow[] {
  return [...(rows ?? [])]
    .filter((r) => Number.isFinite(r.irrLowPct) && Number.isFinite(r.irrHighPct))
    .sort((x, y) => Math.abs(y.irrHighPct - y.irrLowPct) - Math.abs(x.irrHighPct - x.irrLowPct))
    .slice(0, n);
}
