import type { Matrix } from "./linalg";

/**
 * LASSO por descida coordenada cíclica (Friedman, Hastie & Tibshirani, 2010,
 * "Regularization Paths for Generalized Linear Models via Coordinate Descent",
 * J. Stat. Software 33(1)) com caminho de λ e warm starts.
 *
 * Seleção de λ por critério de informação usando df = nº de coeficientes ≠ 0
 * (Zou, Hastie & Tibshirani, 2007, Ann. Statist. 35(5)) — mesmo princípio do
 * LassoLarsIC usado pelo LEAR do epftoolbox. Padrão: AICc (Hurvich & Tsai, 1989,
 * Biometrika 76(2)), que corrige o AIC quando df se aproxima de n — essencial em
 * janelas de calibração curtas (p ≈ n), onde o AIC puro escolhe sobreajuste.
 *
 * Aceleração: estratégia de conjunto ativo (varre só coeficientes ≠ 0 até convergir,
 * depois uma varredura completa de verificação) e parada antecipada do caminho.
 *
 * Objetivo: (1/2n)‖y − Xβ‖² + λ‖β‖₁
 */
export interface LassoFit {
  coef: number[];
  intercept: number;
  lambda: number;
  df: number;
  rss: number;
  criterion: number;
}

export interface LassoOptions {
  nLambda?: number;
  minRatio?: number;
  maxSweeps?: number;
  tol?: number;
  criterion?: "aic" | "aicc" | "bic";
}

const soft = (z: number, g: number) => (z > g ? z - g : z < -g ? z + g : 0);

export function lassoIC(X: Matrix, y: ArrayLike<number>, opts: LassoOptions = {}): LassoFit {
  const { nLambda = 25, minRatio = 1e-3, maxSweeps = 200, tol = 1e-5, criterion = "aicc" } = opts;
  const n = X.length;
  const p = X[0]?.length ?? 0;

  // padronização coluna a coluna (armazenamento column-major)
  const mu = new Float64Array(p);
  const sd = new Float64Array(p);
  const cols: Float64Array[] = [];
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    const m = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - m) ** 2;
    const d = Math.sqrt(v / n);
    mu[j] = m;
    sd[j] = d;
    const col = new Float64Array(n);
    if (d > 1e-12) for (let i = 0; i < n; i++) col[i] = (X[i][j] - m) / d;
    cols.push(col);
  }
  let ySum = 0;
  for (let i = 0; i < n; i++) ySum += y[i];
  const yMean = ySum / n;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = y[i] - yMean;

  let lambdaMax = 0;
  for (let j = 0; j < p; j++) {
    let g = 0;
    const c = cols[j];
    for (let i = 0; i < n; i++) g += c[i] * r[i];
    lambdaMax = Math.max(lambdaMax, Math.abs(g) / n);
  }
  const b = new Float64Array(p);
  let best: { crit: number; b: Float64Array; lambda: number; df: number; rss: number } | null = null;

  if (lambdaMax === 0) {
    let rss = 0;
    for (let i = 0; i < n; i++) rss += r[i] ** 2;
    return { coef: new Array(p).fill(0), intercept: yMean, lambda: 0, df: 0, rss, criterion: NaN };
  }

  const sweep = (lambda: number, activeOnly: boolean): number => {
    let maxDelta = 0;
    for (let j = 0; j < p; j++) {
      if (sd[j] <= 1e-12 || (activeOnly && b[j] === 0)) continue;
      const c = cols[j];
      let g = 0;
      for (let i = 0; i < n; i++) g += c[i] * r[i];
      const bj = b[j];
      const nb = soft(g / n + bj, lambda);
      const delta = nb - bj;
      if (delta !== 0) {
        for (let i = 0; i < n; i++) r[i] -= c[i] * delta;
        b[j] = nb;
        maxDelta = Math.max(maxDelta, Math.abs(delta));
      }
    }
    return maxDelta;
  };

  let sinceBest = 0;
  for (let k = 0; k < nLambda; k++) {
    const lambda = lambdaMax * Math.pow(minRatio, k / (nLambda - 1));
    for (let outer = 0; outer < maxSweeps; outer++) {
      if (sweep(lambda, false) < tol) break; // varredura completa convergiu
      for (let inner = 0; inner < maxSweeps; inner++) if (sweep(lambda, true) < tol) break;
    }
    let rss = 0;
    for (let i = 0; i < n; i++) rss += r[i] ** 2;
    let df = 0;
    for (let j = 0; j < p; j++) if (b[j] !== 0) df++;
    if (df >= n - 2) break; // critérios de informação degeneram
    const ll = n * Math.log(Math.max(rss, 1e-12) / n);
    const crit =
      criterion === "bic"
        ? ll + Math.log(n) * df
        : criterion === "aic"
          ? ll + 2 * df
          : ll + 2 * df + (2 * df * (df + 1)) / (n - df - 1);
    if (!best || crit < best.crit) {
      best = { crit, b: b.slice(), lambda, df, rss };
      sinceBest = 0;
    } else if (++sinceBest >= 5) {
      break; // critério piorou por 5 λ seguidos: parada antecipada
    }
  }

  const chosen = best!;
  const coef = new Array<number>(p).fill(0);
  let intercept = yMean;
  for (let j = 0; j < p; j++) {
    if (sd[j] > 1e-12 && chosen.b[j] !== 0) {
      coef[j] = chosen.b[j] / sd[j];
      intercept -= coef[j] * mu[j];
    }
  }
  return { coef, intercept, lambda: chosen.lambda, df: chosen.df, rss: chosen.rss, criterion: chosen.crit };
}

export function predictLinear(fit: { coef: number[]; intercept: number }, x: ArrayLike<number>): number {
  let s = fit.intercept;
  for (let j = 0; j < fit.coef.length; j++) if (fit.coef[j] !== 0) s += fit.coef[j] * x[j];
  return s;
}
