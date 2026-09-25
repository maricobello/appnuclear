import { ols } from "./linalg";
import { mean, std } from "./stats";

/**
 * Arbitragem temporal com armazenamento (bateria / reservatório / flexibilidade).
 *
 * 1) Valor INTRÍNSECO — Programação Dinâmica (Bellman, 1957) sobre a grade de SoC
 *    com a curva de preços esperada.
 * 2) Valor com OPCIONALIDADE — Least-Squares Monte Carlo (Longstaff & Schwartz, 2001,
 *    RFS 14(1)) adaptado a armazenamento por Boogert & de Jong (2008),
 *    J. Derivatives 15(3):81–98, "Gas Storage Valuation Using a Monte Carlo Method".
 *    Política estimada em trajetórias de treino e avaliada em trajetórias
 *    independentes ⇒ estimador de limite inferior não viesado.
 * 3) Limite superior de informação perfeita: DP trajetória a trajetória.
 *
 *    intrínseco ≤ LSMC (política implementável) ≤ informação perfeita
 */
export interface StorageSpec {
  capacityMWh: number;
  powerMW: number;
  etaCharge: number;
  etaDischarge: number;
  dtHours?: number;
  socInit?: number; // fração 0..1
  socEnd?: number; // fração mínima ao final
  levels?: number;
  degradationCost?: number; // R$/MWh de energia movimentada
}

interface Grid {
  N: number;
  dE: number;
  kUp: number;
  kDown: number;
  i0: number;
  iEnd: number;
  deg: number;
  etaC: number;
  etaD: number;
}

/**
 * Grade de SoC: por padrão escolhe ΔE ≈ (P·dt·η_c)/4 para que a potência máxima seja
 * representada por ~4 passos da grade (erro de discretização < 5%).
 */
function grid(spec: StorageSpec): Grid {
  const dt = spec.dtHours ?? 1;
  const auto = Math.round(spec.capacityMWh / ((spec.powerMW * dt * spec.etaCharge) / 4));
  const N = spec.levels ?? Math.min(60, Math.max(8, auto));
  const dE = spec.capacityMWh / N;
  return {
    N,
    dE,
    kUp: Math.max(1, Math.floor((spec.powerMW * dt * spec.etaCharge) / dE + 0.05)),
    kDown: Math.max(1, Math.floor((spec.powerMW * dt) / (spec.etaDischarge * dE) + 0.05)),
    i0: Math.round((spec.socInit ?? 0.5) * N),
    iEnd: Math.round((spec.socEnd ?? spec.socInit ?? 0.5) * N),
    deg: spec.degradationCost ?? 0,
    etaC: spec.etaCharge,
    etaD: spec.etaDischarge,
  };
}

/** Fluxo de caixa (R$) ao mover o SoC de i para j ao preço p. Positivo = receita. */
function cash(g: Grid, i: number, j: number, p: number): number {
  const d = (j - i) * g.dE;
  if (d > 0) return -(d / g.etaC) * p - g.deg * d;
  if (d < 0) return -d * g.etaD * p + g.deg * d;
  return 0;
}

function terminal(g: Grid, i: number, penaltyPrice: number): number {
  return i >= g.iEnd ? 0 : -((g.iEnd - i) * g.dE / g.etaC) * penaltyPrice;
}

export interface DispatchStep {
  t: number;
  price: number;
  gridMW: number; // + injeta (descarga), − consome (carga)
  soc: number; // fração após o passo
  cash: number;
}

export interface DpResult {
  value: number;
  schedule: DispatchStep[];
  chargedMWh: number;
  dischargedMWh: number;
  cycles: number;
}

export function optimizeStorageDP(prices: number[], spec: StorageSpec): DpResult {
  const g = grid(spec);
  const T = prices.length;
  const dt = spec.dtHours ?? 1;
  const pen = Math.max(...prices.map(Math.abs), 1) * 3;
  let V = Array.from({ length: g.N + 1 }, (_, i) => terminal(g, i, pen));
  const policy: Int16Array[] = [];
  for (let t = T - 1; t >= 0; t--) {
    const nv = new Array<number>(g.N + 1);
    const pol = new Int16Array(g.N + 1);
    for (let i = 0; i <= g.N; i++) {
      let best = -Infinity, arg = i;
      for (let j = Math.max(0, i - g.kDown); j <= Math.min(g.N, i + g.kUp); j++) {
        const v = cash(g, i, j, prices[t]) + V[j];
        if (v > best) { best = v; arg = j; }
      }
      nv[i] = best;
      pol[i] = arg;
    }
    policy[t] = pol;
    V = nv;
  }
  const schedule: DispatchStep[] = [];
  let i = g.i0;
  let charged = 0, discharged = 0;
  for (let t = 0; t < T; t++) {
    const j = policy[t][i];
    const c = cash(g, i, j, prices[t]);
    const dStore = (j - i) * g.dE;
    const gridMWh = dStore > 0 ? -dStore / g.etaC : -dStore * g.etaD;
    if (dStore > 0) charged += dStore / g.etaC; else discharged += -dStore * g.etaD;
    schedule.push({ t, price: prices[t], gridMW: gridMWh / dt, soc: j / g.N, cash: c });
    i = j;
  }
  return {
    value: V[g.i0],
    schedule,
    chargedMWh: charged,
    dischargedMWh: discharged,
    cycles: discharged / Math.max(1e-9, spec.capacityMWh),
  };
}

export interface LsmcResult {
  value: number; // média da política LSMC em trajetórias independentes
  stdErr: number;
  intrinsic: number; // DP na curva média
  extrinsic: number; // value − intrinsic
  perfectForesight: number; // limite superior
  pnl: number[]; // amostras de P&L por trajetória (avaliação)
}

const basis = (z: number) => [1, z, z * z, z * z * z];

export function valueStorageLSMC(train: number[][], evalPaths: number[][], spec: StorageSpec): LsmcResult {
  const g = grid(spec);
  const T = train[0].length;
  const M = train.length;
  const allAbs = train.flat().map(Math.abs);
  const pen = Math.max(...allAbs, 1) * 3;

  // normalização por passo (estabilidade numérica da regressão)
  const mu = new Array<number>(T);
  const sd = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    const col = train.map((p) => p[t]);
    mu[t] = mean(col);
    sd[t] = std(col) || 1;
  }

  let Vnext: Float64Array[] = Array.from({ length: g.N + 1 }, (_, i) => new Float64Array(M).fill(terminal(g, i, pen)));
  const coefs: number[][][] = new Array(T);
  for (let t = T - 1; t >= 0; t--) {
    const X = train.map((p) => basis((p[t] - mu[t]) / sd[t]));
    const cf: number[][] = [];
    for (let j = 0; j <= g.N; j++) cf.push(ols(X, Vnext[j], 1e-6).beta);
    coefs[t] = cf;
    const Vcur: Float64Array[] = Array.from({ length: g.N + 1 }, () => new Float64Array(M));
    for (let m = 0; m < M; m++) {
      const p = train[m][t];
      const bz = X[m];
      const cont = cf.map((b) => b[0] * bz[0] + b[1] * bz[1] + b[2] * bz[2] + b[3] * bz[3]);
      for (let i = 0; i <= g.N; i++) {
        let best = -Infinity, arg = i;
        for (let j = Math.max(0, i - g.kDown); j <= Math.min(g.N, i + g.kUp); j++) {
          const v = cash(g, i, j, p) + cont[j];
          if (v > best) { best = v; arg = j; }
        }
        Vcur[i][m] = cash(g, i, arg, p) + Vnext[arg][m];
      }
    }
    Vnext = Vcur;
  }

  // avaliação fora da amostra da política
  const pnl: number[] = [];
  for (const path of evalPaths) {
    let i = g.i0;
    let total = 0;
    for (let t = 0; t < T; t++) {
      const p = path[t];
      const bz = basis((p - mu[t]) / sd[t]);
      let best = -Infinity, arg = i;
      for (let j = Math.max(0, i - g.kDown); j <= Math.min(g.N, i + g.kUp); j++) {
        const b = coefs[t][j];
        const v = cash(g, i, j, p) + b[0] * bz[0] + b[1] * bz[1] + b[2] * bz[2] + b[3] * bz[3];
        if (v > best) { best = v; arg = j; }
      }
      total += cash(g, i, arg, p);
      i = arg;
    }
    total += terminal(g, i, pen);
    pnl.push(total);
  }
  const value = mean(pnl);
  const meanPath = Array.from({ length: T }, (_, t) => mean(evalPaths.map((p) => p[t])));
  const intrinsic = optimizeStorageDP(meanPath, spec).value;
  const pf = mean(evalPaths.slice(0, Math.min(200, evalPaths.length)).map((p) => optimizeStorageDP(p, spec).value));
  return {
    value,
    stdErr: std(pnl) / Math.sqrt(pnl.length),
    intrinsic,
    extrinsic: value - intrinsic,
    perfectForesight: pf,
    pnl,
  };
}
