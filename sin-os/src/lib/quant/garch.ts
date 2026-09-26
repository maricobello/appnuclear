import { nelderMead } from "./optimize";
import { mean, variance } from "./stats";

/**
 * GARCH(1,1) — Bollerslev (1986), J. Econometrics 31(3):307–327.
 *   σ²_t = ω + α ε²_{t−1} + β σ²_{t−1}
 * Estimado por máxima verossimilhança gaussiana (Nelder–Mead) com
 * reparametrização que garante ω>0, α,β≥0, α+β<1 (estacionariedade).
 */
export interface GarchResult {
  omega: number;
  alpha: number;
  beta: number;
  persistence: number;
  longRunVol: number;
  halfLife: number;
  condVol: number[];
  forecastVol: number[];
  logLik: number;
  mu: number;
}

function unpack(p: number[]) {
  const omega = Math.exp(p[0]);
  const e1 = Math.exp(p[1]);
  const e2 = Math.exp(p[2]);
  const z = 1 + e1 + e2;
  return { omega, alpha: e1 / z, beta: e2 / z };
}

function negLL(p: number[], e: number[], v0: number): number {
  const { omega, alpha, beta } = unpack(p);
  let s2 = v0;
  let ll = 0;
  for (let t = 0; t < e.length; t++) {
    if (t > 0) s2 = omega + alpha * e[t - 1] ** 2 + beta * s2;
    if (!(s2 > 0)) return 1e12;
    ll += Math.log(s2) + (e[t] * e[t]) / s2;
  }
  return 0.5 * (ll + e.length * Math.log(2 * Math.PI));
}

export function fitGarch(returns: number[], horizon = 24): GarchResult {
  const mu = mean(returns);
  const e = returns.map((r) => r - mu);
  const v0 = variance(e) || 1e-8;
  // chute inicial: α=0.08, β=0.85
  const a0 = 0.08, b0 = 0.85;
  const x0 = [Math.log(v0 * (1 - a0 - b0)), Math.log(a0 / (1 - a0 - b0)), Math.log(b0 / (1 - a0 - b0))];
  const { x, fx } = nelderMead((p) => negLL(p, e, v0), x0, { maxIter: 3000, tol: 1e-10, step: 0.5 });
  const { omega, alpha, beta } = unpack(x);
  const cond: number[] = [];
  let s2 = v0;
  for (let t = 0; t < e.length; t++) {
    if (t > 0) s2 = omega + alpha * e[t - 1] ** 2 + beta * s2;
    cond.push(Math.sqrt(s2));
  }
  const persistence = alpha + beta;
  const V = omega / Math.max(1e-12, 1 - persistence);
  let next = omega + alpha * e[e.length - 1] ** 2 + beta * s2;
  const fc: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    fc.push(Math.sqrt(next));
    next = V + persistence * (next - V);
  }
  return {
    omega,
    alpha,
    beta,
    persistence,
    longRunVol: Math.sqrt(V),
    halfLife: persistence > 0 && persistence < 1 ? Math.log(0.5) / Math.log(persistence) : Infinity,
    condVol: cond,
    forecastVol: fc,
    logLik: -fx,
    mu,
  };
}
