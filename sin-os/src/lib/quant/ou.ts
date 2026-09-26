import { ols } from "./linalg";
import { mean, randn, std, type Rng } from "./stats";

/**
 * Difusão com reversão à média e saltos (MRJD) para preços de eletricidade.
 * Schwartz (1997), J. Finance 52(3); Cartea & Figueroa (2005), Applied Math.
 * Finance 12(4):313–335, "Pricing in Electricity Markets: a mean reverting
 * jump diffusion model with seasonality".
 *
 *   dX_t = κ(μ − X_t)dt + σ dW_t + J dN_t,   N ~ Poisson(λ), J ~ N(μ_J, σ_J²)
 *
 * Calibração: filtro iterativo de saltos (|ΔX| > 3σ) + regressão AR(1) exata do OU.
 */
export interface SeasonalFit {
  beta: number[];
  period: number[];
  harmonics: number[];
  predict: (t: number) => number;
}

/** Sazonalidade por regressão de Fourier (diária e semanal em base horária). */
export function fitSeasonality(y: number[], periods = [24, 168], harmonics = [3, 2]): SeasonalFit {
  const row = (t: number) => {
    const r = [1, t / y.length];
    periods.forEach((P, pi) => {
      for (let k = 1; k <= harmonics[pi]; k++) {
        r.push(Math.sin((2 * Math.PI * k * t) / P), Math.cos((2 * Math.PI * k * t) / P));
      }
    });
    return r;
  };
  const X = y.map((_, t) => row(t));
  const { beta } = ols(X, y, 1e-8);
  return {
    beta,
    period: periods,
    harmonics,
    predict: (t: number) => row(t).reduce((s, v, j) => s + v * beta[j], 0),
  };
}

export interface MrjdParams {
  kappa: number; // velocidade de reversão (por passo)
  mu: number;
  sigma: number;
  lambda: number; // intensidade de saltos por passo
  jumpMean: number;
  jumpSd: number;
  halfLife: number; // em passos
  nJumps: number;
}

/** Núcleo: calibra o MRJD a partir de transições (from→to) já pareadas. */
function calibrateFromPairs(from: number[], to: number[], dt: number, threshold: number): MrjdParams {
  const dx = to.map((v, i) => v - from[i]);
  let isJump = new Array<boolean>(dx.length).fill(false);
  for (let iter = 0; iter < 10; iter++) {
    const clean = dx.filter((_, i) => !isJump[i]);
    const m = mean(clean);
    const s = std(clean);
    const next = dx.map((d) => Math.abs(d - m) > threshold * s);
    if (next.every((v, i) => v === isJump[i])) break;
    isJump = next;
  }
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = 0; t < dx.length; t++) {
    if (isJump[t]) continue;
    X.push([1, from[t]]);
    Y.push(to[t]);
  }
  const { beta, resid } = ols(X, Y);
  const b = Math.min(0.9999, Math.max(1e-4, beta[1]));
  const kappa = -Math.log(b) / dt;
  const mu = beta[0] / (1 - b);
  const se = std(resid);
  const sigma = se * Math.sqrt((2 * kappa) / (1 - b * b));
  const jumps = dx.filter((_, i) => isJump[i]);
  return {
    kappa,
    mu,
    sigma,
    lambda: jumps.length / (dx.length * dt),
    jumpMean: jumps.length ? mean(jumps) : 0,
    jumpSd: jumps.length > 1 ? std(jumps) : 0,
    halfLife: Math.log(2) / kappa,
    nJumps: jumps.length,
  };
}

export function calibrateMRJD(x: number[], dt = 1, threshold = 3): MrjdParams {
  return calibrateFromPairs(x.slice(0, -1), x.slice(1), dt, threshold);
}

/**
 * Como calibrateMRJD, mas em segmentos (ex.: dias): usa só transições DENTRO de cada
 * segmento, ignorando o salto artificial entre o fim de um segmento e o início do outro
 * (a fronteira 23h→0h contaminava κ/σ/λ com um "salto" espúrio).
 */
export function calibrateMRJDSegments(segments: number[][], dt = 1, threshold = 3): MrjdParams {
  const from: number[] = [];
  const to: number[] = [];
  for (const seg of segments) for (let i = 0; i < seg.length - 1; i++) { from.push(seg[i]); to.push(seg[i + 1]); }
  return calibrateFromPairs(from, to, dt, threshold);
}

/**
 * Simula desvios MRJD (média μ=0 em torno de uma curva forward/previsão) usando a
 * discretização exata do OU + saltos de Bernoulli(λdt). Retorna matriz paths×steps.
 */
export function simulateMRJD(p: MrjdParams, x0: number, steps: number, paths: number, rng: Rng, dt = 1): number[][] {
  const a = Math.exp(-p.kappa * dt);
  const sd = p.sigma * Math.sqrt((1 - a * a) / (2 * p.kappa));
  const pj = Math.min(0.5, p.lambda * dt);
  const out: number[][] = [];
  for (let m = 0; m < paths; m++) {
    const path = new Array<number>(steps);
    let x = x0;
    for (let t = 0; t < steps; t++) {
      x = p.mu + (x - p.mu) * a + sd * randn(rng);
      if (pj > 0 && rng() < pj) x += p.jumpMean + p.jumpSd * randn(rng);
      path[t] = x;
    }
    out.push(path);
  }
  return out;
}
