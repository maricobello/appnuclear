/**
 * Métricas de fluxo de caixa: VPL, TIR, payback e percentis.
 *
 * Convenção: `cashFlows[t]` ocorre no fim do ano t (t = 0 é a data do investimento).
 * Taxas recebidas e devolvidas em % a.a. (pontos percentuais).
 *
 * Referências: Brealey, R. A., Myers, S. C. & Allen, F. — Principles of Corporate Finance (VPL/TIR,
 * múltiplas TIRs com mais de uma troca de sinal); Hyndman, R. J. & Fan, Y. (1996), "Sample quantiles in
 * statistical packages", The American Statistician 50(4):361–365 (percentil tipo 7).
 */

/** VPL em fração (r = 0,1 para 10 %), avaliado por Horner em v = 1/(1+r) */
function npvFrac(r: number, cf: ArrayLike<number>): number {
  const v = 1 / (1 + r);
  let acc = 0;
  for (let t = cf.length - 1; t >= 0; t--) acc = acc * v + cf[t];
  return acc;
}

/** dVPL/dr = −Σ t·cf_t·v^(t+1) */
function npvDerivFrac(r: number, cf: ArrayLike<number>): number {
  const v = 1 / (1 + r);
  let acc = 0;
  for (let t = cf.length - 1; t >= 1; t--) acc = acc * v + t * cf[t];
  // acc = Σ t cf_t v^(t−1); derivada = −v² · acc
  return -v * v * acc;
}

/** Valor presente líquido a `ratePct` % a.a.; cashFlows[0] em t = 0 */
export function npv(ratePct: number, cashFlows: number[]): number {
  return npvFrac(ratePct / 100, cashFlows);
}

/** Grade de taxas (fração) usada para isolar as raízes do VPL */
const IRR_GRID = [
  -0.99, -0.95, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.15, -0.1, -0.05, 0, 0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5,
  0.75, 1, 1.5, 2, 3, 5, 10,
];

/** Bisseção com passo de Newton salvaguardado dentro do intervalo [lo, hi] com troca de sinal */
function solveInBracket(cf: ArrayLike<number>, lo: number, hi: number, flo: number): number {
  let a = lo;
  let b = hi;
  let fa = flo;
  let x = (a + b) / 2;
  for (let i = 0; i < 200; i++) {
    const fx = npvFrac(x, cf);
    if (fx === 0) return x;
    if (Math.sign(fx) === Math.sign(fa)) {
      a = x;
      fa = fx;
    } else {
      b = x;
    }
    if (Math.abs(b - a) < 1e-13) break;
    // polimento de Newton: aceito só se cair dentro do intervalo atual
    const d = npvDerivFrac(x, cf);
    let next = d !== 0 ? x - fx / d : NaN;
    if (!(next > Math.min(a, b) && next < Math.max(a, b))) next = (a + b) / 2;
    if (Math.abs(next - x) < 1e-15) return next;
    x = next;
  }
  return (a + b) / 2;
}

/**
 * Taxa interna de retorno, % a.a.; `null` se os fluxos não trocam de sinal ou se não há raiz em
 * (−99 %, 1000 %).
 *
 * Robustez: o VPL é avaliado numa grade de taxas para isolar TODAS as raízes; resolve-se cada
 * intervalo por bisseção com polimento de Newton. Com mais de uma troca de sinal nos fluxos (ex.:
 * reposição de inversores maior que o caixa do ano) pode haver várias TIRs: escolhe-se a raiz em que
 * o VPL é DECRESCENTE (perfil de investimento: +VPL abaixo da taxa, −VPL acima) mais próxima de 10 %;
 * na falta dela, a raiz mais próxima de 10 %.
 */
export function irr(cashFlows: number[]): number | null {
  let pos = false;
  let neg = false;
  for (const c of cashFlows) {
    if (c > 0) pos = true;
    else if (c < 0) neg = true;
  }
  if (!pos || !neg) return null;

  const roots: { r: number; decreasing: boolean }[] = [];
  let prevR = IRR_GRID[0];
  let prevF = npvFrac(prevR, cashFlows);
  if (prevF === 0) roots.push({ r: prevR, decreasing: npvDerivFrac(prevR, cashFlows) < 0 });
  for (let i = 1; i < IRR_GRID.length; i++) {
    const r = IRR_GRID[i];
    const f = npvFrac(r, cashFlows);
    if (f === 0) {
      roots.push({ r, decreasing: npvDerivFrac(r, cashFlows) < 0 });
    } else if (prevF !== 0 && Math.sign(f) !== Math.sign(prevF)) {
      roots.push({ r: solveInBracket(cashFlows, prevR, r, prevF), decreasing: prevF > 0 });
    }
    prevR = r;
    prevF = f;
  }
  if (roots.length === 0) return null;
  const pool = roots.some((x) => x.decreasing) ? roots.filter((x) => x.decreasing) : roots;
  pool.sort((p, q) => Math.abs(p.r - 0.1) - Math.abs(q.r - 0.1));
  return pool[0].r * 100;
}

/**
 * Payback com interpolação linear dentro do ano: instante a partir do qual o acumulado fica
 * definitivamente ≥ 0 (considera o último cruzamento, caso uma reposição torne o acumulado negativo
 * de novo). `null` se não se paga no horizonte. `cashFlows[0]` é o investimento (negativo).
 */
export function paybackYears(cashFlows: number[]): number | null {
  const cum: number[] = [];
  let acc = 0;
  for (const c of cashFlows) {
    acc += c;
    cum.push(acc);
  }
  let lastNeg = -1;
  for (let t = 0; t < cum.length; t++) if (cum[t] < 0) lastNeg = t;
  if (lastNeg === -1) return 0;
  if (lastNeg === cum.length - 1) return null;
  const k = lastNeg + 1;
  return lastNeg + -cum[lastNeg] / cashFlows[k];
}

/** Fluxos descontados a `ratePct` (para o payback descontado) */
export function discountFlows(ratePct: number, cashFlows: number[]): number[] {
  const r = ratePct / 100;
  return cashFlows.map((c, t) => c / (1 + r) ** t);
}

/** Percentil (0..100) por interpolação linear entre estatísticas de ordem (Hyndman & Fan tipo 7) */
export function percentile(sortedAsc: ArrayLike<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const h = (n - 1) * Math.min(1, Math.max(0, p / 100));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sortedAsc[lo] + (h - lo) * (sortedAsc[hi] - sortedAsc[lo]);
}

/** Taxa nominal → real pela relação de Fisher, % */
export function realRatePct(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
