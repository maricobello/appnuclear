/**
 * Nelder–Mead (1965) com os coeficientes padrão (α=1, γ=2, ρ=0.5, σ=0.5).
 * Usado para MLE do GARCH e calibrações sem gradiente analítico.
 */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): { x: number[]; fx: number; iterations: number } {
  const { maxIter = 2000, tol = 1e-10, step = 0.1 } = opts;
  const n = x0.length;
  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const v = x0.slice();
    v[i] = v[i] !== 0 ? v[i] * (1 + step) : step;
    simplex.push(v);
  }
  let values = simplex.map(f);
  let it = 0;
  for (; it < maxIter; it++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplex = order.map(([, i]) => simplex[i]);
    values = order.map(([v]) => v);
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + tol)) break;

    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const worst = simplex[n];
    const xr = centroid.map((c, j) => c + (c - worst[j]));
    const fr = f(xr);
    if (fr < values[0]) {
      const xe = centroid.map((c, j) => c + 2 * (xr[j] - c));
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr; values[n] = fr;
    } else {
      const outside = fr < values[n];
      const xc = outside
        ? centroid.map((c, j) => c + 0.5 * (xr[j] - c))
        : centroid.map((c, j) => c + 0.5 * (worst[j] - c));
      const fc = f(xc);
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc; values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i <= n; i++) if (values[i] < values[best]) best = i;
  return { x: simplex[best], fx: values[best], iterations: it };
}
