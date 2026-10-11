/**
 * Modelo econômico da plataforma Aferi Capital.
 *
 * Parte do MESMO fluxo de caixa da usina usado em todo o site (buildCashFlows) e decompõe o caixa da
 * SPE entre investidores e plataforma, ano a ano:
 *
 *   Receita_t − Tributos_t − OPEX_t (O&M, seguro, arrendamento) − Reposição_t = Caixa operacional_t
 *   Gestão_t       = g · Receita_t                                      (plataforma)
 *   Caixa_t        = Caixa operacional_t − Gestão_t                     (antes da performance)
 *   Hurdle_t       = I · [(1 + h)(1 + π) − 1] · (1 + π)^(t−1)            (retorno preferencial IPCA + h)
 *   Performance_t  = c · max(0, Caixa_t − Hurdle_t − Déficit_{t−1})     (plataforma)
 *   Déficit_t      = max(0, Déficit_{t−1} + Hurdle_t − Caixa_t)
 *   Distribuição_t = Caixa_t − Performance_t                            (investidores)
 *
 * Captação: I = CAPEX ÷ (1 − s), com s = taxa de estruturação — a usina (CAPEX, energia, receita) é a
 * mesma em qualquer tabela; só muda quem fica com cada parcela do caixa.
 */
import type { MarketRates, PlantAnalysis } from "@/lib/types";
import { baseScenarioParams, buildCashFlows, irr, npv, paybackYears, realRatePct, type ScenarioParams } from "@/lib/finance";
import { cdiPathPct, geometricMeanPct } from "@/lib/finance/benchmarks";
import { FIOB_STRESS_FROM_YEAR } from "@/lib/finance/sensitivity";
import { CANDIDATE_GRID, CURRENT_SCHEDULE, GUARDRAILS, PLATFORM_COSTS, PNL_YEARS, type FeeSchedule } from "./premissas";

// ─── base da usina (independente da tabela de taxas) ─────────────────────────────────────────

export interface BaseYear {
  year: number;
  calendarYear: number;
  revenue: number;
  taxes: number;
  /** O&M + seguro + arrendamento (sem a taxa de gestão) */
  opex: number;
  replacement: number;
}

export interface PlantBase {
  /** CAPEX físico da usina, constante entre tabelas */
  capex: number;
  years: BaseYear[];
  ipcaPct: number;
  discountRatePct: number;
}

/** Fluxo da usina sem a taxa de gestão, a partir do caso-base (com ajustes de cenário opcionais). */
export function plantBase(a: PlantAnalysis, patch: Partial<ScenarioParams> = {}, energyMult = 1): PlantBase {
  const base = baseScenarioParams(a.plant, a.generation, a.market);
  const s: ScenarioParams = { ...base, ...patch, energyMWh: base.energyMWh.map((e) => e * energyMult) };
  const cf = buildCashFlows(a.plant, s);
  const g0 = a.plant.finance.adminFeePctRevenue / 100;
  return {
    capex: cf.capexBRL,
    years: cf.rows
      .filter((r) => r.year >= 1)
      .map((r) => ({ year: r.year, calendarYear: r.calendarYear, revenue: r.revenueBRL, taxes: r.taxesBRL, opex: r.opexBRL - g0 * r.revenueBRL, replacement: r.capexBRL })),
    ipcaPct: s.ipcaPct,
    discountRatePct: s.discountRatePct,
  };
}

// ─── cascata com a tabela de taxas ───────────────────────────────────────────────────────────

export interface WaterfallYear extends BaseYear {
  management: number;
  /** caixa antes da performance */
  cash: number;
  hurdle: number;
  performance: number;
  distribution: number;
  deficit: number;
}

export interface Outcome {
  schedule: FeeSchedule;
  investment: number;
  cotaPrice: number;
  structuringFee: number;
  years: WaterfallYear[];
  investorFlows: number[];
  irrNominalPct: number;
  irrRealPct: number;
  paybackYears: number | null;
  moic: number;
  firstYearYieldPct: number;
  /** taxas brutas da plataforma por ano (0 = estruturação) */
  platformFees: number[];
  managementTotal: number;
  performanceTotal: number;
  /** taxas ÷ (taxas + distribuições), soma nominal do horizonte, % */
  platformSharePct: number;
}

/** Retorno preferencial nominal do ano 1, fração: (1 + h)(1 + π) − 1 */
export function hurdleRate(hurdleRealPct: number, ipcaPct: number): number {
  return (1 + hurdleRealPct / 100) * (1 + ipcaPct / 100) - 1;
}

export function applySchedule(b: PlantBase, totalCotas: number, sch: FeeSchedule): Outcome {
  const s = sch.structuringPct / 100;
  const g = sch.managementPct / 100;
  const c = sch.performancePct / 100;
  const pi = b.ipcaPct / 100;
  const investment = b.capex / (1 - s);
  const h1 = hurdleRate(sch.hurdleRealPct, b.ipcaPct) * investment;
  let deficit = 0;
  const years: WaterfallYear[] = b.years.map((y) => {
    const management = g * y.revenue;
    const cash = y.revenue - y.taxes - y.opex - y.replacement - management;
    const hurdle = c > 0 ? h1 * (1 + pi) ** (y.year - 1) : 0;
    const excess = cash - hurdle - deficit;
    const performance = c > 0 ? c * Math.max(0, excess) : 0;
    deficit = c > 0 ? Math.max(0, deficit + hurdle - cash) : 0;
    return { ...y, management, cash, hurdle, performance, distribution: cash - performance, deficit };
  });
  const investorFlows = [-investment, ...years.map((y) => y.distribution)];
  const irrNominalPct = irr(investorFlows) ?? NaN;
  const distributions = years.reduce((acc, y) => acc + y.distribution, 0);
  const managementTotal = years.reduce((acc, y) => acc + y.management, 0);
  const performanceTotal = years.reduce((acc, y) => acc + y.performance, 0);
  const structuringFee = s * investment;
  const fees = structuringFee + managementTotal + performanceTotal;
  return {
    schedule: sch,
    investment,
    cotaPrice: investment / totalCotas,
    structuringFee,
    years,
    investorFlows,
    irrNominalPct,
    irrRealPct: realRatePct(irrNominalPct, b.ipcaPct),
    paybackYears: paybackYears(investorFlows),
    moic: distributions / investment,
    firstYearYieldPct: ((years[0]?.distribution ?? 0) / investment) * 100,
    platformFees: [structuringFee, ...years.map((y) => y.management + y.performance)],
    managementTotal,
    performanceTotal,
    platformSharePct: fees + distributions > 0 ? (fees / (fees + distributions)) * 100 : 100,
  };
}

// ─── resultado da plataforma por oferta ──────────────────────────────────────────────────────

export interface PlatformUnit {
  investors: number;
  /** fluxo líquido da plataforma por ano (0 = oferta), já sem tributos e custos variáveis */
  netFlows: number[];
  npvNet: number;
  /** meses para a oferta se pagar para a plataforma (0 = já no fechamento) */
  paybackMonths: number | null;
  /** receita recorrente do ano 1 (gestão + performance) ÷ captação, % */
  takeRatePct: number;
  /** custo afundado se a oferta fracassar (não atinge a meta), líquido da originação */
  failedOfferingLoss: number;
}

export function platformUnit(o: Outcome, b: PlantBase, opts: { originationBRL: number; softCapShare: number }): PlatformUnit {
  const k = PLATFORM_COSTS;
  const tax = k.taxOnFeesPct / 100;
  const investors = Math.max(1, Math.ceil(o.investment / k.avgTicketBRL));
  const onboarding = investors * (k.perInvestorBRL + k.cacPerInvestorBRL);
  const t0 = (o.structuringFee + opts.originationBRL) * (1 - tax) - k.perOfferingBRL - onboarding;
  const netFlows = [t0];
  o.years.forEach((y, i) => {
    const fees = y.management + y.performance;
    const speCost = (k.speOperationPctRevenue / 100) * y.revenue + k.speFixedAnnualBRL * (1 + b.ipcaPct / 100) ** i;
    netFlows.push(fees * (1 - tax) - speCost);
  });
  let cum = 0;
  let paybackMonths: number | null = null;
  for (let t = 0; t < netFlows.length; t++) {
    const prev = cum;
    cum += netFlows[t];
    if (cum >= 0 && paybackMonths === null) paybackMonths = t === 0 ? 0 : (t - 1 + -prev / netFlows[t]) * 12;
    if (cum < 0) paybackMonths = null;
  }
  // oferta fracassada: custo de estruturação + marketing e KYC até a meta mínima, menos a originação
  const failedInvestors = Math.ceil((o.investment * opts.softCapShare) / k.avgTicketBRL);
  const failedOfferingLoss = k.perOfferingBRL + failedInvestors * (k.perInvestorBRL + k.cacPerInvestorBRL) - opts.originationBRL * (1 - tax);
  return {
    investors,
    netFlows,
    npvNet: npv(b.discountRatePct, netFlows),
    paybackMonths,
    takeRatePct: ((o.platformFees[1] ?? 0) / o.investment) * 100,
    failedOfferingLoss,
  };
}

// ─── carteira, travas e otimização ───────────────────────────────────────────────────────────

export interface PlantCase {
  a: PlantAnalysis;
  open: boolean;
  p50: PlantBase;
  p90: PlantBase;
  fioB: PlantBase;
  opex: PlantBase;
  tariff: PlantBase;
}

export function buildCases(analyses: PlantAnalysis[]): PlantCase[] {
  return analyses.map((a) => {
    const p90Ratio = a.generation.annualP50MWh > 0 ? a.generation.p90MWh / a.generation.annualP50MWh : 0.9;
    return {
      a,
      open: a.plant.status !== "encerrada",
      p50: plantBase(a),
      p90: plantBase(a, {}, p90Ratio),
      fioB: plantBase(a, { fioBFullFromYear: FIOB_STRESS_FROM_YEAR }),
      opex: plantBase(a, { opexMult: 1.2 }),
      tariff: plantBase(a, { tariffMult: 0.9 }),
    };
  });
}

/** CDI médio projetado no horizonte (mesma trajetória dos comparativos do site), % a.a. */
export function cdiReferencePct(market: MarketRates, years: number): number {
  return geometricMeanPct(cdiPathPct(market, years));
}

export interface Limits {
  minIrrP50Pct: number;
  minRealIrrP90Pct: number;
  maxPaybackYears: number;
  maxSharePct: number;
}

export function limitsFor(market: MarketRates, horizonYears: number): Limits {
  return {
    minIrrP50Pct: cdiReferencePct(market, horizonYears) + GUARDRAILS.minIrrSpreadOverCdiPp,
    minRealIrrP90Pct: market.realRatePct + GUARDRAILS.minRealIrrP90OverNtnbPp,
    maxPaybackYears: GUARDRAILS.maxPaybackYears,
    maxSharePct: GUARDRAILS.maxPlatformSharePct,
  };
}

export interface CandidateEval {
  schedule: FeeSchedule;
  feasible: boolean;
  violations: string[];
  /** piores valores entre as ofertas abertas */
  worstIrrP50Pct: number;
  worstRealIrrP90Pct: number;
  worstPaybackYears: number;
  worstSharePct: number;
  /** soma do VPL líquido da plataforma nas ofertas abertas */
  platformNpv: number;
}

export function evaluate(cases: PlantCase[], sch: FeeSchedule, lim: Limits): CandidateEval {
  const open = cases.filter((c) => c.open);
  let worstIrrP50Pct = Infinity;
  let worstRealIrrP90Pct = Infinity;
  let worstPaybackYears = 0;
  let worstSharePct = 0;
  let platformNpv = 0;
  for (const c of open) {
    const o50 = applySchedule(c.p50, c.a.plant.token.totalCotas, sch);
    const o90 = applySchedule(c.p90, c.a.plant.token.totalCotas, sch);
    worstIrrP50Pct = Math.min(worstIrrP50Pct, Number.isFinite(o50.irrNominalPct) ? o50.irrNominalPct : -Infinity);
    worstRealIrrP90Pct = Math.min(worstRealIrrP90Pct, Number.isFinite(o90.irrRealPct) ? o90.irrRealPct : -Infinity);
    worstPaybackYears = Math.max(worstPaybackYears, o50.paybackYears ?? Infinity);
    worstSharePct = Math.max(worstSharePct, o50.platformSharePct);
    platformNpv += platformUnit(o50, c.p50, { originationBRL: originationOf(sch), softCapShare: softCapShare(c) }).npvNet;
  }
  const violations: string[] = [];
  if (worstIrrP50Pct < lim.minIrrP50Pct) violations.push("TIR P50");
  if (worstRealIrrP90Pct < lim.minRealIrrP90Pct) violations.push("TIR real P90");
  if (worstPaybackYears > lim.maxPaybackYears) violations.push("Payback");
  if (worstSharePct > lim.maxSharePct) violations.push("Participação");
  return { schedule: sch, feasible: violations.length === 0, violations, worstIrrP50Pct, worstRealIrrP90Pct, worstPaybackYears, worstSharePct, platformNpv };
}

/** A originação (paga pelo patrocinador) faz parte da política recomendada; a tabela atual não cobra. */
export function originationOf(sch: FeeSchedule): number {
  return sch.id === CURRENT_SCHEDULE.id ? 0 : PLATFORM_COSTS.originationFeeBRL;
}

function softCapShare(c: PlantCase): number {
  const t = c.a.plant.token;
  return t.totalCotas > 0 ? t.softCapCotas / t.totalCotas : 0.7;
}

export function candidateSchedules(): FeeSchedule[] {
  const out: FeeSchedule[] = [];
  const g = CANDIDATE_GRID;
  for (const s of g.structuringPct)
    for (const m of g.managementPct)
      for (const p of g.performancePct)
        for (const h of p === 0 ? [0] : g.hurdleRealPct)
          out.push({ id: `E${s}-G${m}-P${p}-H${h}`, label: `${s} % + ${m} %${p ? ` + ${p} % acima de IPCA+${h} %` : ""}`, structuringPct: s, managementPct: m, performancePct: p, hurdleRealPct: h });
  return out;
}

export interface Optimization {
  limits: Limits;
  current: CandidateEval;
  best: CandidateEval;
  /** melhores tabelas viáveis por VPL da plataforma (inclui a escolhida) */
  ranking: CandidateEval[];
  /** todas as tabelas avaliadas (fronteira de remuneração) */
  all: CandidateEval[];
  evaluated: number;
  feasibleCount: number;
}

export function optimize(cases: PlantCase[], market: MarketRates, horizonYears: number): Optimization {
  const lim = limitsFor(market, horizonYears);
  const all = candidateSchedules().map((s) => evaluate(cases, s, lim));
  const feasible = all.filter((e) => e.feasible).sort((x, y) => y.platformNpv - x.platformNpv || y.worstIrrP50Pct - x.worstIrrP50Pct);
  const current = evaluate(cases, CURRENT_SCHEDULE, lim);
  const best = feasible[0] ?? current;
  return {
    limits: lim,
    current,
    best: { ...best, schedule: { ...best.schedule, id: "recomendada", label: `Tabela recomendada (${best.schedule.label})` } },
    ranking: feasible.slice(0, 8),
    all,
    evaluated: all.length,
    feasibleCount: feasible.length,
  };
}

// ─── DRE projetada da plataforma ─────────────────────────────────────────────────────────────

export interface PnlYear {
  year: number;
  calendarYear: number;
  structuring: number;
  origination: number;
  management: number;
  performance: number;
  gross: number;
  taxes: number;
  variableCosts: number;
  fixedCosts: number;
  result: number;
  cumulative: number;
  marginPct: number;
}

/**
 * Ano 0 = ciclo atual de ofertas (estruturação e originação das ofertas abertas); anos 1..N contados
 * a partir do encerramento delas. Ofertas já encerradas seguem a tabela atual pelo calendário.
 */
export function platformPnl(cases: PlantCase[], recommended: FeeSchedule, cycleYear: number): PnlYear[] {
  const k = PLATFORM_COSTS;
  const tax = k.taxOnFeesPct / 100;
  const ipca = (cases[0]?.p50.ipcaPct ?? 4) / 100;
  const rows: PnlYear[] = [];
  let cumulative = 0;
  for (let t = 0; t <= PNL_YEARS; t++) {
    let structuring = 0;
    let origination = 0;
    let management = 0;
    let performance = 0;
    let variableCosts = 0;
    for (const c of cases) {
      const sch = c.open ? recommended : CURRENT_SCHEDULE;
      const o = applySchedule(c.p50, c.a.plant.token.totalCotas, sch);
      if (c.open && t === 0) {
        structuring += o.structuringFee;
        origination += originationOf(sch);
        const investors = Math.ceil(o.investment / k.avgTicketBRL);
        variableCosts += k.perOfferingBRL + investors * (k.perInvestorBRL + k.cacPerInvestorBRL);
      }
      // ofertas abertas: distribuições começam no ano seguinte ao encerramento; encerradas: pelo calendário
      const modelYear = c.open ? t : cycleYear + t - c.a.plant.finance.startYear + 1;
      const y = modelYear >= 1 ? o.years[modelYear - 1] : undefined;
      if (y) {
        management += y.management;
        performance += y.performance;
        variableCosts += (k.speOperationPctRevenue / 100) * y.revenue + k.speFixedAnnualBRL * (1 + ipca) ** Math.max(0, modelYear - 1);
      }
    }
    const gross = structuring + origination + management + performance;
    const taxes = gross * tax;
    const fixedCosts = k.fixedAnnualBRL * (1 + ipca) ** t;
    const result = gross - taxes - variableCosts - fixedCosts;
    cumulative += result;
    rows.push({ year: t, calendarYear: cycleYear + t, structuring, origination, management, performance, gross, taxes, variableCosts, fixedCosts, result, cumulative, marginPct: gross > 0 ? (result / gross) * 100 : 0 });
  }
  return rows;
}

// ─── auditoria exata da distribuição on-chain (mesma aritmética do UFVPlantToken) ─────────────

const MAGNITUDE = 2n ** 128n;

export interface DistributionAudit {
  supply: number;
  holders: number;
  distributions: number;
  transfers: number;
  distributedWei: bigint;
  attributedWei: bigint;
  residualWei: bigint;
  boundWei: bigint;
  /** maior diferença, em wei, entre o atribuído pelo contrato e o pró-rata exato (racional) */
  maxProRataErrorWei: bigint;
  ok: boolean;
}

/**
 * Reproduz em inteiros (BigInt) a contabilidade do token: receita por cota ampliada por 2^128 com resto
 * carregado, correções em toda transferência e saques. Verifica conservação (nada é criado; o
 * resíduo retido no contrato é menor que 1 wei por detentor) e aderência ao pró-rata exato.
 */
export function auditDistribution(opts: { supply: number; monthlyWei: bigint[] }): DistributionAudit {
  const supply = BigInt(opts.supply);
  // três detentores; transferências entre distribuições (venda no secundário entre carteiras com KYC)
  const bal = new Map<string, bigint>([
    ["A", (supply * 64n) / 100n],
    ["B", (supply * 30n) / 100n],
  ]);
  bal.set("C", supply - bal.get("A")! - bal.get("B")!);
  const corr = new Map<string, bigint>([...bal.keys()].map((k) => [k, 0n]));
  const claimed = new Map<string, bigint>([...bal.keys()].map((k) => [k, 0n]));
  /** pró-rata exato acumulado ×supply (numerador racional) */
  const exactNum = new Map<string, bigint>([...bal.keys()].map((k) => [k, 0n]));
  let mrps = 0n;
  let remainder = 0n;
  let distributed = 0n;
  let transfers = 0;
  const accumulative = (k: string) => (mrps * bal.get(k)! + corr.get(k)!) / MAGNITUDE;
  const transfer = (from: string, to: string, v: bigint) => {
    bal.set(from, bal.get(from)! - v);
    bal.set(to, bal.get(to)! + v);
    corr.set(from, corr.get(from)! + mrps * v);
    corr.set(to, corr.get(to)! - mrps * v);
    transfers++;
  };
  opts.monthlyWei.forEach((amount, i) => {
    for (const [k, b] of bal) exactNum.set(k, exactNum.get(k)! + amount * b);
    const magnified = amount * MAGNITUDE + remainder;
    mrps += magnified / supply;
    remainder = magnified % supply;
    distributed += amount;
    if (i % 3 === 1) transfer("A", "C", supply / 50n);
    if (i % 4 === 2) transfer("B", "A", supply / 100n);
    if (i % 2 === 0) {
      const k = i % 4 === 0 ? "B" : "C";
      claimed.set(k, claimed.get(k)! + (accumulative(k) - claimed.get(k)!));
    }
  });
  let attributed = 0n;
  let maxErr = 0n;
  for (const k of bal.keys()) {
    const acc = accumulative(k);
    attributed += acc;
    const exactFloor = exactNum.get(k)! / supply;
    const err = acc > exactFloor ? acc - exactFloor : exactFloor - acc;
    if (err > maxErr) maxErr = err;
  }
  const residual = distributed - attributed;
  const bound = BigInt(bal.size);
  return {
    supply: opts.supply,
    holders: bal.size,
    distributions: opts.monthlyWei.length,
    transfers,
    distributedWei: distributed,
    attributedWei: attributed,
    residualWei: residual,
    boundWei: bound,
    maxProRataErrorWei: maxErr,
    ok: residual >= 0n && residual <= bound && maxErr <= bound,
  };
}

// ─── decisões: escada de agressividade, estresse e escala ────────────────────────────────────

export interface LadderStep {
  label: string;
  maxSharePct: number;
  best: CandidateEval | null;
}

/** Melhor tabela para cada teto de participação da plataforma (as demais travas ficam fixas). */
export function aggressivenessLadder(cases: PlantCase[], market: MarketRates, horizonYears: number, caps = [15, 20, 25, 30]): LadderStep[] {
  const base = limitsFor(market, horizonYears);
  const schedules = candidateSchedules();
  const labels = ["Conservadora", "Moderada", "Recomendada", "Agressiva"];
  return caps.map((cap, i) => {
    const lim = { ...base, maxSharePct: cap };
    const feasible = schedules
      .map((s) => evaluate(cases, s, lim))
      .filter((e) => e.feasible)
      .sort((x, y) => y.platformNpv - x.platformNpv);
    return { label: labels[i] ?? `Teto ${cap} %`, maxSharePct: cap, best: feasible[0] ?? null };
  });
}

export interface ScenarioRow {
  name: string;
  description: string;
  worstIrrPct: number;
  /** TIR nominal média ponderada pela captação */
  avgIrrPct: number;
  worstRealIrrPct: number;
  platformNpv: number;
}

const SCENARIOS: { key: keyof Pick<PlantCase, "p50" | "p90" | "fioB" | "opex" | "tariff">; name: string; description: string }[] = [
  { key: "p50", name: "Base (P50)", description: "Geração mediana e premissas do catálogo" },
  { key: "p90", name: "Geração P90", description: "Geração excedida em 90 % dos anos" },
  { key: "fioB", name: "Fio B a 100 %", description: `Cobrança integral do Fio B desde ${FIOB_STRESS_FROM_YEAR}` },
  { key: "opex", name: "OPEX +20 %", description: "O&M, seguro e arrendamento 20 % maiores" },
  { key: "tariff", name: "Tarifa −10 %", description: "Nível tarifário 10 % menor em todo o horizonte" },
];

export function scenarioMatrix(cases: PlantCase[], sch: FeeSchedule): ScenarioRow[] {
  const open = cases.filter((c) => c.open);
  return SCENARIOS.map((sc) => {
    let worst = Infinity;
    let worstReal = Infinity;
    let wSum = 0;
    let w = 0;
    let platformNpv = 0;
    for (const c of open) {
      const b = c[sc.key];
      const o = applySchedule(b, c.a.plant.token.totalCotas, sch);
      const v = Number.isFinite(o.irrNominalPct) ? o.irrNominalPct : -100;
      worst = Math.min(worst, v);
      worstReal = Math.min(worstReal, Number.isFinite(o.irrRealPct) ? o.irrRealPct : -100);
      wSum += v * o.investment;
      w += o.investment;
      platformNpv += platformUnit(o, b, { originationBRL: originationOf(sch), softCapShare: softCapShare(c) }).npvNet;
    }
    return { name: sc.name, description: sc.description, worstIrrPct: worst, avgIrrPct: w > 0 ? wSum / w : NaN, worstRealIrrPct: worstReal, platformNpv };
  });
}

export interface ScaleEconomics {
  /** resultado líquido no fechamento por R$ 1 milhão captado */
  upfrontPerMillion: number;
  /** resultado líquido recorrente (ano 3) por R$ 1 milhão captado, por ano */
  recurringPerMillion: number;
  /** carteira (captação acumulada) que paga os custos fixos só com o recorrente */
  breakEvenAumBRL: number;
  /** carteira para cada meta de resultado anual recorrente */
  targets: { annualProfitBRL: number; aumBRL: number }[];
}

export function scaleEconomics(cases: PlantCase[], sch: FeeSchedule, targets = [2_000_000, 5_000_000, 10_000_000]): ScaleEconomics {
  const open = cases.filter((c) => c.open);
  let raised = 0;
  let upfront = 0;
  let recurring = 0;
  for (const c of open) {
    const o = applySchedule(c.p50, c.a.plant.token.totalCotas, sch);
    const u = platformUnit(o, c.p50, { originationBRL: originationOf(sch), softCapShare: softCapShare(c) });
    raised += o.investment;
    upfront += u.netFlows[0];
    recurring += u.netFlows[3] ?? 0;
  }
  const perM = (v: number) => (raised > 0 ? (v / raised) * 1_000_000 : 0);
  const recurringPerMillion = perM(recurring);
  const fixed = PLATFORM_COSTS.fixedAnnualBRL;
  const aumFor = (profit: number) => (recurringPerMillion > 0 ? ((profit + fixed) / recurringPerMillion) * 1_000_000 : Infinity);
  return {
    upfrontPerMillion: perM(upfront),
    recurringPerMillion,
    breakEvenAumBRL: aumFor(0),
    targets: targets.map((t) => ({ annualProfitBRL: t, aumBRL: aumFor(t) })),
  };
}
