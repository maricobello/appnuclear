import { quantile } from "./stats";

/**
 * Predição conformal — intervalos livres de distribuição com cobertura garantida
 * sob permutabilidade (Vovk, Gammerman & Shafer, 2005; Lei et al., 2018, JASA).
 *
 * Para séries temporais (não permutáveis) usamos Adaptive Conformal Inference
 * (Gibbs & Candès, 2021, NeurIPS, "Adaptive Conformal Inference Under
 * Distribution Shift"), que ajusta α_t online:  α_{t+1} = α_t + γ(α − err_t).
 */

/** Quantil conformal com correção de amostra finita ⌈(n+1)(1−α)⌉/n. */
export function conformalQuantile(scores: number[], alpha: number): number {
  const n = scores.length;
  if (!n) return NaN;
  const level = Math.min(1, Math.ceil((n + 1) * (1 - alpha)) / n);
  return quantile(scores, level);
}

export interface AciResult {
  alphaFinal: number;
  halfWidth: number;
  empiricalCoverage: number;
  alphaPath: number[];
}

/**
 * Executa ACI sobre uma sequência de resíduos fora da amostra (ordem temporal).
 * Escores = |resíduo|. Usa janela deslizante de calibração de tamanho `window`.
 */
export function adaptiveConformal(residuals: number[], alpha = 0.1, gamma = 0.01, window = 168): AciResult {
  const scores = residuals.map(Math.abs);
  let a = alpha;
  let covered = 0;
  let evaluated = 0;
  const path: number[] = [];
  const warm = Math.min(24, Math.floor(scores.length / 3));
  for (let t = warm; t < scores.length; t++) {
    const cal = scores.slice(Math.max(0, t - window), t);
    const q = a <= 0 ? Infinity : a >= 1 ? 0 : conformalQuantile(cal, a);
    const err = scores[t] > q ? 1 : 0;
    covered += 1 - err;
    evaluated++;
    a = a + gamma * (alpha - err);
    path.push(a);
  }
  const cal = scores.slice(-window);
  const halfWidth = a <= 0 ? Math.max(...cal) : conformalQuantile(cal, Math.min(0.999, a));
  return { alphaFinal: a, halfWidth, empiricalCoverage: evaluated ? covered / evaluated : NaN, alphaPath: path };
}
