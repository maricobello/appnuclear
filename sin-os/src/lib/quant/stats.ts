/**
 * Primitivas estatísticas usadas por todos os modelos.
 * Implementações numéricas clássicas (Numerical Recipes, Acklam, Lanczos),
 * sem dependências externas para rodar em qualquer runtime (Node/Edge).
 */

export const sum = (x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s;
};

export const mean = (x: ArrayLike<number>): number => (x.length ? sum(x) / x.length : NaN);

export function variance(x: ArrayLike<number>, ddof = 1): number {
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - m) ** 2;
  return s / (n - ddof);
}

export const std = (x: ArrayLike<number>, ddof = 1): number => Math.sqrt(variance(x, ddof));

/** Quantil tipo 7 (padrão R/NumPy), interpolação linear. */
export function quantile(x: ArrayLike<number>, p: number): number {
  const a = Array.from(x).filter(Number.isFinite).sort((u, v) => u - v);
  if (!a.length) return NaN;
  const h = (a.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return a[lo] + (h - lo) * (a[hi] - a[lo]);
}

export const median = (x: ArrayLike<number>): number => quantile(x, 0.5);

/** Median absolute deviation (não escalonado). */
export function mad(x: ArrayLike<number>): number {
  const m = median(x);
  return median(Array.from(x, (v) => Math.abs(v - m)));
}

export function autocorr(x: ArrayLike<number>, lag: number): number {
  const n = x.length;
  if (lag >= n) return NaN;
  const m = mean(x);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += (x[i] - m) ** 2;
    if (i >= lag) num += (x[i] - m) * (x[i - lag] - m);
  }
  return den === 0 ? 0 : num / den;
}

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Filtro de Hampel: índices com |x - mediana_janela| > k * 1.4826 * MAD_janela. */
export function hampelOutliers(x: ArrayLike<number>, halfWindow = 12, k = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(x.length, i + halfWindow + 1);
    const w: number[] = [];
    for (let j = lo; j < hi; j++) w.push(x[j]);
    const m = median(w);
    const s = 1.4826 * mad(w);
    if (s > 0 && Math.abs(x[i] - m) > k * s) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distribuições
// ---------------------------------------------------------------------------

/** erf com erro < 1.2e-7 (Numerical Recipes, erfc Chebyshev). */
export function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - r : r - 1;
}

export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Inversa da normal padrão (algoritmo de Acklam, erro relativo ~1e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** log Γ(x) — aproximação de Lanczos (g=7, n=9). */
export function lgamma(x: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = coef[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += coef[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Fração continuada da beta incompleta (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a,b). */
export function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** CDF da t de Student com ν graus de liberdade. */
export function tCdf(t: number, nu: number): number {
  const x = nu / (nu + t * t);
  const p = 0.5 * betainc(x, nu / 2, 0.5);
  return t >= 0 ? 1 - p : p;
}

/** Gama incompleta inferior regularizada P(a, x). */
export function gammainc(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = lgamma(a);
  if (x < a + 1) {
    let ap = a, del = 1 / a, s = del;
    for (let n = 0; n < 500; n++) {
      ap += 1; del *= x / ap; s += del;
      if (Math.abs(del) < Math.abs(s) * 1e-15) break;
    }
    return s * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

export const chi2Cdf = (x: number, k: number): number => gammainc(k / 2, x / 2);

// ---------------------------------------------------------------------------
// RNG determinístico (reprodutibilidade de Monte Carlo)
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Mulberry32 — PRNG de 32 bits, rápido e com boa distribuição para MC. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function round(x: number, digits = 2): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
