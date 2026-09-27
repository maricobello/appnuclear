import { naiveDaySchedule, optimizeStorageLP } from "../quant/bess";
import type { StorageSpec } from "../quant/storage";
import { addDays, brtDate } from "../sources/time";
import type { Sub, SubPanel } from "../sources/types";
import { bessFinance, type FinanceInputs, type FinanceResult } from "./bess-finance";
import { toDayMatrix } from "./brazil";

/**
 * Estudo de um BESS no PLD REAL de um submercado: despacho ótimo dia a dia (LP exato,
 * HiGHS) sobre o PLD horário — que é publicado na véspera, então o ótimo diário é
 * implementável — mais a política simples de 1 ciclo/dia como referência conservadora,
 * e o modelo econômico de `bess-finance`. Tudo derivado dos dados; nada inventado.
 */
export interface BessParams extends Omit<FinanceInputs, "capacityMWh" | "powerMW" | "rte"> {
  sub: Sub;
  powerMW: number;
  capacityMWh: number;
  /** Eficiência ida-volta (0–1). */
  rte: number;
  /** Máximo de ciclos completos por dia no despacho (garantia do fabricante). */
  maxCyclesPerDay: number;
  /** Janela de PLD realizado (dias). */
  days: number;
}

export interface BessDay {
  date: string;
  revenue: number;
  naive: number;
  chargedMWh: number;
  dischargedMWh: number;
  cycles: number;
  opHours: number;
  spread: number;
  imputed: boolean;
}

export interface BessWindowSummary {
  days: number;
  revenue: number;
  revenuePerDay: number;
  chargedMWh: number;
  dischargedMWh: number;
  cyclesPerDay: number;
  opHoursPerDay: number;
  /** Preço médio ponderado pela energia (R$/MWh). */
  avgBuy: number | null;
  avgSell: number | null;
}

export interface BessScenario {
  name: "Conservador" | "Padrão" | "Otimista";
  policy: string;
  powerMW: number;
  capacityMWh: number;
  rte: number;
  degPctYear: number;
  lcos: number;
  revenueYear: number;
  paybackYears: number | null;
  irr: number | null;
  npv: number;
}

export interface RefDay {
  date: string;
  label: string;
  ts: number[];
  price: number[];
  chargeMW: number[];
  dischargeMW: number[];
  soc: number[];
  revenue: number;
}

export type RefMode = "auto" | "median" | "best";

export interface BessStudy {
  params: BessParams;
  window: { from: string; to: string; days: number };
  /** Dia publicado (amanhã > hoje > último); = refDays.auto. */
  refDay: RefDay | null;
  /** Dias de referência para o gráfico: publicado, mediano (receita) e melhor dia da janela. */
  refDays: Record<RefMode, RefDay | null>;
  daily: BessDay[];
  last30: BessWindowSummary;
  full: BessWindowSummary;
  margin: { avgBuy: number | null; avgSell: number | null; spread: number | null; netSpread: number | null; lcos: number; netMargin: number | null };
  finance: FinanceResult;
  scenarios: BessScenario[];
  notes: string[];
}

const specOf = (p: { powerMW: number; capacityMWh: number; rte: number }): StorageSpec => ({
  powerMW: p.powerMW,
  capacityMWh: p.capacityMWh,
  etaCharge: Math.sqrt(p.rte),
  etaDischarge: Math.sqrt(p.rte),
  degradationCost: 0,
  dtHours: 1,
  socInit: 0,
  socEnd: 0,
});

interface DayDispatch {
  revenue: number;
  charge: number[];
  discharge: number[];
  soc: number[];
}

async function dispatchDay(prices: number[], p: { powerMW: number; capacityMWh: number; rte: number }, maxCycles: number): Promise<DayDispatch> {
  const r = await optimizeStorageLP(prices, specOf(p), { maxCyclesPerDay: maxCycles });
  return { revenue: r.revenue - r.degradation, charge: r.chargeMW, discharge: r.dischargeMW, soc: r.soc };
}

function summarize(days: BessDay[], buyCash: number, sellCash: number): BessWindowSummary {
  const n = Math.max(1, days.length);
  const charged = days.reduce((s, d) => s + d.chargedMWh, 0);
  const discharged = days.reduce((s, d) => s + d.dischargedMWh, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  return {
    days: days.length,
    revenue,
    revenuePerDay: revenue / n,
    chargedMWh: charged,
    dischargedMWh: discharged,
    cyclesPerDay: days.reduce((s, d) => s + d.cycles, 0) / n,
    opHoursPerDay: days.reduce((s, d) => s + d.opHours, 0) / n,
    avgBuy: charged > 0 ? buyCash / charged : null,
    avgSell: discharged > 0 ? sellCash / discharged : null,
  };
}

async function runWindow(rows: number[][], p: { powerMW: number; capacityMWh: number; rte: number }, maxCycles: number, policy: "lp" | "naive") {
  let revenue = 0, discharged = 0;
  for (const prices of rows) {
    if (policy === "naive") {
      // regra explícita: não opera no dia se o caixa seria negativo (o PLD D+1 sai na véspera)
      const n = naiveDaySchedule(prices, specOf(p));
      if (n.cash > 0) { revenue += n.cash; discharged += n.dischargedMWh; }
    } else {
      const d = await dispatchDay(prices, p, maxCycles);
      revenue += d.revenue;
      discharged += d.discharge.reduce((s, v) => s + v, 0);
    }
  }
  return { revenue, discharged };
}

export async function bessStudy(panel: SubPanel, params: BessParams, now = Date.now()): Promise<BessStudy> {
  const dm = toDayMatrix(panel, params.sub);
  if (dm.rows.length < 7) throw new Error(`histórico de PLD insuficiente em ${params.sub}: ${dm.rows.length} dias`);
  const today = brtDate(now);
  const imputed = new Set(dm.imputed);
  // janela realizada: dias até hoje (inclusive) — amanhã, se publicado, vira o dia de referência
  const pastIdx = dm.dates.map((d, i) => [d, i] as const).filter(([d]) => d <= today).map(([, i]) => i);
  const win = pastIdx.slice(-params.days);
  const rows = win.map((i) => dm.rows[i]);
  const notes: string[] = [];

  const daily: BessDay[] = [];
  let buyCash = 0, sellCash = 0, buy30 = 0, sell30 = 0;
  for (let k = 0; k < win.length; k++) {
    const i = win[k];
    const prices = dm.rows[i];
    const d = await dispatchDay(prices, params, params.maxCyclesPerDay);
    const charged = d.charge.reduce((s, v) => s + v, 0);
    const discharged = d.discharge.reduce((s, v) => s + v, 0);
    const bc = d.charge.reduce((s, v, h) => s + v * prices[h], 0);
    const sc = d.discharge.reduce((s, v, h) => s + v * prices[h], 0);
    buyCash += bc;
    sellCash += sc;
    if (k >= win.length - 30) { buy30 += bc; sell30 += sc; }
    daily.push({
      date: dm.dates[i],
      revenue: d.revenue,
      naive: Math.max(0, naiveDaySchedule(prices, specOf(params)).cash),
      chargedMWh: charged,
      dischargedMWh: discharged,
      // ciclo completo = E retirado do armazenamento (na rede: E·η_d)
      cycles: discharged / (params.capacityMWh * Math.sqrt(params.rte)),
      opHours: d.charge.filter((v, h) => v > 1e-6 || d.discharge[h] > 1e-6).length,
      spread: Math.max(...prices) - Math.min(...prices),
      imputed: imputed.has(dm.dates[i]),
    });
  }
  const full = summarize(daily, buyCash, sellCash);
  const last30 = summarize(daily.slice(-30), buy30, sell30);

  // dia de referência: amanhã publicado > hoje completo > último dia
  const tomorrow = addDays(today, 1);
  const refIdx = dm.dates.indexOf(tomorrow) >= 0 ? dm.dates.indexOf(tomorrow) : dm.dates.indexOf(today) >= 0 ? dm.dates.indexOf(today) : dm.dates.length - 1;
  const makeRef = async (idx: number, label: string): Promise<RefDay> => {
    const date = dm.dates[idx];
    const r = await dispatchDay(dm.rows[idx], params, params.maxCyclesPerDay);
    return {
      date,
      label,
      ts: Array.from({ length: 24 }, (_, h) => Date.parse(`${date}T${String(h).padStart(2, "0")}:00:00-03:00`)),
      price: dm.rows[idx],
      chargeMW: r.charge,
      dischargeMW: r.discharge,
      soc: r.soc,
      revenue: r.revenue,
    };
  };
  const refDate = dm.dates[refIdx];
  const refDay = await makeRef(refIdx, refDate === tomorrow ? "amanhã (PLD publicado)" : refDate === today ? "hoje" : "último dia disponível");
  const byRevenue = daily.map((d, k) => [d.revenue, win[k]] as const).sort((a, b) => a[0] - b[0]);
  const refDays: Record<RefMode, RefDay | null> = {
    auto: refDay,
    median: byRevenue.length ? await makeRef(byRevenue[Math.floor(byRevenue.length / 2)][1], "dia mediano da janela (receita)") : null,
    best: byRevenue.length ? await makeRef(byRevenue[byRevenue.length - 1][1], "melhor dia da janela") : null,
  };

  // anualização pela média diária da janela (sazonalidade do ano inteiro quando days = 365)
  const scale = 365 / Math.max(1, daily.length);
  if (daily.length < 300) notes.push(`Janela de ${daily.length} dias anualizada por ${scale.toFixed(1).replace(".", ",")}× — a sazonalidade (período úmido × seco) pode não estar representada.`);
  const revenueYear = full.revenue * scale;
  const dischargedYear = full.dischargedMWh * scale;
  const finance = bessFinance(params, revenueYear, dischargedYear);

  const avgBuy = full.avgBuy, avgSell = full.avgSell;
  const netSpread = avgBuy !== null && avgSell !== null ? avgSell - avgBuy / params.rte : null;
  const margin = {
    avgBuy,
    avgSell,
    spread: avgBuy !== null && avgSell !== null ? avgSell - avgBuy : null,
    netSpread,
    lcos: params.lcos,
    netMargin: netSpread !== null ? netSpread - params.lcos : null,
  };
  if (margin.netMargin !== null && margin.netMargin < 0) {
    notes.push(`No PLD realizado, cada MWh descarregado rende ${netSpread!.toFixed(2).replace(".", ",")} R$ líquidos de perdas, abaixo do custo nivelado de ${params.lcos.toFixed(2).replace(".", ",")} R$/MWh: a arbitragem pura não paga o ativo. LCOS de equilíbrio: ${finance.breakevenLcos.toFixed(2).replace(".", ",")} R$/MWh.`);
  }

  // cenários: mesmos tamanho e janela, variando eficiência, degradação, custo e política de despacho
  const clampRte = (x: number) => Math.min(0.97, Math.max(0.5, x));
  const scen = [
    { name: "Conservador" as const, policy: "política simples (1 ciclo/dia)", rte: clampRte(params.rte - 0.03), deg: params.degPctYear * 1.5, lcos: params.lcos * 1.15, pol: "naive" as const, cyc: 1 },
    { name: "Padrão" as const, policy: `despacho ótimo (≤ ${params.maxCyclesPerDay} ciclo/dia)`, rte: params.rte, deg: params.degPctYear, lcos: params.lcos, pol: "lp" as const, cyc: params.maxCyclesPerDay },
    { name: "Otimista" as const, policy: "despacho ótimo (≤ 2 ciclos/dia)", rte: clampRte(params.rte + 0.02), deg: params.degPctYear * 0.7, lcos: params.lcos * 0.9, pol: "lp" as const, cyc: Math.max(2, params.maxCyclesPerDay) },
  ];
  const scenarios: BessScenario[] = [];
  for (const s of scen) {
    const res = s.name === "Padrão" ? { revenue: full.revenue, discharged: full.dischargedMWh } : await runWindow(rows, { ...params, rte: s.rte }, s.cyc, s.pol);
    const f = bessFinance({ ...params, rte: s.rte, degPctYear: s.deg, lcos: s.lcos }, res.revenue * scale, res.discharged * scale);
    scenarios.push({ name: s.name, policy: s.policy, powerMW: params.powerMW, capacityMWh: params.capacityMWh, rte: s.rte, degPctYear: s.deg, lcos: s.lcos, revenueYear: res.revenue * scale, paybackYears: f.paybackYears, irr: f.irr, npv: f.npv });
  }

  return {
    params,
    window: { from: daily[0]?.date ?? "", to: daily[daily.length - 1]?.date ?? "", days: daily.length },
    refDay,
    refDays,
    daily,
    last30,
    full,
    margin,
    finance,
    scenarios,
    notes,
  };
}
