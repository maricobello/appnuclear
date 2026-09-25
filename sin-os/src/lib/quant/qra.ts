import { solve, transposeMul, transposeVec, type Matrix } from "./linalg";

/**
 * Regressão quantílica pelo algoritmo MM de Hunter & Lange (2000),
 * J. Comput. Graph. Statist. 9(1):60–77 — majoriza ρ_τ por uma quadrática:
 *   β ← (X'WX)⁻¹ (X'Wy + (2τ−1)X'1),  w_i = 1/(ε + |r_i|)
 *
 * Quantile Regression Averaging (QRA): Nowotarski & Weron (2015),
 * Computational Statistics 30(3):791–803 — combina previsões pontuais em
 * previsões quantílicas; vencedor de faixas da GEFCom2014.
 */
export function quantileRegression(X: Matrix, y: number[], tau: number, maxIter = 200, eps = 1e-6): number[] {
  const n = X.length;
  const ones = new Array<number>(n).fill(1);
  const X1 = transposeVec(X, ones);
  let beta = solve(transposeMul(X), transposeVec(X, y)); // início OLS
  for (let it = 0; it < maxIter; it++) {
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let f = 0;
      for (let j = 0; j < beta.length; j++) f += X[i][j] * beta[j];
      w[i] = 1 / (eps + Math.abs(y[i] - f));
    }
    const A = transposeMul(X, w);
    const b = transposeVec(X, y, w).map((v, j) => v + (2 * tau - 1) * X1[j]);
    const next = solve(A, b);
    let delta = 0;
    for (let j = 0; j < beta.length; j++) delta = Math.max(delta, Math.abs(next[j] - beta[j]));
    beta = next;
    if (delta < 1e-8) break;
  }
  return beta;
}

export interface QraModel {
  taus: number[];
  betas: number[][];
}

/** Ajusta QRA com regressores [1, f₁, f₂, ...] (previsões pontuais de modelos distintos). */
export function fitQRA(forecasts: number[][], actual: number[], taus: number[]): QraModel {
  const X = forecasts.map((f) => [1, ...f]);
  return { taus, betas: taus.map((t) => quantileRegression(X, actual, t)) };
}

/** Quantis previstos, com rearranjo monotônico (Chernozhukov, Fernández-Val & Galichon, 2010). */
export function predictQRA(model: QraModel, f: number[]): number[] {
  const x = [1, ...f];
  const q = model.betas.map((b) => b.reduce((s, bj, j) => s + bj * x[j], 0));
  return q.sort((a, b) => a - b);
}
