/**
 * Fluxo de caixa do cotista — ÚNICA implementação, usada pelo caso-base, pelo Monte Carlo e pela
 * análise de sensibilidade (nenhuma lógica duplicada).
 *
 * Perspectiva: SPE 100 % capital próprio (sem dívida); o caixa líquido de cada ano é distribuído aos
 * cotistas. Ano 0 = captação (cotas × preço); anos 1..N = operação, ano-calendário = início + ano − 1.
 * Valores monetários de tarifa, Fio B, PPA e OPEX informados na moeda do 1º ano de operação e
 * reajustados anualmente a partir do ano 2.
 *
 *  Receita "gd-assinatura" (Lei 14.300/2022): crédito por kWh = (tarifa − %FioB × Fio B) × índice
 *    tarifário; receita = energia × crédito × (1 − desconto ao assinante) × (1 − perdas de receita).
 *  Receita "ppa": energia × preço do PPA × IPCA acumulado.
 *  Índice tarifário = [(1 + IPCA)(1 + crescimento real)]^(ano − 1).
 *  OPEX = O&M (R$/kWp·ano) + seguro (% do CAPEX) + arrendamento, reajustados pelo IPCA, + taxa de
 *    gestão (% da receita). Tributos = % da receita (lucro presumido: PIS/COFINS + IRPJ/CSLL).
 *  CAPEX de reposição dos inversores no ano indicado = R$/kW × kW CA, reajustado pelo IPCA.
 */

import type { CashFlowYear, Plant } from "@/lib/types";
import { fioBChargedPct } from "./regulation";

export interface ScenarioParams {
  /** energia de cada ano de operação, MWh (índice 0 = ano 1) */
  energyMWh: number[];
  /** IPCA de longo prazo, % a.a. */
  ipcaPct: number;
  /** crescimento real anual da tarifa, % a.a. */
  tariffRealGrowthPct: number;
  /** multiplicador do nível tarifário (tarifa e Fio B) — sensibilidade */
  tariffMult: number;
  clientDiscountPct: number;
  revenueLossPct: number;
  /** multiplicador de O&M, seguro e arrendamento — sensibilidade */
  opexMult: number;
  /** sobrecusto de O&M — Monte Carlo */
  omMult: number;
  /** multiplicador do CAPEX (e da captação necessária, mesma usina) — sensibilidade */
  capexMult: number;
  /** estresse regulatório: a partir deste ano-calendário o Fio B é cobrado a 100 % */
  fioBFullFromYear?: number | null;
  /** taxa de desconto nominal, % a.a. (fluxo descontado e VPL) */
  discountRatePct: number;
}

export interface CashFlowResult {
  investmentBRL: number;
  capexBRL: number;
  rows: CashFlowYear[];
  /** fluxos líquidos (índice = ano) */
  flows: number[];
  /** OPEX + reposições por ano (índice = ano; 0 = investimento) — para o LCOE */
  costs: number[];
}

export function baseInvestmentBRL(plant: Plant): number {
  return plant.token.totalCotas * plant.token.cotaPriceBRL;
}

export function buildCashFlows(plant: Plant, s: ScenarioParams): CashFlowResult {
  const f = plant.finance;
  const t = plant.tech;
  const N = s.energyMWh.length;
  const investment = baseInvestmentBRL(plant) * s.capexMult;
  const capex = investment * (1 - plant.token.structuringFeePct / 100);
  const r = s.discountRatePct / 100;
  const ipca = s.ipcaPct / 100;
  const tariffStep = (1 + ipca) * (1 + s.tariffRealGrowthPct / 100);

  const rows: CashFlowYear[] = [];
  const flows: number[] = [-investment];
  const costs: number[] = [investment];
  let cumulative = -investment;
  rows.push({
    year: 0,
    calendarYear: f.startYear - 1,
    energyMWh: 0,
    priceBRLPerKWh: 0,
    fioBChargedPct: 0,
    revenueBRL: 0,
    taxesBRL: 0,
    opexBRL: 0,
    capexBRL: investment,
    netCashFlowBRL: -investment,
    cumulativeBRL: cumulative,
    discountedCashFlowBRL: -investment,
  });

  let tariffIdx = 1;
  let ipcaIdx = 1;
  for (let y = 1; y <= N; y++) {
    if (y > 1) {
      tariffIdx *= tariffStep;
      ipcaIdx *= 1 + ipca;
    }
    const calendarYear = f.startYear + y - 1;
    const energy = Math.max(0, s.energyMWh[y - 1]);
    const energyKWh = energy * 1000;

    let revenue: number;
    let fioBPct = 0;
    if (f.revenueModel === "ppa") {
      revenue = energy * (f.ppaPriceBRLPerMWh ?? 0) * ipcaIdx * s.tariffMult;
    } else {
      fioBPct = s.fioBFullFromYear != null && calendarYear >= s.fioBFullFromYear ? 100 : fioBChargedPct(f.accessRequestYear, calendarYear);
      const credit = (f.tariffBRLPerKWh - (fioBPct / 100) * f.fioBBRLPerKWh) * tariffIdx * s.tariffMult;
      revenue = energyKWh * Math.max(0, credit) * (1 - s.clientDiscountPct / 100) * (1 - s.revenueLossPct / 100);
    }

    const om = f.omBRLPerKWpYear * t.dcKWp * ipcaIdx * s.opexMult * s.omMult;
    const insurance = (f.insurancePctCapex / 100) * capex * ipcaIdx * s.opexMult;
    const lease = f.landLeaseBRLYear * ipcaIdx * s.opexMult;
    const admin = (f.adminFeePctRevenue / 100) * revenue;
    const opex = om + insurance + lease + admin;
    const taxes = (f.taxPctRevenue / 100) * revenue;
    const replacement = y === f.inverterReplacementYear ? f.inverterReplacementBRLPerKW * t.acKW * ipcaIdx * s.capexMult : 0;
    const net = revenue - taxes - opex - replacement;
    cumulative += net;
    flows.push(net);
    costs.push(opex + replacement);
    rows.push({
      year: y,
      calendarYear,
      energyMWh: energy,
      priceBRLPerKWh: energyKWh > 0 ? revenue / energyKWh : 0,
      fioBChargedPct: fioBPct,
      revenueBRL: revenue,
      taxesBRL: taxes,
      opexBRL: opex,
      capexBRL: replacement,
      netCashFlowBRL: net,
      cumulativeBRL: cumulative,
      discountedCashFlowBRL: net / (1 + r) ** y,
    });
  }
  return { investmentBRL: investment, capexBRL: capex, rows, flows, costs };
}
