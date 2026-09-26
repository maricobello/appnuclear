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

/**
 * Viés de Nickell (1981, Econometrica 49(6)) do estimador "within" do AR(1) em painel com
 * T períodos: plim(b̂_FE − b). Negativo e da ordem de −(1+b)/(T−1).
 */
export function nickellBias(b: number, T: number): number {
  const bb = Math.abs(1 - b) < 1e-9 ? 1 - 1e-9 : b;
  const A = 1 - (1 - bb ** T) / (T * (1 - bb));
  const num = -((1 + bb) / (T - 1)) * A;
  const den = 1 - ((2 * bb) / ((1 - bb) * (T - 1))) * A;
  return num / den;
}

/** Inverte b̂_FE = b + viés(b, T) por bisseção em b ∈ [1e-4, 0.9999]. */
export function correctNickell(bFE: number, T: number): number {
  const f = (b: number) => b + nickellBias(b, T);
  let lo = 1e-4, hi = 0.9999;
  if (bFE <= f(lo)) return lo;
  if (bFE >= f(hi)) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < bFE) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface TwoFactorParams extends MrjdParams {
  /** Variância estacionária do fator de nível diário m_d (espaço do resíduo). */
  dayVar: number;
  /** Autocorrelação do nível diário entre dias consecutivos (AR(1)). */
  dayPhi: number;
  /** b̂ within antes da correção de Nickell (diagnóstico). */
  bWithin: number;
}

/**
 * Resíduos de previsão day-ahead = NÍVEL DO DIA + dinâmica intradiária:
 *
 *   r_{d,h} = m_d + u_{d,h},   m_d = φ m_{d−1} + η_d,   u = OU com saltos dentro do dia
 *
 * O AR(1) agrupado sobre transições intradiárias confundia os dois fatores (o nível do dia
 * parece "persistência" horária) e o filtro de saltos em Δx truncava a variável dependente:
 * κ saía ~4× menor que o real e o Monte Carlo ficava sub-disperso na MÉDIA DIÁRIA
 * (auditoria set/2026). Calibração:
 *   1) m_d = média do dia; s = r − m_d;
 *   2) AR(1) within em s, saltos detectados no RESÍDUO e_t = s_{t+1} − b·s_t (iterativo, 3σ);
 *   3) b corrigido pelo viés de Nickell para T horas por dia;
 *   4) Var(m) descontada da parte que o próprio u deixa na média do dia:
 *      dayVar = max(0, Var(m̄) − v_u/T·[1 + 2Σ_{k<T}(1−k/T) b^k]);  φ = ACF₁(m̄).
 */
export function calibrateTwoFactor(segments: number[][], dt = 1, threshold = 3): TwoFactorParams {
  const segs = segments.filter((s) => s.length >= 4);
  const T = Math.round(mean(segs.map((s) => s.length)));
  const m = segs.map((s) => mean(s));
  const from: number[] = [];
  const to: number[] = [];
  segs.forEach((seg, d) => {
    for (let i = 0; i < seg.length - 1; i++) { from.push(seg[i] - m[d]); to.push(seg[i + 1] - m[d]); }
  });
  const slope = (idx: number[]) => {
    const X = idx.map((i) => [1, from[i]]);
    const Y = idx.map((i) => to[i]);
    return ols(X, Y).beta[1];
  };
  const all = from.map((_, i) => i);
  let isJump = new Array<boolean>(from.length).fill(false);
  let b = slope(all);
  for (let iter = 0; iter < 10; iter++) {
    const e = to.map((v, i) => v - b * from[i]);
    const clean = e.filter((_, i) => !isJump[i]);
    const mu = mean(clean);
    const sd = std(clean);
    const next = e.map((v) => Math.abs(v - mu) > threshold * sd);
    const changed = next.some((v, i) => v !== isJump[i]);
    isJump = next;
    b = slope(all.filter((i) => !isJump[i]));
    if (!changed) break;
  }
  const bWithin = b;
  const bc = correctNickell(bWithin, T);
  const kappa = -Math.log(bc) / dt;
  const eAll = to.map((v, i) => v - bc * from[i]);
  const eClean = eAll.filter((_, i) => !isJump[i]);
  // o "demeaning" dentro do dia reduz a variância do resíduo em ~1/T
  const se = std(eClean) * Math.sqrt(T / Math.max(1, T - 1));
  const sigma = se * Math.sqrt((2 * kappa) / (1 - bc * bc));
  const jumps = eAll.filter((_, i) => isJump[i]);
  const lambda = jumps.length / (from.length * dt);
  const jumpMean = jumps.length ? mean(jumps) : 0;
  const jumpSd = jumps.length > 1 ? std(jumps) : 0;
  // variância estacionária de u (difusão + saltos que decaem com b)
  const vU = (se * se + lambda * dt * (jumpMean ** 2 + jumpSd ** 2)) / (1 - bc * bc);
  let acf = 1;
  for (let k = 1; k < T; k++) acf += 2 * (1 - k / T) * bc ** k;
  const varM = m.length > 1 ? std(m) ** 2 : 0;
  const dayVar = Math.max(0, varM - (vU / T) * acf);
  let dayPhi = 0;
  if (m.length >= 5) {
    const mm = mean(m);
    let num = 0, den = 0;
    for (let d = 0; d < m.length; d++) {
      den += (m[d] - mm) ** 2;
      if (d > 0) num += (m[d] - mm) * (m[d - 1] - mm);
    }
    dayPhi = den > 0 ? Math.min(0.95, Math.max(0, num / den)) : 0;
  }
  return {
    kappa,
    mu: 0,
    sigma,
    lambda,
    jumpMean,
    jumpSd,
    halfLife: Math.log(2) / kappa,
    nJumps: jumps.length,
    dayVar,
    dayPhi,
    bWithin,
  };
}

/**
 * Simula o modelo de dois fatores: nível diário AR(1) (partindo da distribuição
 * estacionária) + OU com saltos intradiário (aquecido `burn` passos). O dia muda a cada
 * `stepsPerDay` passos a partir do passo 0. Retorna matriz paths×steps (média zero).
 */
export function simulateTwoFactor(p: TwoFactorParams, steps: number, paths: number, rng: Rng, stepsPerDay = 24, burn = 72, dt = 1): number[][] {
  const a = Math.exp(-p.kappa * dt);
  const sd = p.sigma * Math.sqrt((1 - a * a) / (2 * p.kappa));
  const pj = Math.min(0.5, p.lambda * dt);
  const daySd = Math.sqrt(Math.max(0, p.dayVar));
  const innov = daySd * Math.sqrt(Math.max(0, 1 - p.dayPhi ** 2));
  const out: number[][] = [];
  for (let k = 0; k < paths; k++) {
    let u = 0;
    for (let t = 0; t < burn; t++) {
      u = u * a + sd * randn(rng);
      if (pj > 0 && rng() < pj) u += p.jumpMean + p.jumpSd * randn(rng);
    }
    let lvl = daySd * randn(rng);
    const path = new Array<number>(steps);
    for (let t = 0; t < steps; t++) {
      if (t > 0 && t % stepsPerDay === 0) lvl = p.dayPhi * lvl + innov * randn(rng);
      u = u * a + sd * randn(rng);
      if (pj > 0 && rng() < pj) u += p.jumpMean + p.jumpSd * randn(rng);
      path[t] = lvl + u;
    }
    out.push(path);
  }
  return out;
}
