/**
 * Modelo econômico de um BESS merchant no PLD — coerente e fechado (sem números mágicos).
 *
 * Custo nivelado de armazenamento (LCOS, R$/MWh descarregado), definição usual (Lazard;
 * Schmidt et al., 2019, Joule 3(1):81–100), sem o custo de carga (que já sai da receita de
 * arbitragem):
 *
 *   LCOS = (CAPEX + Σ_t OPEX/(1+r)^t) / Σ_t Q_t/(1+r)^t,   OPEX = o·CAPEX,
 *   Q_t = ciclos_ref·365·E·√η·(1−d)^(t−1)   (MWh entregues à rede por ciclo completo)
 *
 * O usuário informa o LCOS (como no mercado: "quanto custa cada MWh que a bateria entrega"),
 * e o CAPEX IMPLÍCITO sai da equação acima para o perfil de referência (ciclos/dia). O fluxo
 * de caixa real usa a receita do despacho no PLD verdadeiro:
 *
 *   FC_0 = −CAPEX ;  FC_t = R_1·(1−d)^(t−1) − OPEX,  t = 1…vida
 *
 * Daí VPL, TIR, payback, ROI e o LCOS de equilíbrio (VPL = 0) em forma fechada:
 *   LCOS* = R_1 · Σ(1−d)^(t−1)/(1+r)^t / Σ Q_t/(1+r)^t
 */
export interface FinanceInputs {
  powerMW: number;
  capacityMWh: number;
  /** Eficiência ida-volta (0–1). */
  rte: number;
  /** Perda de capacidade por ano (%). */
  degPctYear: number;
  /** Custo nivelado informado (R$/MWh descarregado). */
  lcos: number;
  /** Custo de capital real (% a.a.). */
  waccPct: number;
  lifeYears: number;
  /** OPEX fixo anual (% do CAPEX). */
  opexPctCapex: number;
  /** Ciclos completos por dia no perfil de referência do LCOS. */
  refCyclesPerDay: number;
}

export interface FinanceResult {
  capex: number;
  capexPerKWh: number;
  opexYear: number;
  /** Receita de arbitragem no ano 1 (R$). */
  revenueYear1: number;
  /** Energia descarregada no ano 1 (MWh). */
  dischargedYear1: number;
  /** Custo anual equivalente pelo LCOS informado × energia realmente descarregada. */
  lcosCostYear1: number;
  netYear1: number;
  cashflows: number[];
  npv: number;
  irr: number | null;
  paybackYears: number | null;
  roi: number;
  /** LCOS que zera o VPL com a receita observada. */
  breakevenLcos: number;
  /** Custo por MWh no despacho REAL (menos ciclos que o perfil de referência ⇒ mais caro). */
  effectiveLcos: number | null;
}

const pv = (r: number, n: number, f: (t: number) => number) => {
  let s = 0;
  for (let t = 1; t <= n; t++) s += f(t) / (1 + r) ** t;
  return s;
};

export function npvAt(cashflows: number[], r: number): number {
  return cashflows.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
}

/** TIR por bisseção; null se o projeto não devolve o investimento (Σ FC ≤ 0) ou sem troca de sinal. */
export function irr(cashflows: number[]): number | null {
  if (cashflows.reduce((a, b) => a + b, 0) <= 0) return null;
  let lo = -0.9, hi = 5;
  if (npvAt(cashflows, lo) * npvAt(cashflows, hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npvAt(cashflows, mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Payback simples (anos, interpolado); null se não se paga dentro da vida útil. */
export function payback(cashflows: number[]): number | null {
  let cum = cashflows[0];
  for (let t = 1; t < cashflows.length; t++) {
    const prev = cum;
    cum += cashflows[t];
    if (cum >= 0 && cashflows[t] > 0) return t - 1 + -prev / cashflows[t];
  }
  return null;
}

export function bessFinance(inp: FinanceInputs, revenueYear1: number, dischargedYear1: number): FinanceResult {
  const r = inp.waccPct / 100;
  const d = inp.degPctYear / 100;
  const o = inp.opexPctCapex / 100;
  const L = Math.max(1, Math.round(inp.lifeYears));
  const fade = (t: number) => (1 - d) ** (t - 1);
  const A = pv(r, L, () => 1);
  const qRef = pv(r, L, (t) => inp.refCyclesPerDay * 365 * inp.capacityMWh * Math.sqrt(inp.rte) * fade(t));
  const capex = (inp.lcos * qRef) / (1 + o * A);
  const opexYear = o * capex;
  const cashflows = [-capex, ...Array.from({ length: L }, (_, k) => revenueYear1 * fade(k + 1) - opexYear)];
  const B = pv(r, L, fade);
  const qReal = pv(r, L, (t) => dischargedYear1 * fade(t));
  return {
    capex,
    capexPerKWh: capex / (inp.capacityMWh * 1000),
    opexYear,
    revenueYear1,
    dischargedYear1,
    lcosCostYear1: inp.lcos * dischargedYear1,
    netYear1: revenueYear1 - opexYear,
    cashflows,
    npv: npvAt(cashflows, r),
    irr: irr(cashflows),
    paybackYears: payback(cashflows),
    roi: (cashflows.slice(1).reduce((a, b) => a + b, 0) - capex) / capex,
    breakevenLcos: qRef > 0 ? (revenueYear1 * B) / qRef : 0,
    effectiveLcos: qReal > 0 ? (capex * (1 + o * A)) / qReal : null,
  };
}
