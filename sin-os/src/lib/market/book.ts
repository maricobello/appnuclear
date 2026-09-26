import { SUBS, type Sub, type SubPanel } from "../sources/types";
import { brtDate } from "../sources/time";

/**
 * Carteira de contratos de energia — liquidação e marcação a mercado (MtM) contra o PLD.
 *
 * Modelo: contrato como SWAP FINANCEIRO sobre o PLD mensal do submercado (a forma como a
 * CCEE liquida as diferenças de curto prazo é ex-post, mensal, sobre a exposição, usando o
 * PLD médio mensal). Para um comprador a preço fixo K, o resultado da liquidação de um mês
 * é (PLD_médio_mês − K)·energia; para um vendedor, (K − PLD_médio_mês)·energia. Energia do
 * mês = volume (MWmédio) × horas do mês.
 *
 * Simplificações assumidas (sinalizadas na tela): não modela sazonalização/flexibilidade,
 * encargos, TUST/TUSD, tributos, MRE/GSF nem garantia física — é o resultado de curto prazo
 * (a "metade PLD" do P&L). Meses futuros precisam da curva a termo (BBCE), que o app não tem;
 * aqui só liquidamos meses com PLD realizado disponível.
 */
export type Side = "compra" | "venda";

export interface Contract {
  id: string;
  label?: string;
  submarket: Sub;
  side: Side;
  /** Volume em MW médio (energia constante ao longo das horas do mês). */
  volumeMWm: number;
  /** Preço fixo do contrato, R$/MWh. */
  priceRS: number;
  /** Mês inicial e final, inclusive, no formato YYYY-MM. */
  start: string;
  end: string;
}

export interface MonthlyPld {
  /** PLD médio mensal por submercado: month "YYYY-MM" → (submercado → R$/MWh). */
  byMonth: Record<string, Partial<Record<Sub, number>>>;
  months: string[]; // ordenados
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m: string) => MONTH_RE.test(m);

/** Horas de um mês "YYYY-MM" (considera anos bissextos; fuso irrelevante para contagem). */
export function hoursInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() * 24;
}

/** Lista de meses YYYY-MM de start a end, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  if (!isMonth(start) || !isMonth(end) || start > end) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 600) break;
  }
  return out;
}

/** PLD médio mensal por submercado a partir do painel horário realizado. */
export function monthlyPldFromPanel(panel: SubPanel): MonthlyPld {
  const acc = new Map<string, Record<Sub, { s: number; n: number }>>();
  panel.ts.forEach((t, i) => {
    const month = brtDate(t).slice(0, 7);
    const row = acc.get(month) ?? (Object.fromEntries(SUBS.map((s) => [s, { s: 0, n: 0 }])) as Record<Sub, { s: number; n: number }>);
    for (const s of SUBS) {
      const v = panel.values[s][i];
      if (v !== null && Number.isFinite(v)) { row[s].s += v; row[s].n++; }
    }
    acc.set(month, row);
  });
  const byMonth: MonthlyPld["byMonth"] = {};
  for (const [month, row] of acc) {
    byMonth[month] = Object.fromEntries(SUBS.filter((s) => row[s].n >= 24 * 20).map((s) => [s, row[s].s / row[s].n]));
  }
  return { byMonth, months: [...Object.keys(byMonth)].sort() };
}

export interface MonthResult {
  month: string;
  pld: number | null; // PLD médio do submercado no mês (null = sem dado realizado)
  energyMWh: number;
  settlementRS: number | null; // resultado da liquidação (null quando falta PLD)
  covered: boolean;
}

export interface ContractResult {
  contract: Contract;
  months: MonthResult[];
  settledRS: number; // soma dos meses com PLD realizado
  coveredMonths: number;
  openMonths: number; // meses sem PLD (dependem da curva a termo)
  energyMWh: number;
}

/** Sinal do resultado: comprador ganha quando PLD > K; vendedor quando K > PLD. */
const dirSign = (side: Side) => (side === "compra" ? 1 : -1);

export function settleContract(c: Contract, pld: MonthlyPld): ContractResult {
  const months = monthsBetween(c.start, c.end).map((month): MonthResult => {
    const energyMWh = c.volumeMWm * hoursInMonth(month);
    const p = pld.byMonth[month]?.[c.submarket];
    const has = p !== undefined && Number.isFinite(p);
    return {
      month,
      pld: has ? p! : null,
      energyMWh,
      settlementRS: has ? dirSign(c.side) * (p! - c.priceRS) * energyMWh : null,
      covered: has,
    };
  });
  const covered = months.filter((m) => m.covered);
  return {
    contract: c,
    months,
    settledRS: covered.reduce((s, m) => s + (m.settlementRS ?? 0), 0),
    coveredMonths: covered.length,
    openMonths: months.length - covered.length,
    energyMWh: months.reduce((s, m) => s + m.energyMWh, 0),
  };
}

export interface ExposureRow {
  submarket: Sub;
  /** Exposição líquida em MW médio (compra positiva, venda negativa) no mês corrente coberto. */
  netMWm: number;
  contracts: number;
}

export interface BookSummary {
  results: ContractResult[];
  settledRS: number;
  coveredMonths: number;
  openMonths: number;
  /** Exposição líquida por submercado (soma dos volumes ativos no último mês com PLD). */
  exposure: ExposureRow[];
  latestMonth: string | null;
}

export function bookSummary(contracts: Contract[], pld: MonthlyPld): BookSummary {
  const results = contracts.map((c) => settleContract(c, pld));
  const latestMonth = pld.months[pld.months.length - 1] ?? null;
  const exp = new Map<Sub, { net: number; n: number }>();
  if (latestMonth) {
    for (const c of contracts) {
      if (latestMonth < c.start || latestMonth > c.end) continue;
      const e = exp.get(c.submarket) ?? { net: 0, n: 0 };
      e.net += dirSign(c.side) * c.volumeMWm;
      e.n++;
      exp.set(c.submarket, e);
    }
  }
  return {
    results,
    settledRS: results.reduce((s, r) => s + r.settledRS, 0),
    coveredMonths: results.reduce((s, r) => s + r.coveredMonths, 0),
    openMonths: results.reduce((s, r) => s + r.openMonths, 0),
    exposure: SUBS.filter((s) => exp.has(s)).map((s) => ({ submarket: s, netMWm: exp.get(s)!.net, contracts: exp.get(s)!.n })),
    latestMonth,
  };
}
