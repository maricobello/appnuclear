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
 *
 * Variância de longo prazo por Newey–West (kernel de Bartlett, sempre ≥ 0) com
 * L = max(h−1, ⌊1,5·n^{1/3}⌋): a diferença de perda diária do PLD tem ACF(1) ≈ 0,2–0,3,
 * e ignorar isso inflava a estatística (ex.: t 3,45 → 2,83 no SE). `hacLag = 0` ⇒ iid.
 */
export function dieboldMariano(lossA: number[], lossB: number[], h = 1, hacLag?: number): DmResult {
  const d = lossA.map((a, i) => a - lossB[i]);
  const n = d.length;
  const m = mean(d);
  const gamma = (k: number) => {
    let s = 0;
    for (let t = k; t < n; t++) s += (d[t] - m) * (d[t - k] - m);
    return s / n;
  };
  const L = Math.min(n - 1, Math.max(h - 1, hacLag ?? Math.floor(1.5 * Math.cbrt(n))));
  let lrv = gamma(0);
  for (let k = 1; k <= L; k++) lrv += 2 * (1 - k / (L + 1)) * gamma(k);
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

/**
 * Kupiec com efeito de desenho por blocos (dias). No day-ahead as 24 horas saem juntas e
 * as violações se agrupam no mesmo dia (ICC ≈ 0,2–0,3 ⇒ deff ≈ 6–8): o LR horário puro
 * rejeitava cobertura correta. deff = s²_V / (B·p̂(1−p̂)), V_d = violações do bloco d;
 * LR* = LR_uc / deff ~ χ²₁.
 */
export function kupiecBlocks(hits: number[], block: number, expectedRate: number): { lr: number; pValue: number; observedRate: number; deff: number } {
  const D = Math.floor(hits.length / block);
  const n = D * block;
  const x = hits.slice(0, n).reduce((s, v) => s + v, 0);
  const base = kupiec(x, Math.max(1, n), expectedRate);
  const ph = n ? x / n : 0;
  let deff = 1;
  if (D > 1 && ph > 0 && ph < 1) {
    let ss = 0;
    for (let d = 0; d < D; d++) {
      let v = 0;
      for (let t = d * block; t < (d + 1) * block; t++) v += hits[t];
      ss += (v - block * ph) ** 2;
    }
    deff = Math.max(1, ss / (D - 1) / (block * ph * (1 - ph)));
  }
  const lr = base.lr / deff;
  return { lr, pValue: 1 - chi2Cdf(Math.max(0, lr), 1), observedRate: base.observedRate, deff };
}

/**
 * Independência de Christoffersen (1998) com defasagem L: transições I_{t−L} → I_t.
 * Com L = 24 compara a mesma hora em dias consecutivos (violação ontem ⇒ violação hoje?).
 * Retorna LR_ind ~ χ²₁ e π01/π11 (probabilidade de violação sem/com violação L passos antes).
 * `deff` (efeito de desenho do Kupiec por blocos) corrige o tamanho do teste.
 */
export function christoffersen(hits: number[], lag = 1, deff = 1): { lr: number; pValue: number; pi01: number; pi11: number } {
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (let t = lag; t < hits.length; t++) {
    const a = hits[t - lag], b = hits[t];
    if (a === 0 && b === 0) n00++;
    else if (a === 0) n01++;
    else if (b === 0) n10++;
    else n11++;
  }
  const xlogy = (x: number, y: number) => (x > 0 ? x * Math.log(y) : 0);
  const pi01 = n00 + n01 ? n01 / (n00 + n01) : 0;
  const pi11 = n10 + n11 ? n11 / (n10 + n11) : 0;
  const pi = (n01 + n11) / Math.max(1, n00 + n01 + n10 + n11);
  const l0 = xlogy(n00 + n10, 1 - pi) + xlogy(n01 + n11, pi);
  const l1 = xlogy(n00, 1 - pi01) + xlogy(n01, pi01) + xlogy(n10, 1 - pi11) + xlogy(n11, pi11);
  // com violações agrupadas no dia (deff > 1) o LR sob H0 fica inflado: divide pelo efeito
  // de desenho (correção de Rao–Scott), como no Kupiec por blocos
  const lr = Math.max(0, -2 * (l0 - l1)) / Math.max(1, deff);
  return { lr, pValue: 1 - chi2Cdf(lr, 1), pi01, pi11 };
}
