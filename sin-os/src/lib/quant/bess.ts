import type { StorageSpec } from "./storage";

/**
 * Despacho ótimo EXATO de armazenamento por programação linear (HiGHS — Huangfu &
 * Hall, 2018, Math. Prog. Comp. 10:119–142; compilado para WebAssembly, pacote `highs`).
 *
 *   max Σ_t [ p_t (d_t − c_t) Δt − κ (η_c c_t Δt + d_t Δt/η_d) ] + V(e_T)
 *   s.a. e_t = e_{t−1} + η_c c_t Δt − d_t Δt/η_d
 *        0 ≤ c_t, d_t ≤ P ;  E_min ≤ e_t ≤ E_max ;  |(d_t − c_t) − (d_{t−1} − c_{t−1})| ≤ R
 *        Σ d_t Δt/η_d ≤ N_ciclos · E · dias
 *
 * c_t, d_t: potência de carga/descarga na rede (MW); e_t: energia armazenada (MWh);
 * κ: custo de degradação por MWh movimentado no armazenamento (mesma convenção da DP).
 * V(e_T): valor terminal côncavo por partes (valor da energia deixada para os dias
 * seguintes) ou, na falta dele, e_T ≥ socEnd·E. Com preço negativo a carga e a descarga
 * simultâneas deixariam de ser dominadas; nesse caso entra a binária u_t (MILP).
 * Sem discretização de SoC: é o ótimo do problema contínuo (a DP em grade é o oráculo).
 */
export interface BessLpOpts {
  /** Segmentos do valor terminal: [energia (MWh), R$/MWh], em ordem de valor decrescente. */
  terminalValue?: { mwh: number; value: number }[];
  maxCyclesPerDay?: number;
  /** Variação máxima da potência líquida entre passos (MW). */
  rampMW?: number;
  socMin?: number;
  socMax?: number;
}

export interface BessLpResult {
  status: string;
  value: number;
  revenue: number;
  degradation: number;
  terminal: number;
  chargeMW: number[];
  dischargeMW: number[];
  soc: number[];
  chargedMWh: number;
  dischargedMWh: number;
  cycles: number;
  mip: boolean;
}

type Highs = { solve: (lp: string, opts?: Record<string, unknown>) => HighsSolution };
interface HighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number }>;
}

const g = globalThis as typeof globalThis & { __sinHighs?: Promise<Highs> };

async function highs(): Promise<Highs> {
  g.__sinHighs ??= import("highs").then((m) => (m.default as unknown as () => Promise<Highs>)());
  return g.__sinHighs;
}

const num = (x: number) => (Math.abs(x) < 1e-12 ? "0" : x.toPrecision(12));

/** Monta o LP no formato CPLEX-LP aceito pelo HiGHS. */
export function buildBessLp(prices: number[], spec: StorageSpec, opts: BessLpOpts = {}): { lp: string; mip: boolean } {
  const T = prices.length;
  const dt = spec.dtHours ?? 1;
  const E = spec.capacityMWh;
  const P = spec.powerMW;
  const ec = spec.etaCharge;
  const ed = spec.etaDischarge;
  const k = spec.degradationCost ?? 0;
  const eMin = (opts.socMin ?? 0) * E;
  const eMax = (opts.socMax ?? 1) * E;
  const e0 = (spec.socInit ?? 0.5) * E;
  const mip = prices.some((p) => p < 0);

  const obj: string[] = [];
  const rows: string[] = [];
  const bounds: string[] = [];
  const bins: string[] = [];
  const term = (coef: number, v: string) => `${coef >= 0 ? "+" : "-"} ${num(Math.abs(coef))} ${v}`;

  for (let t = 0; t < T; t++) {
    obj.push(term((prices[t] - k / ed) * dt, `d${t}`), term((-prices[t] - k * ec) * dt, `c${t}`));
    const prev = t === 0 ? "" : ` - e${t - 1}`;
    rows.push(` bal${t}: e${t}${prev} ${term(-ec * dt, `c${t}`)} ${term(dt / ed, `d${t}`)} = ${num(t === 0 ? e0 : 0)}`);
    bounds.push(` 0 <= c${t} <= ${num(P)}`, ` 0 <= d${t} <= ${num(P)}`, ` ${num(eMin)} <= e${t} <= ${num(eMax)}`);
    if (mip) {
      rows.push(` xc${t}: c${t} ${term(-P, `u${t}`)} <= 0`, ` xd${t}: d${t} ${term(P, `u${t}`)} <= ${num(P)}`);
      bins.push(` u${t}`);
    }
    if (opts.rampMW !== undefined && t > 0) {
      const net = `d${t} - c${t} - d${t - 1} + c${t - 1}`;
      rows.push(` ru${t}: ${net} <= ${num(opts.rampMW)}`, ` rd${t}: ${net} >= ${num(-opts.rampMW)}`);
    }
  }
  if (opts.maxCyclesPerDay !== undefined) {
    const days = Math.max(1, (T * dt) / 24);
    rows.push(` cyc: ${Array.from({ length: T }, (_, t) => term(dt / ed, `d${t}`)).join(" ")} <= ${num(opts.maxCyclesPerDay * E * days)}`);
  }
  const eT = `e${T - 1}`;
  if (opts.terminalValue?.length) {
    // e_T = E_min + Σ s_j ; valores decrescentes ⇒ o LP preenche os segmentos em ordem (côncavo)
    const segs = opts.terminalValue;
    rows.push(` tv: ${eT} ${segs.map((_, j) => `- s${j}`).join(" ")} = ${num(eMin)}`);
    segs.forEach((s, j) => {
      obj.push(term(s.value, `s${j}`));
      bounds.push(` 0 <= s${j} <= ${num(s.mwh)}`);
    });
  } else {
    rows.push(` end: ${eT} >= ${num(Math.min(eMax, Math.max(eMin, (spec.socEnd ?? spec.socInit ?? 0.5) * E)))}`);
  }
  const lp =
    `Maximize\n obj: ${obj.join(" ").replace(/^\+ /, "")}\nSubject To\n${rows.join("\n")}\nBounds\n${bounds.join("\n")}\n` +
    (bins.length ? `Binary\n${bins.join("\n")}\n` : "") +
    "End\n";
  return { lp, mip };
}

export async function optimizeStorageLP(prices: number[], spec: StorageSpec, opts: BessLpOpts = {}): Promise<BessLpResult> {
  const T = prices.length;
  const dt = spec.dtHours ?? 1;
  const { lp, mip } = buildBessLp(prices, spec, opts);
  const sol = (await highs()).solve(lp, { presolve: "on" });
  const col = (n: string) => sol.Columns[n]?.Primal ?? 0;
  const chargeMW = Array.from({ length: T }, (_, t) => col(`c${t}`));
  const dischargeMW = Array.from({ length: T }, (_, t) => col(`d${t}`));
  const soc = Array.from({ length: T }, (_, t) => col(`e${t}`) / spec.capacityMWh);
  const k = spec.degradationCost ?? 0;
  let revenue = 0, degradation = 0, charged = 0, discharged = 0;
  for (let t = 0; t < T; t++) {
    revenue += prices[t] * (dischargeMW[t] - chargeMW[t]) * dt;
    degradation += k * (spec.etaCharge * chargeMW[t] * dt + (dischargeMW[t] * dt) / spec.etaDischarge);
    charged += chargeMW[t] * dt;
    discharged += dischargeMW[t] * dt;
  }
  const terminal = (opts.terminalValue ?? []).reduce((s, seg, j) => s + seg.value * col(`s${j}`), 0);
  return {
    status: sol.Status,
    value: sol.ObjectiveValue,
    revenue,
    degradation,
    terminal,
    chargeMW,
    dischargeMW,
    soc,
    chargedMWh: charged,
    dischargedMWh: discharged,
    cycles: discharged / Math.max(1e-9, spec.capacityMWh),
    mip,
  };
}
