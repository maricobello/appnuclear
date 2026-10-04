/**
 * Gerador pseudoaleatório determinístico para o Monte Carlo (mesma semente → mesmos resultados,
 * condição para o hash da análise ser reprodutível).
 *
 *  - mulberry32: gerador de 32 bits de Tommy Ettinger (domínio público), período 2³², rápido e com
 *    boa qualidade estatística para simulação (não criptográfico).
 *  - Normal: transformação de Box & Muller (1958), Ann. Math. Statist. 29(2):610–611, guardando o
 *    segundo valor do par.
 */

export interface Rng {
  /** uniforme em [0, 1) */
  uniform(): number;
  uniformRange(lo: number, hi: number): number;
  /** normal N(mean, sd) */
  normal(mean?: number, sd?: number): number;
  /** lognormal com parâmetros da normal subjacente (mediana = e^mu) */
  lognormal(mu: number, sigma: number): number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;
  const stdNormal = (): number => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u <= Number.EPSILON) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return {
    uniform: next,
    uniformRange: (lo, hi) => lo + (hi - lo) * next(),
    normal: (mean = 0, sd = 1) => mean + sd * stdNormal(),
    lognormal: (mu, sigma) => Math.exp(mu + sigma * stdNormal()),
  };
}
