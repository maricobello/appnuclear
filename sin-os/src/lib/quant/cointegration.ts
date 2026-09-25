import { ols } from "./linalg";
import { normCdf } from "./stats";

/**
 * Teste Aumentado de Dickey–Fuller (Said & Dickey, 1984) com seleção de defasagens
 * por AIC (máx. de Schwert: 12·(n/100)^{1/4}), p-valores aproximados por superfície
 * de resposta de MacKinnon (1994, 2010) — mesmos coeficientes do statsmodels.
 *
 * Cointegração de Engle–Granger (1987, Econometrica 55(2)): OLS y = a + b·x + u,
 * ADF sem constante em û, p-valor com tabela N=2.
 */

const TAU = {
  // regressão com constante, N = nº de variáveis (1 = ADF, 2 = EG)
  max: [2.74, 0.92],
  min: [-18.83, -18.86],
  star: [-1.61, -2.62],
  small: [
    [2.1659, 1.4412, 0.038269],
    [2.92, 1.5012, 0.039796],
  ],
  large: [
    [1.7339, 0.93202, -0.12745, -0.010368],
    [2.1945, 0.64695, -0.29198, -0.042377],
  ],
};

export function mackinnonP(stat: number, N: 1 | 2 = 1): number {
  const i = N - 1;
  if (stat > TAU.max[i]) return 1;
  if (stat < TAU.min[i]) return 0;
  const c = stat <= TAU.star[i] ? TAU.small[i] : TAU.large[i];
  let z = 0;
  for (let k = c.length - 1; k >= 0; k--) z = z * stat + c[k];
  return normCdf(z);
}

/** Valores críticos de MacKinnon (2010) para amostra T. */
export function mackinnonCrit(T: number, N: 1 | 2 = 1): { "1%": number; "5%": number; "10%": number } {
  if (N === 1) {
    return {
      "1%": -3.43035 - 6.5393 / T - 16.786 / T ** 2 - 79.433 / T ** 3,
      "5%": -2.86154 - 2.8903 / T - 4.234 / T ** 2 - 40.04 / T ** 3,
      "10%": -2.56677 - 1.5384 / T - 2.809 / T ** 2,
    };
  }
  return {
    "1%": -3.89644 - 10.9519 / T - 22.527 / T ** 2,
    "5%": -3.33613 - 6.1101 / T - 6.823 / T ** 2,
    "10%": -3.04445 - 4.2412 / T - 2.72 / T ** 2,
  };
}

export interface AdfResult {
  statistic: number;
  pValue: number;
  lags: number;
  nobs: number;
  critical: { "1%": number; "5%": number; "10%": number };
  stationary5: boolean;
}

function adfRegression(y: number[], p: number, start: number, constant: boolean) {
  const dy = y.slice(1).map((v, i) => v - y[i]);
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = start; t < dy.length; t++) {
    const row: number[] = constant ? [1, y[t]] : [y[t]];
    for (let i = 1; i <= p; i++) row.push(dy[t - i]);
    X.push(row);
    Y.push(dy[t]);
  }
  return { X, Y };
}

export function adf(y: number[], opts: { maxLag?: number; constant?: boolean; N?: 1 | 2 } = {}): AdfResult {
  const constant = opts.constant ?? true;
  const N = opts.N ?? 1;
  const n = y.length;
  const maxLag = opts.maxLag ?? Math.min(Math.floor(12 * Math.pow(n / 100, 0.25)), Math.floor(n / 4));
  let bestP = 0;
  let bestAic = Infinity;
  for (let p = 0; p <= maxLag; p++) {
    const { X, Y } = adfRegression(y, p, maxLag, constant);
    if (Y.length <= X[0].length + 2) break;
    const r = ols(X, Y);
    const aic = Y.length * Math.log(r.rss / Y.length) + 2 * X[0].length;
    if (aic < bestAic) { bestAic = aic; bestP = p; }
  }
  const { X, Y } = adfRegression(y, bestP, bestP, constant);
  const r = ols(X, Y);
  const gi = constant ? 1 : 0;
  const stat = r.tstat[gi];
  const pValue = mackinnonP(stat, N);
  return {
    statistic: stat,
    pValue,
    lags: bestP,
    nobs: Y.length,
    critical: mackinnonCrit(Y.length, N),
    stationary5: pValue < 0.05,
  };
}

export interface EngleGrangerResult {
  alpha: number;
  hedgeRatio: number;
  adf: AdfResult;
  cointegrated5: boolean;
  residual: number[];
}

export function engleGranger(y: number[], x: number[]): EngleGrangerResult {
  const X = x.map((v) => [1, v]);
  const r = ols(X, y);
  const test = adf(r.resid, { constant: false, N: 2 });
  return {
    alpha: r.beta[0],
    hedgeRatio: r.beta[1],
    adf: test,
    cointegrated5: test.pValue < 0.05,
    residual: r.resid,
  };
}

/** Meia-vida de reversão de um spread: Δs_t = a + b·s_{t−1}  ⇒  t½ = −ln2 / ln(1+b). */
export function halfLife(s: number[]): number {
  const X = s.slice(0, -1).map((v) => [1, v]);
  const Y = s.slice(1).map((v, i) => v - s[i]);
  const b = ols(X, Y).beta[1];
  if (b >= 0 || b <= -1) return Infinity;
  return -Math.log(2) / Math.log(1 + b);
}
