import type { Matrix } from "./linalg";
import type { LassoFit } from "./lasso";

/**
 * LARS com modificação LASSO (Efron, Hastie, Johnstone & Tibshirani, 2004,
 * Annals of Statistics 32(2):407–499; ESL Alg. 3.2a). Calcula o caminho LASSO
 * EXATO (linear por partes) em ~min(n, p) passos — é o algoritmo do
 * `LassoLarsIC` (scikit-learn) usado pelo LEAR no epftoolbox.
 * Seleção do nó do caminho por AICc/AIC/BIC com df = |conjunto ativo|.
 */
function cholSolve(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const L = A.map(() => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let m = 0; m < j; m++) s -= L[i][m] * L[j][m];
      if (i === j) {
        if (s <= 1e-12) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const z = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    let s = b[i];
    for (let m = 0; m < i; m++) s -= L[i][m] * z[m];
    z[i] = s / L[i][i];
  }
  const x = new Array<number>(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = z[i];
    for (let m = i + 1; m < k; m++) s -= L[m][i] * x[m];
    x[i] = s / L[i][i];
  }
  return x;
}

export function lassoLarsIC(X: Matrix, y: ArrayLike<number>, criterion: "aic" | "aicc" | "bic" = "aicc"): LassoFit {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const mu = new Float64Array(p);
  const nrm = new Float64Array(p);
  const Z: Float64Array[] = [];
  const valid: number[] = [];
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    const m = s / n;
    let ss = 0;
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) { col[i] = X[i][j] - m; ss += col[i] * col[i]; }
    const norm = Math.sqrt(ss);
    mu[j] = m;
    nrm[j] = norm;
    if (norm > 1e-10) { for (let i = 0; i < n; i++) col[i] /= norm; valid.push(j); }
    Z.push(col);
  }
  let ySum = 0;
  for (let i = 0; i < n; i++) ySum += y[i];
  const yMean = ySum / n;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = y[i] - yMean;

  // Gram das colunas válidas (sob demanda com cache)
  const G = new Map<number, Float64Array>();
  const gramRow = (j: number) => {
    let row = G.get(j);
    if (!row) {
      row = new Float64Array(p);
      const zj = Z[j];
      for (const k of valid) {
        const zk = Z[k];
        let s = 0;
        for (let i = 0; i < n; i++) s += zj[i] * zk[i];
        row[k] = s;
      }
      G.set(j, row);
    }
    return row;
  };

  const c = new Float64Array(p);
  for (const j of valid) {
    let s = 0;
    const zj = Z[j];
    for (let i = 0; i < n; i++) s += zj[i] * r[i];
    c[j] = s;
  }
  const beta = new Float64Array(p);
  const active: number[] = [];
  const inA = new Uint8Array(p);
  const maxK = Math.min(n - 1, valid.length);
  const K = criterion === "bic" ? Math.log(n) : 2;

  let rss0 = 0;
  for (let i = 0; i < n; i++) rss0 += r[i] * r[i];
  const crit = (rss: number, df: number) => {
    if (df >= n - 2) return Infinity;
    const base = n * Math.log(Math.max(rss, 1e-300) / n) + K * df;
    return criterion === "aicc" ? base + (2 * df * (df + 1)) / (n - df - 1) : base;
  };
  let best = { crit: crit(rss0, 0), beta: beta.slice(), df: 0, rss: rss0, lambda: 0 };
  let justDropped = false;
  let sinceBest = 0;
  // o critério só é finito para df < n − 2; além disso, AICc/BIC crescem monotonicamente
  // na prática — parar após 12 nós sem melhora evita percorrer o caminho até a saturação
  const PATIENCE = 12;

  for (let step = 0; step < 8 * maxK + 10; step++) {
    let C = 0;
    for (const j of valid) C = Math.max(C, Math.abs(c[j]));
    if (C < 1e-12) break;
    if (!justDropped) {
      if (active.length >= maxK) break;
      let jBest = -1, cBest = -1;
      for (const j of valid) if (!inA[j] && Math.abs(c[j]) > cBest) { cBest = Math.abs(c[j]); jBest = j; }
      if (jBest < 0) break;
      active.push(jBest);
      inA[jBest] = 1;
    }
    justDropped = false;
    const k = active.length;
    const s = active.map((j) => (c[j] >= 0 ? 1 : -1));
    const GA = active.map((j) => { const row = gramRow(j); return active.map((l) => row[l]); });
    let w = cholSolve(GA, s);
    if (!w) {
      for (let i = 0; i < k; i++) GA[i][i] += 1e-10;
      w = cholSolve(GA, s);
      if (!w) break;
    }
    let sw = 0;
    for (let i = 0; i < k; i++) sw += s[i] * w[i];
    const AA = 1 / Math.sqrt(sw);
    const d = w.map((v) => v * AA);
    // a_j = z_j'u, u = Σ d_i z_{A_i}
    const a = new Float64Array(p);
    active.forEach((ai, i) => {
      const row = gramRow(ai);
      for (const j of valid) a[j] += row[j] * d[i];
    });
    let gamma = C / AA;
    if (k < maxK) {
      for (const j of valid) {
        if (inA[j]) continue;
        const g1 = (C - c[j]) / (AA - a[j]);
        const g2 = (C + c[j]) / (AA + a[j]);
        if (g1 > 1e-12 && g1 < gamma) gamma = g1;
        if (g2 > 1e-12 && g2 < gamma) gamma = g2;
      }
    }
    let drop = -1;
    active.forEach((j, i) => {
      const gj = -beta[j] / d[i];
      if (gj > 1e-12 && gj < gamma) { gamma = gj; drop = i; }
    });
    active.forEach((j, i) => { beta[j] += gamma * d[i]; });
    for (const j of valid) c[j] -= gamma * a[j];
    // resíduo: r -= γ·u
    for (let i = 0; i < n; i++) {
      let u = 0;
      for (let q = 0; q < k; q++) u += d[q] * Z[active[q]][i];
      r[i] -= gamma * u;
    }
    if (drop >= 0) {
      const j = active[drop];
      beta[j] = 0;
      inA[j] = 0;
      active.splice(drop, 1);
      justDropped = true;
    }
    let rss = 0;
    for (let i = 0; i < n; i++) rss += r[i] * r[i];
    const cr = crit(rss, active.length);
    if (cr < best.crit) {
      best = { crit: cr, beta: beta.slice(), df: active.length, rss, lambda: (C - gamma * AA) / n };
      sinceBest = 0;
    } else if (++sinceBest >= PATIENCE || active.length >= n - 2) break;
    if (!justDropped && k >= maxK) break;
  }

  const coef = new Array<number>(p).fill(0);
  let intercept = yMean;
  for (const j of valid) {
    if (best.beta[j] !== 0) {
      coef[j] = best.beta[j] / nrm[j];
      intercept -= coef[j] * mu[j];
    }
  }
  return { coef, intercept, lambda: best.lambda, df: best.df, rss: best.rss, criterion: best.crit };
}
