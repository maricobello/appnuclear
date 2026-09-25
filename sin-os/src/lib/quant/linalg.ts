/** Álgebra linear densa mínima (sistemas pequenos: p ≤ ~150). */

export type Matrix = number[][];

export function zeros(r: number, c: number): Matrix {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0));
}

export function transposeMul(X: Matrix, w?: ArrayLike<number>): Matrix {
  // X'WX
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const out = zeros(p, p);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    const wi = w ? w[i] : 1;
    for (let a = 0; a < p; a++) {
      const v = xi[a] * wi;
      if (v === 0) continue;
      const row = out[a];
      for (let b = a; b < p; b++) row[b] += v * xi[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) out[a][b] = out[b][a];
  return out;
}

export function transposeVec(X: Matrix, y: ArrayLike<number>, w?: ArrayLike<number>): number[] {
  const p = X[0]?.length ?? 0;
  const out = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const wy = (w ? w[i] : 1) * y[i];
    const xi = X[i];
    for (let a = 0; a < p; a++) out[a] += xi[a] * wy;
  }
  return out;
}

/** Resolve A x = b por eliminação gaussiana com pivotamento parcial. */
export function solve(A: Matrix, b: ArrayLike<number>): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) M[piv][col] = 1e-14; // regularização mínima
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Inversa por Gauss-Jordan (para erros-padrão de OLS). */
export function invert(A: Matrix): Matrix {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = Math.abs(M[col][col]) < 1e-14 ? 1e-14 : M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

export interface OlsResult {
  beta: number[];
  resid: number[];
  sigma2: number;
  se: number[];
  tstat: number[];
  rss: number;
  n: number;
  k: number;
}

/** Mínimos quadrados ordinários com erros-padrão clássicos. */
export function ols(X: Matrix, y: ArrayLike<number>, ridge = 0): OlsResult {
  const n = X.length;
  const k = X[0].length;
  const XtX = transposeMul(X);
  if (ridge > 0) for (let i = 0; i < k; i++) XtX[i][i] += ridge;
  const Xty = transposeVec(X, y);
  const beta = solve(XtX, Xty);
  const resid = new Array<number>(n);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let j = 0; j < k; j++) f += X[i][j] * beta[j];
    resid[i] = y[i] - f;
    rss += resid[i] ** 2;
  }
  const sigma2 = rss / Math.max(1, n - k);
  const inv = invert(XtX);
  const se = inv.map((row, j) => Math.sqrt(Math.max(0, row[j] * sigma2)));
  const tstat = beta.map((b, j) => (se[j] > 0 ? b / se[j] : 0));
  return { beta, resid, sigma2, se, tstat, rss, n, k };
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
