
/**
 * Predição conformal — intervalos livres de distribuição com cobertura garantida
 * sob permutabilidade (Vovk, Gammerman & Shafer, 2005; Lei et al., 2018, JASA).
 *
 * Para séries temporais (não permutáveis) usamos Adaptive Conformal Inference
 * (Gibbs & Candès, 2021, NeurIPS, "Adaptive Conformal Inference Under
 * Distribution Shift"), que ajusta α_t online:  α_{t+1} = α_t + γ(α − err_t).
 */

/**
 * Quantil conformal: a k-ésima estatística de ordem, k = ⌈(n+1)(1−α)⌉ (correção de
 * amostra finita). Se k > n, a garantia exige intervalo infinito.
 */
export function conformalQuantile(scores: number[], alpha: number): number {
  const n = scores.length;
  if (!n) return NaN;
  const k = Math.ceil((n + 1) * (1 - alpha));
  if (k > n) return Infinity;
  const sorted = scores.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, k - 1)];
}

export interface AciResult {
  alphaFinal: number;
  halfWidth: number;
  empiricalCoverage: number;
  alphaPath: number[];
  evaluated: number;
  violations: number;
}

/**
 * Executa ACI sobre uma sequência de resíduos fora da amostra (ordem temporal).
 * Escores = |resíduo|, janela deslizante de calibração de tamanho `window`.
 * `block` = passos previstos de uma vez (24 no day-ahead): o quantil e α_t ficam fixos
 * dentro do bloco e só usam escores de blocos anteriores — no momento da previsão as
 * horas do próprio dia ainda não foram observadas.
 */
export function adaptiveConformal(residuals: number[], alpha = 0.1, gamma = 0.01, window = 168, block = 1): AciResult {
  const scores = residuals.map(Math.abs);
  let a = alpha;
  let covered = 0;
  let evaluated = 0;
  const path: number[] = [];
  const warm = block * Math.max(1, Math.round(Math.min(24, Math.floor(scores.length / 3)) / block));
  for (let t0 = warm; t0 < scores.length; t0 += block) {
    const cal = scores.slice(Math.max(0, t0 - window), t0);
    const q = a <= 0 ? Infinity : a >= 1 ? 0 : conformalQuantile(cal, a);
    for (let t = t0; t < Math.min(scores.length, t0 + block); t++) {
      const err = scores[t] > q ? 1 : 0;
      covered += 1 - err;
      evaluated++;
      a += gamma * (alpha - err);
      path.push(a);
    }
  }
  const cal = scores.slice(-window);
  const q = a <= 0 ? Infinity : conformalQuantile(cal, Math.min(0.999, a));
  const halfWidth = Number.isFinite(q) ? q : Math.max(...cal);
  return { alphaFinal: a, halfWidth, empiricalCoverage: evaluated ? covered / evaluated : NaN, alphaPath: path, evaluated, violations: evaluated - covered };
}
