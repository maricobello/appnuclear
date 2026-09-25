import { quantile, std } from "./stats";

/**
 * HMM gaussiano univariado com K regimes, estimado por EM (Baum–Welch)
 * com forward–backward escalonado (Rabiner, 1989, Proc. IEEE 77(2)).
 * Em preços de energia: Markov-switching para picos/pisos — Hamilton (1989);
 * Janczura & Weron (2010), Energy Economics 32(5):1059–1073.
 */
export interface HmmResult {
  k: number;
  means: number[];
  sds: number[];
  transition: number[][];
  initial: number[];
  filtered: number[][]; // P(S_t | y_1..t)
  smoothed: number[][]; // P(S_t | y_1..T)
  viterbi: number[];
  logLik: number;
  bic: number;
  expectedDuration: number[];
  iterations: number;
}

const LOG2PI = Math.log(2 * Math.PI);

function logNorm(x: number, m: number, s: number): number {
  const z = (x - m) / s;
  return -0.5 * (LOG2PI + 2 * Math.log(s) + z * z);
}

export function fitHmm(y: number[], k = 3, maxIter = 200, tol = 1e-6): HmmResult {
  const T = y.length;
  if (T < 10 * k) throw new Error("série curta demais para HMM");
  // inicialização por quantis (estados ordenados por média)
  let means = Array.from({ length: k }, (_, i) => quantile(y, (i + 0.5) / k));
  const s0 = std(y) || 1;
  let sds = new Array(k).fill(s0 / k + 1e-6);
  let A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.9 : 0.1 / (k - 1))));
  let pi = new Array(k).fill(1 / k);

  let alpha: number[][] = [];
  let beta: number[][] = [];
  let gamma: number[][] = [];
  let logLik = -Infinity;
  let it = 0;
  const minSd = Math.max(1e-6, s0 * 1e-3);

  for (; it < maxIter; it++) {
    const B = y.map((v) => means.map((m, j) => Math.exp(logNorm(v, m, sds[j]))));
    // forward escalonado
    alpha = [];
    const c = new Array<number>(T);
    let a0 = pi.map((p, j) => p * B[0][j]);
    c[0] = a0.reduce((s, v) => s + v, 0) || 1e-300;
    a0 = a0.map((v) => v / c[0]);
    alpha.push(a0);
    for (let t = 1; t < T; t++) {
      const prev = alpha[t - 1];
      let at = new Array<number>(k).fill(0);
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let i = 0; i < k; i++) s += prev[i] * A[i][j];
        at[j] = s * B[t][j];
      }
      c[t] = at.reduce((s, v) => s + v, 0) || 1e-300;
      at = at.map((v) => v / c[t]);
      alpha.push(at);
    }
    // backward escalonado
    beta = new Array(T);
    beta[T - 1] = new Array(k).fill(1);
    for (let t = T - 2; t >= 0; t--) {
      const bt = new Array<number>(k).fill(0);
      for (let i = 0; i < k; i++) {
        let s = 0;
        for (let j = 0; j < k; j++) s += A[i][j] * B[t + 1][j] * beta[t + 1][j];
        bt[i] = s / c[t + 1];
      }
      beta[t] = bt;
    }
    const newLL = c.reduce((s, v) => s + Math.log(v), 0);
    gamma = alpha.map((a, t) => {
      const g = a.map((v, j) => v * beta[t][j]);
      const z = g.reduce((s, v) => s + v, 0) || 1e-300;
      return g.map((v) => v / z);
    });
    // M-step
    const xiSum = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          xiSum[i][j] += (alpha[t][i] * A[i][j] * B[t + 1][j] * beta[t + 1][j]) / c[t + 1];
        }
      }
    }
    A = xiSum.map((row) => {
      const z = row.reduce((s, v) => s + v, 0) || 1e-300;
      return row.map((v) => Math.max(v / z, 1e-8));
    });
    pi = gamma[0].slice();
    const newMeans: number[] = [];
    const newSds: number[] = [];
    for (let j = 0; j < k; j++) {
      let w = 0, s = 0;
      for (let t = 0; t < T; t++) { w += gamma[t][j]; s += gamma[t][j] * y[t]; }
      const m = w > 0 ? s / w : means[j];
      let v = 0;
      for (let t = 0; t < T; t++) v += gamma[t][j] * (y[t] - m) ** 2;
      newMeans.push(m);
      newSds.push(Math.max(minSd, Math.sqrt(w > 0 ? v / w : sds[j] ** 2)));
    }
    means = newMeans;
    sds = newSds;
    if (Math.abs(newLL - logLik) < tol * Math.abs(newLL)) { logLik = newLL; break; }
    logLik = newLL;
  }

  // ordenar estados pela média (0 = mais baixo)
  const order = means.map((m, i) => [m, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const perm = (v: number[]) => order.map((i) => v[i]);
  means = perm(means);
  sds = perm(sds);
  A = order.map((i) => order.map((j) => A[i][j]));
  pi = perm(pi);
  const filtered = alpha.map(perm);
  const smoothed = gamma.map(perm);

  // Viterbi (log)
  const logA = A.map((r) => r.map(Math.log));
  let delta = means.map((m, j) => Math.log(pi[j] + 1e-300) + logNorm(y[0], m, sds[j]));
  const psi: number[][] = [];
  for (let t = 1; t < T; t++) {
    const nd = new Array<number>(k);
    const ps = new Array<number>(k);
    for (let j = 0; j < k; j++) {
      let best = -Infinity, arg = 0;
      for (let i = 0; i < k; i++) {
        const v = delta[i] + logA[i][j];
        if (v > best) { best = v; arg = i; }
      }
      nd[j] = best + logNorm(y[t], means[j], sds[j]);
      ps[j] = arg;
    }
    psi.push(ps);
    delta = nd;
  }
  const path = new Array<number>(T);
  path[T - 1] = delta.indexOf(Math.max(...delta));
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t][path[t + 1]];

  const nParams = k * k - k + 2 * k + (k - 1);
  return {
    k,
    means,
    sds,
    transition: A,
    initial: pi,
    filtered,
    smoothed,
    viterbi: path,
    logLik,
    bic: -2 * logLik + nParams * Math.log(T),
    expectedDuration: A.map((r, i) => 1 / Math.max(1e-9, 1 - r[i])),
    iterations: it,
  };
}

/** Probabilidades de regime h passos à frente: p_{t+h} = p_t · A^h. */
export function regimeForecast(p: number[], A: number[][], h: number): number[][] {
  const out: number[][] = [];
  let cur = p.slice();
  for (let s = 0; s < h; s++) {
    cur = cur.map((_, j) => cur.reduce((acc, pi, i) => acc + pi * A[i][j], 0));
    out.push(cur);
  }
  return out;
}

export const hmmStateLabel = (k: number, i: number): string =>
  k === 2 ? ["Normal", "Pico"][i] : k === 3 ? ["Piso/Excedente", "Base", "Estresse/Pico"][i] : `S${i}`;

