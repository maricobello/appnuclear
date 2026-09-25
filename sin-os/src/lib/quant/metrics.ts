import { chi2Cdf, mean, tCdf } from "./stats";

/** Métricas de avaliação de previsão (pontual e probabilística). */

export function mae(y: number[], f: number[]): number {
  return mean(y.map((v, i) => Math.abs(v - f[i])));
}

export function rmse(y: number[], f: number[]): number {
  return Math.sqrt(mean(y.map((v, i) => (v - f[i]) ** 2)));
}

/** sMAPE (%) — versão simétrica recomendada em EPF (Lago et al., 2021). */
export function smape(y: number[], f: number[]): number {
  return (
    100 *
    mean(
      y.map((v, i) => {
        const den = (Math.abs(v) + Math.abs(f[i])) / 2;
        return den === 0 ? 0 : Math.abs(v - f[i]) / den;
      }),
    )
  );
}

/** rMAE: MAE relativo ao ingênuo sazonal (< 1 ⇒ modelo supera o benchmark). */
export function rmae(y: number[], f: number[], naive: number[]): number {
  const d = mae(y, naive);
  return d === 0 ? NaN : mae(y, f) / d;
}

/** Perda pinball (quantílica) para o quantil τ. */
export function pinball(y: number, q: number, tau: number): number {
  const u = y - q;
  return u >= 0 ? tau * u : (tau - 1) * u;
}

/**
 * CRPS a partir de quantis: CRPS = 2∫₀¹ ρ_τ(y − q_τ) dτ (Gneiting & Raftery, 2007,
 * JASA 102(477); Laio & Tamea, 2007). A integral é aproximada pela regra do trapézio
 * sobre a grade de τ (pinball = 0 em τ = 0 e 1) — a média simples de 2·pinball só vale
 * para τ uniformemente espaçados e subestima o CRPS com grades como 5–95%.
 */
export function crpsFromQuantiles(y: number, qs: number[], taus: number[]): number {
  const tt = [0, ...taus, 1];
  const ls = [0, ...taus.map((t, i) => pinball(y, qs[i], t)), 0];
  let s = 0;
  for (let i = 1; i < tt.length; i++) s += 0.5 * (ls[i] + ls[i - 1]) * (tt[i] - tt[i - 1]);
  return 2 * s;
}

export interface DmResult {
  statistic: number;
  pValue: number; // H1: modelo A tem perda esperada MENOR que B
  meanDiff: number;
  n: number;
}

/**
 * Teste de Diebold–Mariano (1995) com correção de pequenas amostras de
 * Harvey, Leybourne & Newbold (1997). Perda |erro| por padrão.
 * Para vetores diários (versão multivariada de Lago et al. 2021), passe a norma-1 por dia.
 */
export function dieboldMariano(lossA: number[], lossB: number[], h = 1): DmResult {
  const d = lossA.map((a, i) => a - lossB[i]);
  const n = d.length;
  const m = mean(d);
  const gamma = (k: number) => {
    let s = 0;
    for (let t = k; t < n; t++) s += (d[t] - m) * (d[t - k] - m);
    return s / n;
  };
  let lrv = gamma(0);
  for (let k = 1; k < h; k++) lrv += 2 * gamma(k);
  const dm = lrv > 0 ? m / Math.sqrt(lrv / n) : 0;
  const hln = Math.sqrt((n + 1 - 2 * h + (h * (h - 1)) / n) / n);
  const stat = dm * hln;
  return { statistic: stat, pValue: tCdf(stat, n - 1), meanDiff: m, n };
}

/** Teste de cobertura incondicional de Kupiec (1995) — POF. */
export function kupiec(violations: number, n: number, expectedRate: number): { lr: number; pValue: number; observedRate: number } {
  const x = violations;
  const p = expectedRate;
  const phat = x / n;
  const ll0 = (n - x) * Math.log(1 - p) + (x > 0 ? x * Math.log(p) : 0);
  const ll1 = (n - x > 0 ? (n - x) * Math.log(1 - phat) : 0) + (x > 0 ? x * Math.log(phat) : 0);
  const lr = -2 * (ll0 - ll1);
  return { lr, pValue: 1 - chi2Cdf(Math.max(0, lr), 1), observedRate: phat };
}
