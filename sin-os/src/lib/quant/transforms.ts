import { mad, median } from "./stats";

/**
 * Transformação estabilizadora de variância "asinh-median"
 * Uniejewski, Weron & Ziel (2018), IEEE Trans. Power Systems 33(2):2219–2229,
 * "Variance Stabilizing Transformations for Electricity Spot Price Forecasting".
 * Também é o pré-processamento padrão do LEAR/DNN no epftoolbox (Lago et al., 2021).
 *
 *   x = (p − a) / b,  a = mediana, b = MAD / z_{0.75}
 *   y = asinh(x)
 */
export interface AsinhScaler {
  a: number;
  b: number;
}

const Z075 = 0.6744897501960817;

export function fitAsinh(values: ArrayLike<number>): AsinhScaler {
  const a = median(values);
  let b = mad(values) / Z075;
  if (!(b > 1e-9)) {
    // série quase constante (ex.: PLD grudado no piso) — usa desvio de fallback
    const arr = Array.from(values);
    const range = Math.max(...arr) - Math.min(...arr);
    b = range > 0 ? range / 4 : 1;
  }
  return { a, b };
}

export const asinhFwd = (s: AsinhScaler, p: number): number => Math.asinh((p - s.a) / s.b);
export const asinhInv = (s: AsinhScaler, y: number): number => Math.sinh(y) * s.b + s.a;
