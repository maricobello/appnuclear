/**
 * Contratação no mercado livre com a estrutura completa de um contrato bilateral, hora a hora.
 *
 * Contrato: volume anual Q (MWmed) a preço P, com
 *   - sazonalização: volume de cada mês V_m entre (1 − s)·Q e (1 + s)·Q, com Σ H_m·V_m = H·Q
 *     (flat, conforme a carga prevista ou a ótima — decidida antes do ano, igual em todos os cenários);
 *   - flexibilidade mensal: o volume tomado v_m fica entre (1 − f)·V_m e (1 + f)·V_m, pela regra do
 *     contrato — ajustado ao consumo medido do mês (o padrão de mercado) ou escolhido livremente pelo
 *     comprador depois do mês (uma opção: toma o máximo se o contrato saiu mais barato que o PLD);
 *   - modulação: entrega flat nas horas do mês ou na forma da carga prevista;
 *   - submercado do contrato, que pode ser outro que o da carga (o comprador fica com o spread).
 *
 * Custo de um cenário (perdas λ aplicadas à carga medida, choque de carga ε do mês):
 *
 *     C = Σ_m [ v_m·H_m·P + (1 + ε_m)(1 + λ)·Σ_h L_h·PLDcarga_h − v_m·Σ_h w_h·PLDcontrato_h ]
 *
 * com w_h = 1 (flat) ou H_m·L_h/Σ L (modulação pela carga). A soma horária usa o ano todo do contrato
 * hora a hora: cada dia vem de um dia real equivalente do histórico (mesmo tipo de dia e mês), com o
 * desvio do PLD daquele dia em relação à média do mês somado ao nível do cenário, limitado ao piso e
 * ao teto horário e recentrado para a média do mês ser o nível.
 *
 * Cenários: nível mensal lognormal (mediana no P50, cauda no P90 da faixa do planejamento), meses
 * correlacionados pelo ρ implícito nos cenários do SDDP, submercados correlacionados pelo histórico
 * das variações mensais do PLD; carga com choque anual comum e mensal (desvios-padrão informados),
 * opcionalmente correlacionado ao preço do mês (quem consome mais quando a energia está cara).
 *
 * Volume e sazonalização minimizam (1 − β)·E[c] + β·CVaR_α[c] sobre o custo por MWh consumido c
 * (o quanto se consome é do negócio; o risco do contrato é o do preço pago). Com a regra de
 * ajuste ao consumo o custo não é convexo no volume: a busca é global no volume (grade + seção áurea)
 * e por troca de energia entre pares de meses na sazonalização, partindo da melhor entre flat e
 * conforme a carga — nunca termina pior que elas.
 */

import { dayType, daysOfMonths } from "./calendar";

export const Z90 = 1.2815515655446004;

export interface MonthBand {
  mes: string; // AAAA-MM
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface Limits {
  min: number;
  maxHourly: number;
  /** PLD máximo estrutural: teto da média diária dos preços horários (sem ele, só o teto horário vale). */
  maxStructural?: number;
}

/** Maior média mensal possível: todos os dias no teto estrutural (ou todas as horas no teto horário). */
export const monthCap = (l: Limits) => Math.min(l.maxHourly, l.maxStructural ?? Infinity);

/* ------------------------------------------------------------- cenários de nível mensal */

/** PRNG determinístico (mulberry32) e normal padrão (Box–Muller): o mesmo resultado em qualquer máquina. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, normal };
}

export interface Shocks {
  z: Float64Array; // fator comum por cenário
  e: Float64Array[]; // choque próprio de cada mês, por cenário
}

/** Média 0 e desvio 1 na amostra. */
function standardize(x: Float64Array): void {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (x[i] - mean) ** 2;
  sd = Math.sqrt(sd / n);
  for (let i = 0; i < n; i++) x[i] = sd > 0 ? (x[i] - mean) / sd : 0;
}

/**
 * Choques fixos: os mesmos para todo ρ, para a calibração e a comparação entre contratos serem suaves.
 * Casamento de momentos: o fator comum e o choque de cada mês têm média 0 e variância 1 na amostra, e os
 * choques dos meses são ortogonais ao fator — tira o grosso do ruído de Monte Carlo das médias.
 */
export function shocks(n: number, months: number, seed = 20261030): Shocks {
  const r = rng(seed);
  const z = Float64Array.from({ length: n }, () => r.normal());
  const e = Array.from({ length: n }, () => Float64Array.from({ length: months }, () => r.normal()));
  if (n < 3) return { z, e };
  standardize(z);
  const col = new Float64Array(n);
  for (let m = 0; m < months; m++) {
    let dot = 0;
    for (let s = 0; s < n; s++) {
      col[s] = e[s][m];
      dot += col[s] * z[s];
    }
    dot /= n;
    for (let s = 0; s < n; s++) col[s] -= dot * z[s];
    standardize(col);
    for (let s = 0; s < n; s++) e[s][m] = col[s];
  }
  return { z, e };
}

/** Normais padrão com correlação ρ entre os meses (fator comum). */
export function correlated(sh: Shocks, rho: number): Float64Array[] {
  const a = Math.sqrt(Math.min(Math.max(rho, 0), 1));
  const b = Math.sqrt(1 - a * a);
  return sh.e.map((row, s) => Float64Array.from(row, (x) => a * sh.z[s] + b * x));
}

/** Mediana e dispersão lognormal do nível mensal: mediana no P50, cauda alta pelo P90. */
export function lognormal(b: MonthBand, floor: number): { mu: number; sigma: number } {
  const p50 = Math.max(b.p50 ?? floor, floor);
  const sigma = b.p90 !== null && b.p90 > p50 ? Math.log(b.p90 / p50) / Z90 : 0.05;
  return { mu: Math.log(p50), sigma };
}

/** Nível mensal por cenário: lognormal entre o piso e a maior média mensal que as regras do PLD permitem. */
export function levelsFrom(x: Float64Array[], bands: MonthBand[], floors: number[], caps?: number[]): Float64Array[] {
  const par = bands.map((b, m) => lognormal(b, floors[m]));
  return x.map((row) => Float64Array.from(par, ({ mu, sigma }, m) => Math.min(caps?.[m] ?? Infinity, Math.max(floors[m], Math.exp(mu + sigma * row[m])))));
}

/** Nível mensal (R$/MWh) por cenário × mês, com correlação ρ entre os meses e piso no PLD mínimo. */
export function monthlyLevels(bands: MonthBand[], rho: number, sh: Shocks, floors: number[], caps?: number[]): Float64Array[] {
  return levelsFrom(correlated(sh, rho), bands, floors, caps);
}

export function quantile(xs: ArrayLike<number>, p: number): number {
  const v = Float64Array.from(xs).sort();
  if (!v.length) return NaN;
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
}

/** (P90 − P50 da média dos meses) ÷ média dos (P90 − P50) mensais: 1 = meses andam juntos; menor = se compensam. */
export function spreadRatio(levels: Float64Array[]): number {
  const M = levels[0]?.length ?? 0;
  if (!M) return NaN;
  const avg = levels.map((x) => x.reduce((a, b) => a + b, 0) / M);
  let width = 0;
  for (let m = 0; m < M; m++) {
    const col = levels.map((x) => x[m]);
    width += quantile(col, 0.9) - quantile(col, 0.5);
  }
  width /= M;
  return width > 1e-9 ? (quantile(avg, 0.9) - quantile(avg, 0.5)) / width : NaN;
}

/** Correlação entre meses que reproduz a razão `target` medida nos cenários do SDDP (bisseção em ρ). */
export function impliedRho(bands: MonthBand[], target: number, floors: number[], caps?: number[], n = 1500): number | null {
  if (!Number.isFinite(target) || bands.length < 3) return null;
  const sh = shocks(n, bands.length, 7);
  const f = (rho: number) => spreadRatio(monthlyLevels(bands, rho, sh, floors, caps));
  let lo = 0;
  let hi = 0.999;
  if (target <= f(lo)) return 0;
  if (target >= f(hi)) return hi;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

/* ----------------------------------------------------------------- calendário horário */

export interface ContractCalendar {
  months: string[];
  /** Data e mês (índice) de cada dia do horizonte. */
  days: { date: string; month: number }[];
  hours: number[]; // H_m
  offset: number[]; // índice da primeira hora de cada mês
  total: number;
}

export function contractCalendar(months: string[]): ContractCalendar {
  const days = daysOfMonths(months);
  const hours = months.map((_, m) => days.filter((d) => d.month === m).length * 24);
  const offset = hours.map((_, m) => hours.slice(0, m).reduce((a, b) => a + b, 0));
  return { months, days, hours, offset, total: hours.reduce((a, b) => a + b, 0) };
}

/**
 * Teto estrutural nos dias de [from, to), pela mesma regra do PLD estimado e da previsão da plataforma
 * (capDailyMean, em brazil.ts): se a média de um dia passa do PLD máximo estrutural, a curva acima do
 * piso é reduzida na mesma proporção até a média ficar igual ao teto, mantendo o perfil horário.
 */
function capDays(out: Float64Array, from: number, to: number, cap: number, lim: Limits): void {
  for (let a = from; a < to; a += 24) {
    const b = Math.min(a + 24, to);
    let sum = 0;
    for (let h = a; h < b; h++) sum += out[h];
    const mean = sum / (b - a);
    if (mean <= cap) continue;
    const k = (cap - lim.min) / (mean - lim.min);
    for (let h = a; h < b; h++) out[h] = lim.min + (out[h] - lim.min) * k;
  }
}

/**
 * Preços das horas [from, to) com média `level`: nível + desvio, entre o piso e o teto horário,
 * recentrado (Newton com salvaguarda: a média recortada é linear por partes e não decrescente no
 * deslocamento). Se algum dia passar do teto estrutural, o dia é ajustado pela regra do teto e o
 * deslocamento é refeito por bisseção para o mês manter o nível.
 */
export function fillMonth(level: number, dev: ArrayLike<number>, from: number, to: number, lim: Limits, out: Float64Array): void {
  const n = to - from;
  if (n <= 0) return;
  const top = monthCap(lim);
  if (level <= lim.min) {
    out.fill(lim.min, from, to);
    return;
  }
  if (level >= top) {
    out.fill(top, from, to);
    return;
  }
  let lo = -Infinity;
  let hi = Infinity;
  let d = 0;
  for (let it = 0; it < 60; it++) {
    let sum = 0;
    let free = 0;
    for (let i = from; i < to; i++) {
      const v = level + d + dev[i];
      if (v <= lim.min) sum += lim.min;
      else if (v >= lim.maxHourly) sum += lim.maxHourly;
      else {
        sum += v;
        free++;
      }
    }
    const g = sum / n - level;
    if (Math.abs(g) < 1e-7) break;
    if (g > 0) hi = Math.min(hi, d);
    else lo = Math.max(lo, d);
    let nd = free > 0 ? d - g / (free / n) : g > 0 ? d - 100 : d + 100;
    if (!(nd > lo && nd < hi)) nd = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : nd;
    d = nd;
  }
  const write = (shift: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) {
      const v = level + shift + dev[i];
      out[i] = v < lim.min ? lim.min : v > lim.maxHourly ? lim.maxHourly : v;
    }
    if (top < lim.maxHourly) capDays(out, from, to, top, lim);
    for (let i = from; i < to; i++) sum += out[i];
    return sum / n;
  };
  if (write(d) >= level - 1e-6) return; // nenhum dia passou do teto estrutural
  // os dias cortados baixaram a média: sobe o resto até o mês voltar ao nível (a média não decresce no deslocamento)
  let a = d;
  let b = d + 64;
  for (let it = 0; it < 40 && write(b) < level; it++) b = d + 2 * (b - d);
  for (let it = 0; it < 60 && b - a > 1e-7; it++) {
    const mid = (a + b) / 2;
    if (write(mid) < level) a = mid;
    else b = mid;
  }
  write(b);
}

/* ---------------------------------------------------------------- estatísticas por cenário */

export interface Side {
  bands: MonthBand[];
  lims: Limits[];
  /** Desvio horário (R$/MWh) de cada hora do horizonte. */
  dev: ArrayLike<number>;
  rho: number;
}

export interface LoadUncertainty {
  /** Desvio-padrão do choque comum do ano (fração). */
  annual: number;
  /** Desvio-padrão do choque próprio de cada mês (fração). */
  monthly: number;
  /** Correlação do choque de consumo com o choque de preço do mesmo mês, no submercado da carga (−1 a 1). */
  priceCorr?: number;
}

/** O que o custo de qualquer contrato precisa de cada cenário × mês (índice s·M + m). */
export interface Stats {
  n: number;
  M: number;
  cal: ContractCalendar;
  /** Σ_h L_h·PLD da carga (R$): custo spot da carga prevista. */
  X: Float64Array;
  /** Σ_h PLD do submercado do contrato (R$/MWh·h). */
  T: Float64Array;
  /** Σ_h L_h·PLD do submercado do contrato (R$). */
  Z: Float64Array;
  /** Choque de carga ε do mês. */
  eps: Float64Array;
  /** Energia prevista de cada mês (MWh, sem perdas nem choque). */
  loadSum: Float64Array;
  levelsLoad: Float64Array[];
  levelsContract: Float64Array[];
  /**
   * Choques normais por cenário × mês — do nível no submercado da carga, do componente próprio do
   * submercado do contrato (null se for o mesmo) e do consumo fora a parte ligada ao preço: o que se
   * sabe no início de cada mês, para o valor de mercado do resto do contrato.
   */
  shockLoad: Float64Array[];
  shockOwn: Float64Array[] | null;
  shockUse: Float64Array; // s·M + m
  /** PLD do submercado da carga somado em cada hora do dia, sobre os cenários calculados e os dias do ano. */
  hourSum: Float64Array;
  sameSub: boolean;
  done: number; // cenários já calculados
  input: StatsInput;
  /** Preço capturado pelo contrato modulado pela carga em função do nível do mês (calculado sob demanda). */
  capture?: { levels: Float64Array; value: Float64Array }[];
}

export interface StatsInput {
  cal: ContractCalendar;
  load: ArrayLike<number>; // MW em cada hora do horizonte
  loadSide: Side;
  contractSide: Side | null; // null = mesmo submercado
  crossRho: number; // correlação entre os níveis dos dois submercados
  uncertainty: LoadUncertainty;
  n?: number;
  seed?: number;
}

/** Aloca as estatísticas e sorteia níveis e choques (rápido); os somatórios horários vêm em `fillStats`. */
export function createStats(inp: StatsInput): Stats {
  const n = inp.n ?? 2000;
  const seed = inp.seed ?? 20261030;
  const M = inp.cal.months.length;
  const xy = correlated(shocks(n, M, seed), inp.loadSide.rho);
  const levelsLoad = levelsFrom(
    xy,
    inp.loadSide.bands,
    inp.loadSide.lims.map((l) => l.min),
    inp.loadSide.lims.map(monthCap),
  );
  let levelsContract = levelsLoad;
  let own: Float64Array[] | null = null;
  if (inp.contractSide) {
    const r = Math.min(Math.max(inp.crossRho, -1), 1);
    own = correlated(shocks(n, M, seed + 101), inp.contractSide.rho);
    const k = Math.sqrt(1 - r * r);
    const o = own;
    const xx = xy.map((row, s) => Float64Array.from(row, (x, m) => r * x + k * o[s][m]));
    levelsContract = levelsFrom(
      xx,
      inp.contractSide.bands,
      inp.contractSide.lims.map((l) => l.min),
      inp.contractSide.lims.map(monthCap),
    );
  }
  // ε = ρ·σ·(choque de preço do mês) + √(1 − ρ²)·(σ_ano·z + σ_mês·e): desvio-padrão σ e correlação ρ com o preço
  const { annual, monthly } = inp.uncertainty;
  const rc = Math.min(Math.max(inp.uncertainty.priceCorr ?? 0, -1), 1);
  const sig = Math.sqrt(annual * annual + monthly * monthly);
  const kr = Math.sqrt(1 - rc * rc);
  const lr = rng(seed + 202);
  const eps = new Float64Array(n * M);
  const use = new Float64Array(n * M);
  for (let s = 0; s < n; s++) {
    const za = lr.normal();
    for (let m = 0; m < M; m++) {
      const u = annual * za + monthly * lr.normal();
      use[s * M + m] = u;
      eps[s * M + m] = Math.max(-0.95, rc * sig * xy[s][m] + kr * u);
    }
  }
  const loadSum = new Float64Array(M);
  for (let m = 0; m < M; m++) for (let h = inp.cal.offset[m]; h < inp.cal.offset[m] + inp.cal.hours[m]; h++) loadSum[m] += inp.load[h];
  return {
    n,
    M,
    cal: inp.cal,
    X: new Float64Array(n * M),
    T: new Float64Array(n * M),
    Z: new Float64Array(n * M),
    eps,
    loadSum,
    levelsLoad,
    levelsContract,
    shockLoad: xy,
    shockOwn: own,
    shockUse: use,
    hourSum: new Float64Array(24),
    sameSub: !inp.contractSide,
    done: 0,
    input: inp,
  };
}

/** Calcula as horas dos cenários [s0, s1) — em blocos, para a tela não travar. */
export function fillStats(st: Stats, inp: StatsInput, s0: number, s1: number): void {
  const { cal } = st;
  const bufY = new Float64Array(cal.total);
  const bufX = st.sameSub ? bufY : new Float64Array(cal.total);
  for (let s = s0; s < Math.min(s1, st.n); s++) {
    for (let m = 0; m < st.M; m++) {
      const a = cal.offset[m];
      const b = a + cal.hours[m];
      fillMonth(st.levelsLoad[s][m], inp.loadSide.dev, a, b, inp.loadSide.lims[m], bufY);
      if (!st.sameSub) fillMonth(st.levelsContract[s][m], inp.contractSide!.dev, a, b, inp.contractSide!.lims[m], bufX);
      let x = 0;
      let t = 0;
      let z = 0;
      for (let h = a; h < b; h++) {
        x += inp.load[h] * bufY[h];
        t += bufX[h];
        z += inp.load[h] * bufX[h];
        st.hourSum[h % 24] += bufY[h];
      }
      const i = s * st.M + m;
      st.X[i] = x;
      st.T[i] = t;
      st.Z[i] = st.sameSub ? x : z;
    }
  }
  st.done = Math.max(st.done, Math.min(s1, st.n));
}

export function buildStats(inp: StatsInput): Stats {
  const st = createStats(inp);
  fillStats(st, inp, 0, st.n);
  return st;
}

/* ---------------------------------------------------------------------------- contrato */

export type FlexRule = "carga" | "livre";
export type Modulation = "flat" | "carga";

export interface Contract {
  price: number; // R$/MWh
  volumes: number[]; // V_m sazonalizado (MWmed)
  flex: number; // f (fração)
  flexRule: FlexRule;
  modulation: Modulation;
  losses: number; // λ (fração da carga medida)
}

export interface Evaluation {
  total: Float64Array; // custo do ano por cenário (R$)
  energy: Float64Array; // energia consumida no ano por cenário (MWh, com perdas e choque de carga)
  taken: Float64Array; // volume tomado v (MWmed), s·M + m
  /** Valor do contrato frente ao PLD por cenário e mês: Σ w·PLD − H·P (R$/MWmed). */
  edge: Float64Array;
}

/** Custo do ano em cada cenário para um contrato (e o volume tomado mês a mês). */
export function evaluate(st: Stats, c: Contract, withDetail = false): Evaluation {
  const { n, M, cal } = st;
  const total = new Float64Array(n);
  const energy = new Float64Array(n);
  const taken = withDetail ? new Float64Array(n * M) : new Float64Array(0);
  const edge = withDetail ? new Float64Array(n * M) : new Float64Array(0);
  const lf = 1 + c.losses;
  const lo = c.volumes.map((v) => (1 - c.flex) * v);
  const hi = c.volumes.map((v) => (1 + c.flex) * v);
  for (let s = 0; s < n; s++) {
    let sum = 0;
    let e = 0;
    for (let m = 0; m < M; m++) {
      const i = s * M + m;
      const H = cal.hours[m];
      const k = (1 + st.eps[i]) * lf;
      e += k * st.loadSum[m];
      const W = c.modulation === "flat" ? st.T[i] : st.loadSum[m] > 0 ? (H * st.Z[i]) / st.loadSum[m] : st.T[i];
      const kc = H * c.price - W; // custo do contrato menos o valor dele ao PLD, por MWmed
      let v: number;
      if (c.flexRule === "carga") {
        const need = (k * st.loadSum[m]) / H;
        v = need < lo[m] ? lo[m] : need > hi[m] ? hi[m] : need;
      } else v = kc < 0 ? hi[m] : lo[m];
      sum += v * kc + k * st.X[i];
      if (withDetail) {
        taken[i] = v;
        edge[i] = -kc;
      }
    }
    total[s] = sum;
    energy[s] = e;
  }
  return { total, energy, taken, edge };
}

/** Custo por MWh consumido em cada cenário: a métrica de risco (o volume consumido é do negócio, não do contrato). */
export const unitCost = (ev: Evaluation) => Float64Array.from(ev.total, (c, s) => (ev.energy[s] > 0 ? c / ev.energy[s] : 0));

export interface RiskStats {
  mean: number;
  cvar: number;
  var: number;
  p05: number;
  p95: number;
}

/** Média, VaR e CVaR (cauda alta: o lado ruim para quem compra) de uma amostra por cenário. */
export function risk(total: Float64Array, alpha = 0.95): RiskStats {
  const c = Float64Array.from(total).sort();
  const n = c.length;
  const k = Math.max(1, Math.ceil((1 - alpha) * n));
  let tail = 0;
  for (let i = n - k; i < n; i++) tail += c[i];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += c[i];
  mean /= n;
  const q = (p: number) => {
    const x = (n - 1) * p;
    const a = Math.floor(x);
    return c[a] + (c[Math.min(a + 1, n - 1)] - c[a]) * (x - a);
  };
  return { mean, cvar: tail / k, var: c[n - k], p05: q(0.05), p95: q(0.95) };
}

export const objective = (r: RiskStats, beta: number) => (1 - beta) * r.mean + beta * r.cvar;

/** Média dos k maiores valores, sem ordenar tudo: seleção de Hoare, O(n) em média (reordena `a`). */
export function topMean(a: Float64Array, k: number): number {
  const n = a.length;
  const target = n - k;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >>> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  let sum = 0;
  for (let i = target; i < n; i++) sum += a[i];
  return sum / k;
}

/* -------------------------------------------------------------------------- sazonalização */

export type SeasonMode = "flat" | "carga" | "otima";

/** Ajusta os fatores u_m aos limites [1 − s, 1 + s] mantendo Σ H_m·u_m = H (média 1). */
export function clampShape(u: number[], hours: number[], limit: number): number[] {
  const H = hours.reduce((a, b) => a + b, 0);
  let x = u.map((v) => Math.min(1 + limit, Math.max(1 - limit, v)));
  for (let it = 0; it < 50; it++) {
    const gap = H - x.reduce((a, v, m) => a + v * hours[m], 0);
    if (Math.abs(gap) < 1e-9 * H) break;
    const free = x.map((v) => (gap > 0 ? v < 1 + limit - 1e-12 : v > 1 - limit + 1e-12));
    const room = hours.reduce((a, h, m) => a + (free[m] ? h : 0), 0);
    if (room <= 0) break;
    x = x.map((v, m) => (free[m] ? Math.min(1 + limit, Math.max(1 - limit, v + gap / room)) : v));
  }
  return x;
}

/** Sazonalização conforme a carga prevista (dentro dos limites). */
export function loadShape(st: Stats, limit: number): number[] {
  const H = st.cal.hours.reduce((a, b) => a + b, 0);
  const avg = st.loadSum.reduce((a, b) => a + b, 0) / H;
  const u = st.cal.hours.map((h, m) => (avg > 0 ? st.loadSum[m] / h / avg : 1));
  return clampShape(u, st.cal.hours, limit);
}

export interface ContractTerms {
  price: number;
  flex: number;
  flexRule: FlexRule;
  modulation: Modulation;
  losses: number;
}

export interface Plan {
  /** Volume anual fixo (MWmed) ou null para otimizar. */
  volume: number | null;
  season: SeasonMode;
  seasonLimit: number;
}

export interface Optimum {
  q: number;
  shape: number[];
  volumes: number[];
  risk: RiskStats;
  evals: number;
}

export const avgLoadMw = (st: Stats) => st.loadSum.reduce((a, b) => a + b, 0) / st.cal.total;

/**
 * Avaliador da busca: o que não depende dos volumes fica pré-calculado por cenário × mês, e mudar o
 * volume de um mês refaz só aquele mês. Mesmo custo de `evaluate`, sem alocar a cada avaliação.
 */
export function searcher(st: Stats, terms: ContractTerms, beta: number, alpha = 0.95) {
  const { n, M, cal } = st;
  const kc = new Float64Array(n * M); // H·P − Σ w·PLD do contrato, por MWmed
  const need = new Float64Array(n * M); // consumo medido com perdas (MWmed)
  const base = new Float64Array(n); // a carga toda ao PLD (R$)
  const inv = new Float64Array(n); // 1 ÷ energia consumida no ano
  const lf = 1 + terms.losses;
  for (let s = 0; s < n; s++) {
    let b = 0;
    let e = 0;
    for (let m = 0; m < M; m++) {
      const i = s * M + m;
      const H = cal.hours[m];
      const k = (1 + st.eps[i]) * lf;
      const W = terms.modulation === "flat" ? st.T[i] : st.loadSum[m] > 0 ? (H * st.Z[i]) / st.loadSum[m] : st.T[i];
      kc[i] = H * terms.price - W;
      need[i] = (k * st.loadSum[m]) / H;
      b += k * st.X[i];
      e += k * st.loadSum[m];
    }
    base[s] = b;
    inv[s] = e > 0 ? 1 / e : 0;
  }
  const lo = 1 - terms.flex;
  const hi = 1 + terms.flex;
  const byLoad = terms.flexRule === "carga";
  /** Soma sign × (custo do contrato menos o valor dele ao PLD) do mês m com volume V, cenário a cenário. */
  const addMonth = (m: number, V: number, sign: number, acc: Float64Array) => {
    const a = lo * V;
    const b = hi * V;
    if (byLoad)
      for (let s = 0, i = m; s < n; s++, i += M) {
        const x = need[i];
        acc[s] += sign * (x < a ? a : x > b ? b : x) * kc[i];
      }
    else for (let s = 0, i = m; s < n; s++, i += M) acc[s] += sign * (kc[i] < 0 ? b : a) * kc[i];
  };
  const costs = (volumes: number[], out: Float64Array) => {
    out.set(base);
    for (let m = 0; m < M; m++) addMonth(m, volumes[m], 1, out);
    return out;
  };
  const unit = new Float64Array(n);
  const k = Math.max(1, Math.ceil((1 - alpha) * n));
  /** (1 − β)·E + β·CVaR do custo por MWh consumido. */
  const score = (c: Float64Array) => {
    let mean = 0;
    for (let s = 0; s < n; s++) {
      const u = c[s] * inv[s];
      unit[s] = u;
      mean += u;
    }
    return ((1 - beta) * mean) / n + beta * topMean(unit, k);
  };
  return { addMonth, costs, score };
}

/** Volume e sazonalização que minimizam (1 − β)·E + β·CVaR. */
export function optimizeContract(st: Stats, terms: ContractTerms, plan: Plan, beta: number, alpha = 0.95): Optimum {
  const S = searcher(st, terms, beta, alpha);
  const buf = new Float64Array(st.n);
  let evals = 0;
  const F = (q: number, u: number[]) => {
    evals++;
    return S.score(S.costs(u.map((x) => q * x), buf));
  };
  const qMax = Math.max(avgLoadMw(st) * (1 + terms.losses) * 1.5, 1e-6);
  const bestQ = (u: number[]) => {
    if (plan.volume !== null) return { q: plan.volume, f: F(plan.volume, u) };
    let best = { q: 0, f: F(0, u) };
    for (let i = 1; i <= 40; i++) {
      const q = (qMax * i) / 40;
      const f = F(q, u);
      if (f < best.f) best = { q, f };
    }
    let a = Math.max(0, best.q - qMax / 40);
    let b = Math.min(qMax, best.q + qMax / 40);
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = b - g * (b - a);
    let x2 = a + g * (b - a);
    let f1 = F(x1, u);
    let f2 = F(x2, u);
    for (let i = 0; i < 30; i++) {
      if (f1 <= f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - g * (b - a);
        f1 = F(x1, u);
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + g * (b - a);
        f2 = F(x2, u);
      }
    }
    const mid = (a + b) / 2;
    const fm = F(mid, u);
    return fm < best.f ? { q: mid, f: fm } : best;
  };

  const flat = new Array(st.M).fill(1);
  const starts = plan.season === "flat" ? [flat] : plan.season === "carga" ? [loadShape(st, plan.seasonLimit)] : [flat, loadShape(st, plan.seasonLimit)];
  let best = { u: starts[0], ...bestQ(starts[0]) };
  for (const u of starts.slice(1)) {
    const x = bestQ(u);
    if (x.f < best.f) best = { u, ...x };
  }

  if (plan.season === "otima" && plan.seasonLimit > 0) {
    const lim = plan.seasonLimit;
    const H = st.cal.hours;
    const cur = new Float64Array(st.n);
    const tmp = new Float64Array(st.n);
    for (let round = 0; round < 3 && best.q > 0; round++) {
      const q = best.q;
      const u = [...best.u];
      S.costs(u.map((x) => q * x), cur);
      let f = S.score(cur);
      // troca de energia entre pares de meses, passo caindo pela metade; só os dois meses são refeitos
      for (let step = lim; step >= lim / 64; step /= 2) {
        let improved = true;
        let guard = 0;
        while (improved && guard++ < 40) {
          improved = false;
          for (let i = 0; i < st.M; i++) {
            for (let j = 0; j < st.M; j++) {
              if (i === j) continue;
              const e = step * Math.min(H[i], H[j]); // energia movida (em unidades de u·h)
              const ui = u[i] + e / H[i];
              const uj = u[j] - e / H[j];
              if (ui > 1 + lim + 1e-12 || uj < 1 - lim - 1e-12) continue;
              tmp.set(cur);
              S.addMonth(i, q * u[i], -1, tmp);
              S.addMonth(i, q * ui, 1, tmp);
              S.addMonth(j, q * u[j], -1, tmp);
              S.addMonth(j, q * uj, 1, tmp);
              evals++;
              const x = S.score(tmp);
              if (x < f - 1e-9 * Math.abs(f)) {
                u[i] = ui;
                u[j] = uj;
                cur.set(tmp);
                f = x;
                improved = true;
              }
            }
          }
        }
      }
      const re = bestQ(u);
      const moved = re.f < best.f - 1e-9 * Math.abs(best.f);
      if (re.f <= best.f) best = { u, ...re };
      if (!moved) break;
    }
  }
  const volumes = best.u.map((x) => best.q * x);
  return { q: best.q, shape: best.u, volumes, risk: risk(unitCost(evaluate(st, { ...terms, volumes })), alpha), evals };
}

/* ------------------------------------------------------------------------------- resumo */

export interface MonthRow {
  mes: string;
  pldContrato: number; // PLD médio esperado no submercado do contrato
  pldCarga: number; // PLD esperado ponderado pela carga, no submercado da carga
  carga: number; // MWmed esperado (com perdas)
  volume: number; // V_m sazonalizado
  min: number;
  max: number;
  tomado: number; // volume tomado esperado
  custoMwh: number; // custo esperado por MWh consumido
}

export interface Exposure {
  mes: string;
  /**
   * Perda ao recontratar o resto do contrato a preço de mercado se a contraparte falhar no início do
   * mês: média (EE) e quantil (PFE) da parte positiva do valor de mercado, já descontada a recuperação.
   */
  ee: number;
  pfe: number;
  /** Valor esperado do resto do contrato para o comprador (positivo = contrato abaixo do mercado). */
  mtm: number;
  /** Sem recontratar: o resto do contrato fica exposto ao PLD de cada cenário até o fim. */
  eeSpot: number;
  pfeSpot: number;
}

export function monthTable(st: Stats, c: Contract): MonthRow[] {
  const ev = evaluate(st, c, true);
  const { n, M, cal } = st;
  return cal.months.map((mes, m) => {
    let t = 0;
    let x = 0;
    let v = 0;
    let cost = 0;
    let e = 0;
    for (let s = 0; s < n; s++) {
      const i = s * M + m;
      const k = (1 + st.eps[i]) * (1 + c.losses);
      t += st.T[i];
      x += st.X[i];
      v += ev.taken[i];
      cost += k * st.X[i] - ev.taken[i] * ev.edge[i]; // C_m = (1+ε)(1+λ)·X + v·(H·P − Σ w·PLD)
      e += k * st.loadSum[m];
    }
    const H = cal.hours[m];
    return {
      mes,
      pldContrato: t / n / H,
      pldCarga: st.loadSum[m] > 0 ? x / n / st.loadSum[m] : t / n / H,
      carga: ((1 + c.losses) * st.loadSum[m]) / H,
      volume: c.volumes[m],
      min: (1 - c.flex) * c.volumes[m],
      max: (1 + c.flex) * c.volumes[m],
      tomado: v / n,
      custoMwh: e > 0 ? cost / e : NaN,
    };
  });
}

/** E[f(Z)], Z normal padrão: trapézio em ±7 desvios com a densidade normalizada (robusto às quinas do piso e do teto). */
const normalNodes = (count: number, half: number) => {
  const nodes = Float64Array.from({ length: count }, (_, i) => -half + (2 * half * i) / (count - 1));
  const w = nodes.map((z) => Math.exp((-z * z) / 2));
  const sum = w.reduce((a, b) => a + b, 0);
  return { nodes, weights: w.map((x) => x / sum) };
};
const { nodes: Z_NODES, weights: Z_WEIGHTS } = normalNodes(71, 7);

/** Nós e pesos de Gauss–Legendre em [−1, 1]. */
function gaussLegendre(count: number): { x: Float64Array; w: Float64Array } {
  const x = new Float64Array(count);
  const w = new Float64Array(count);
  for (let i = 0; i < Math.ceil(count / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (count + 0.5));
    let dp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= count; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      dp = (count * (z * p1 - p2)) / (z * z - 1);
      const prev = z;
      z = prev - p1 / dp;
      if (Math.abs(z - prev) < 1e-15) break;
    }
    x[i] = -z;
    x[count - 1 - i] = z;
    w[i] = w[count - 1 - i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}
const GL = gaussLegendre(16);
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/**
 * E[g(Z)], Z normal padrão em ±7 desvios, por Gauss–Legendre em cada trecho entre as quinas dadas (onde g
 * deixa de ser suave: piso, teto, limites da flexibilidade) e em ±2: exato para as quinas sem grade fina.
 * `cuts` é um buffer de trabalho com as quinas nas primeiras `count` posições (e espaço para mais 4).
 */
function normalExpectation(g: (z: number) => number, cuts: Float64Array, count: number): number {
  let k = 0;
  for (let i = 0; i < count; i++) if (cuts[i] > -7 && cuts[i] < 7) cuts[k++] = cuts[i];
  cuts[k++] = -7;
  cuts[k++] = -2;
  cuts[k++] = 2;
  cuts[k++] = 7;
  for (let i = 1; i < k; i++) {
    const v = cuts[i];
    let j = i - 1;
    while (j >= 0 && cuts[j] > v) {
      cuts[j + 1] = cuts[j];
      j--;
    }
    cuts[j + 1] = v;
  }
  let acc = 0;
  for (let j = 0; j + 1 < k; j++) {
    const a = cuts[j];
    const b = cuts[j + 1];
    if (b - a < 1e-12) continue;
    const half = (b - a) / 2;
    const mid = (a + b) / 2;
    for (let q = 0; q < GL.x.length; q++) {
      const z = mid + half * GL.x[q];
      acc += GL.w[q] * half * INV_SQRT_2PI * Math.exp((-z * z) / 2) * g(z);
    }
  }
  return acc;
}

/** E[f(c + band·Z)] tabelada em [lo, hi] e lida por interpolação linear (fora da faixa, o extremo). */
function smoothed(f: (x: number) => number, band: number, lo: number, hi: number, points = 401): (c: number) => number {
  const N = hi > lo ? points : 1;
  const h = N > 1 ? (hi - lo) / (N - 1) : 1;
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const c = lo + i * h;
    if (band < 1e-12) v[i] = f(c);
    else {
      let acc = 0;
      for (let q = 0; q < Z_NODES.length; q++) acc += Z_WEIGHTS[q] * f(c + band * Z_NODES[q]);
      v[i] = acc;
    }
  }
  return (c) => {
    if (N === 1) return v[0];
    const x = (c - lo) / h;
    if (x <= 0) return v[0];
    if (x >= N - 1) return v[N - 1];
    const i = Math.floor(x);
    return v[i] + (v[i + 1] - v[i]) * (x - i);
  };
}

/**
 * Fator comum de uma série x_j = carga·f + ruído·e_j (f e e normais padrão) depois de ver a soma de t valores:
 * média e variância a posteriori de f.
 */
function posterior(sum: number, t: number, load: number, noise: number): { mean: number; var: number } {
  if (t === 0 || load < 1e-12) return { mean: 0, var: 1 };
  if (noise < 1e-9) return { mean: sum / (t * load), var: 0 };
  const prec = 1 + (t * load * load) / (noise * noise);
  return { mean: ((load / (noise * noise)) * sum) / prec, var: 1 / prec };
}

/** Preço capturado (Σ L_h·PLD_h ÷ Σ L_h) pelo contrato modulado pela carga em uma grade de níveis de cada mês. */
function captureTable(st: Stats): { levels: Float64Array; value: Float64Array }[] {
  if (st.capture) return st.capture;
  const { input: inp, cal } = st;
  const side = inp.contractSide ?? inp.loadSide;
  const buf = new Float64Array(cal.total);
  st.capture = cal.months.map((_, m) => {
    const lo = side.lims[m].min;
    const hi = monthCap(side.lims[m]);
    const a = cal.offset[m];
    const b = a + cal.hours[m];
    const levels = Float64Array.from({ length: 121 }, (_, k) => lo * Math.pow(hi / lo, k / 120));
    const value = Float64Array.from(levels, (L) => {
      fillMonth(L, side.dev, a, b, side.lims[m], buf);
      let z = 0;
      for (let h = a; h < b; h++) z += inp.load[h] * buf[h];
      return st.loadSum[m] > 0 ? z / st.loadSum[m] : L;
    });
    return { levels, value };
  });
  return st.capture;
}

/**
 * Exposição se a comercializadora quebrar no início de cada mês t.
 *
 * O comprador perde o resto do contrato, Y_t = Σ_{m ≥ t} v_m·(Σ_h w_h·PLD_h − H_m·P), e o repõe a preço de
 * mercado: a perda é a parte positiva de E_t[Y_t], o valor esperado dado o que já se viu até o fim do mês
 * t − 1. Nos cenários, o que se viu entra pelos fatores comuns — do nível no submercado da carga, do
 * componente próprio do submercado do contrato e do consumo —, que têm posteriori normal; E_t[Y_t] sai
 * das integrais exatas do modelo sobre essas normais (nível lognormal entre o piso e o teto, preço
 * capturado pela modulação, volume tomado pela regra da flexibilidade), não de regressão.
 * EE = média e PFE = quantil da perda, vezes (1 − recuperação). Também sai a perda sem recontratar: o resto
 * exposto ao PLD de cada cenário até o fim.
 */
export function counterpartyExposure(st: Stats, c: Contract, recovery = 0, pfeLevel = 0.95): Exposure[] {
  const ev = evaluate(st, c, true);
  const { n, M, cal, input: inp } = st;
  const keep = 1 - recovery;
  const side = inp.contractSide ?? inp.loadSide;
  const par = side.bands.map((b, m) => lognormal(b, side.lims[m].min));
  const floor = side.lims.map((l) => l.min);
  const top = side.lims.map(monthCap);
  const cap = c.modulation === "carga" ? captureTable(st) : null;
  /** Preço médio que 1 MWmed do contrato captura no mês m, dado o choque normal x do nível do contrato. */
  const exact = (m: number, x: number) => {
    const L = Math.min(top[m], Math.max(floor[m], Math.exp(par[m].mu + par[m].sigma * x)));
    if (!cap) return L;
    const { levels, value } = cap[m];
    const pos = ((Math.log(L) - Math.log(levels[0])) / (Math.log(levels[levels.length - 1]) - Math.log(levels[0]))) * (levels.length - 1);
    if (!(pos > 0)) return value[0];
    if (pos >= levels.length - 1) return value[levels.length - 1];
    const i = Math.floor(pos);
    return value[i] + (value[i + 1] - value[i]) * (pos - i);
  };
  // tabelado em x (passo 0,005 desvio): as integrais abaixo leem a tabela em vez de refazer exp e log
  const X0 = -14;
  const DX = 0.005;
  const NX = 5601;
  const tabs = cal.months.map((_, m) => Float64Array.from({ length: NX }, (_, i) => exact(m, X0 + i * DX)));
  const price = (m: number, x: number) => {
    const tab = tabs[m];
    const pos = (x - X0) / DX;
    if (pos <= 0) return tab[0];
    if (pos >= NX - 1) return tab[NX - 1];
    const i = Math.floor(pos);
    return tab[i] + (tab[i + 1] - tab[i]) * (pos - i);
  };
  const lf = 1 + c.losses;
  const take = (m: number, nu: number) => {
    const need = ((1 + Math.max(-0.95, nu)) * lf * st.loadSum[m]) / cal.hours[m];
    const lo = (1 - c.flex) * c.volumes[m];
    const hi = (1 + c.flex) * c.volumes[m];
    return need < lo ? lo : need > hi ? hi : need;
  };
  // parâmetros dos choques (os mesmos de createStats)
  const rhoL = Math.min(Math.max(inp.loadSide.rho, 0), 1);
  const aL = Math.sqrt(rhoL);
  const bL = Math.sqrt(1 - rhoL);
  const rhoC = inp.contractSide ? Math.min(Math.max(inp.contractSide.rho, 0), 1) : 0;
  const aC = Math.sqrt(rhoC);
  const bC = Math.sqrt(1 - rhoC);
  const r = inp.contractSide ? Math.min(Math.max(inp.crossRho, -1), 1) : 1;
  const k = Math.sqrt(1 - r * r);
  const { annual, monthly } = inp.uncertainty;
  const rc = Math.min(Math.max(inp.uncertainty.priceCorr ?? 0, -1), 1);
  const sig = Math.sqrt(annual * annual + monthly * monthly);
  const kr = Math.sqrt(1 - rc * rc);
  const byLoad = c.flexRule === "carga" && c.flex > 0;
  const joint = byLoad && Math.abs(rc) > 1e-12 && sig > 0; // volume e preço ligados pelo mesmo choque
  const f = c.flex;

  const mtm = Array.from({ length: M }, () => new Float64Array(n));
  const s1 = new Float64Array(n);
  const s2 = new Float64Array(n);
  const s3 = new Float64Array(n);
  const mXY = new Float64Array(n);
  const mOwn = new Float64Array(n);
  const mU = new Float64Array(n);
  for (let t = 0; t < M; t++) {
    // a posteriori de cada cenário no início do mês t
    let vXY = 0;
    let vOwn = 0;
    let vU = 0;
    for (let s = 0; s < n; s++) {
      const z = posterior(s1[s], t, aL, bL);
      mXY[s] = aL * z.mean;
      vXY = aL * aL * z.var + bL * bL;
      if (inp.contractSide) {
        const z2 = posterior(s2[s], t, aC, bC);
        mOwn[s] = aC * z2.mean;
        vOwn = aC * aC * z2.var + bC * bC;
      }
      const z3 = posterior(s3[s], t, annual, monthly);
      mU[s] = annual * z3.mean;
      vU = annual * annual * z3.var + monthly * monthly;
    }
    const sXY = Math.sqrt(vXY);
    const sOwn = Math.sqrt(vOwn);
    const sU = Math.sqrt(vU);
    const range = (vals: Float64Array, pad: number): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of vals) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return [lo - pad, hi + pad];
    };
    for (let m = t; m < M; m++) {
      const H = cal.hours[m];
      const V = c.volumes[m];
      if (!joint) {
        // volume independente do preço: E[v·e] = E[v]·E[e] (ou, na opção livre, só preço)
        const muC = inp.contractSide ? Float64Array.from(mXY, (x, s) => r * x + k * mOwn[s]) : mXY;
        const sC = inp.contractSide ? Math.sqrt(r * r * vXY + k * k * vOwn) : sXY;
        const [lo, hi] = range(muC, 1e-6);
        const val =
          c.flexRule === "livre"
            ? smoothed((x) => {
                const e = price(m, x) - c.price;
                return e + f * Math.abs(e);
              }, sC, lo, hi)
            : smoothed((x) => price(m, x) - c.price, sC, lo, hi);
        const nuMean = Float64Array.from(mU, (u, s) => rc * sig * mXY[s] + kr * u);
        const sNu = Math.sqrt(rc * rc * sig * sig * vXY + kr * kr * vU);
        const [nlo, nhi] = range(nuMean, 1e-9);
        const vol = c.flexRule === "livre" || !byLoad ? null : smoothed((nu) => take(m, nu), sNu, nlo, nhi);
        for (let s = 0; s < n; s++) mtm[t][s] += H * (c.flexRule === "livre" ? V * val(muC[s]) : (vol ? vol(nuMean[s]) : V) * val(muC[s]));
      } else {
        // volume pelo consumo ligado ao preço: integra no choque do nível do submercado da carga
        let xlo = Infinity;
        let xhi = -Infinity;
        for (let s = 0; s < n; s++) {
          xlo = Math.min(xlo, mXY[s]);
          xhi = Math.max(xhi, mXY[s]);
        }
        xlo -= 7 * sXY + 1e-6;
        xhi += 7 * sXY + 1e-6;
        let olo = 0;
        let ohi = 0;
        if (inp.contractSide) [olo, ohi] = range(mOwn, 1e-6);
        const eGiven = inp.contractSide
          ? smoothed((x) => price(m, x) - c.price, k * sOwn, Math.min(r * xlo, r * xhi) + k * olo, Math.max(r * xlo, r * xhi) + k * ohi, 801)
          : smoothed((x) => price(m, x) - c.price, 0, xlo, xhi, 801);
        const [ulo, uhi] = range(mU, 1e-9);
        const nlo = Math.min(rc * sig * xlo, rc * sig * xhi) + kr * ulo;
        const nhi = Math.max(rc * sig * xlo, rc * sig * xhi) + kr * uhi;
        const vGiven = smoothed((nu) => take(m, nu), kr * sU, nlo, nhi, 801);
        // quinas no choque x do submercado da carga: piso e teto do preço e limites do volume tomado
        const xf = (Math.log(floor[m]) - par[m].mu) / par[m].sigma;
        const xc = (Math.log(top[m]) - par[m].mu) / par[m].sigma;
        const need1 = (lf * st.loadSum[m]) / H; // volume tomado com ε = 0
        const nuKinks = need1 > 0 ? [-0.95, ((1 - f) * V) / need1 - 1, ((1 + f) * V) / need1 - 1] : [-0.95];
        const cuts = new Float64Array(16);
        for (let s = 0; s < n; s++) {
          const mx = mXY[s];
          const mo = k * mOwn[s];
          const mu = kr * mU[s];
          let count = 0;
          if (!inp.contractSide) {
            cuts[count++] = (xf - mx) / sXY;
            cuts[count++] = (xc - mx) / sXY;
          } else if (Math.abs(r) > 1e-9) {
            cuts[count++] = ((xf - mo) / r - mx) / sXY;
            cuts[count++] = ((xc - mo) / r - mx) / sXY;
          }
          for (const nu of nuKinks) cuts[count++] = ((nu - mu) / (rc * sig) - mx) / sXY;
          const acc = normalExpectation(
            (z) => {
              const x = mx + sXY * z;
              return vGiven(rc * sig * x + mu) * (inp.contractSide ? eGiven(r * x + mo) : eGiven(x));
            },
            cuts,
            count,
          );
          mtm[t][s] += H * acc;
        }
      }
    }
    for (let s = 0; s < n; s++) {
      s1[s] += st.shockLoad[s][t];
      if (st.shockOwn) s2[s] += st.shockOwn[s][t];
      s3[s] += st.shockUse[s * M + t];
    }
  }

  const rest = new Float64Array(n);
  const out: Exposure[] = new Array(M);
  for (let t = M - 1; t >= 0; t--) {
    for (let s = 0; s < n; s++) rest[s] += ev.taken[s * M + t] * ev.edge[s * M + t];
    const loss = Float64Array.from(mtm[t], (v) => keep * Math.max(0, v));
    const spot = Float64Array.from(rest, (v) => keep * Math.max(0, v));
    out[t] = {
      mes: cal.months[t],
      ee: loss.reduce((a, b) => a + b, 0) / n,
      pfe: quantile(loss, pfeLevel),
      mtm: mtm[t].reduce((a, b) => a + b, 0) / n,
      eeSpot: spot.reduce((a, b) => a + b, 0) / n,
      pfeSpot: quantile(spot, pfeLevel),
    };
  }
  return out;
}

/** Histograma comum do custo em R$/MWh consumido para alguns contratos. */
export function costHistogram(st: Stats, contracts: Contract[], bins = 28): { edges: number[]; counts: number[][] } {
  const per = contracts.map((c) => unitCost(evaluate(st, c)));
  const lo = Math.min(...per.map((v) => quantile(v, 0.005)));
  const hi = Math.max(...per.map((v) => quantile(v, 0.995)));
  const w = (hi - lo) / bins || 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  const counts = per.map((v) => {
    const k = new Array(bins).fill(0);
    for (const x of v) k[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++;
    return k.map((y) => y / v.length);
  });
  return { edges, counts };
}

/** Preços de referência: PLD médio esperado no tempo (contrato flat) e ponderado pela carga. */
export function fairPrices(st: Stats): { flat: number; load: number; loadInContractSub: number } {
  const { n, M } = st;
  let t = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < n * M; i++) {
    t += st.T[i];
    x += st.X[i];
    z += st.Z[i];
  }
  const L = st.loadSum.reduce((a, b) => a + b, 0);
  return { flat: t / n / st.cal.total, load: L > 0 ? x / n / L : NaN, loadInContractSub: L > 0 ? z / n / L : NaN };
}

/* ---------------------------------------------------------------------------- carga */

/** Perfis típicos (exemplo) por tipo de dia, para quem ainda não tem a curva de carga. */
export const TYPICAL: Record<"comercial" | "industrial24" | "industrial2t", { label: string; util: number[]; sab: number[]; dom: number[] }> = {
  comercial: {
    label: "Comércio (horário comercial)",
    util: [0.35, 0.33, 0.32, 0.32, 0.33, 0.36, 0.45, 0.65, 0.95, 1.05, 1.1, 1.12, 1.1, 1.12, 1.12, 1.1, 1.05, 0.95, 0.8, 0.65, 0.55, 0.48, 0.42, 0.38],
    sab: [0.35, 0.33, 0.32, 0.32, 0.33, 0.35, 0.4, 0.55, 0.8, 0.9, 0.95, 0.95, 0.9, 0.75, 0.6, 0.5, 0.45, 0.42, 0.4, 0.38, 0.37, 0.36, 0.35, 0.35],
    dom: [0.33, 0.32, 0.32, 0.32, 0.32, 0.32, 0.33, 0.34, 0.35, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.35, 0.35, 0.35, 0.35, 0.34, 0.34, 0.33, 0.33],
  },
  industrial24: {
    label: "Indústria 24 h (evita a ponta)",
    util: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1],
    sab: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1],
    dom: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.75, 0.75, 0.75, 0.9, 0.9, 0.9],
  },
  industrial2t: {
    label: "Indústria em 2 turnos (6h–22h, sábado meio período)",
    util: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.25, 0.25],
    sab: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1, 1, 1, 1, 1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
    dom: new Array(24).fill(0.25),
  },
};

/** Carga do horizonte hora a hora num perfil típico, com média `avgMw` nos dias úteis × tipo de dia. */
export function typicalLoad(kind: keyof typeof TYPICAL, avgMw: number, cal: ContractCalendar): Float64Array {
  const p = TYPICAL[kind];
  const out = new Float64Array(cal.total);
  cal.days.forEach((d, i) => {
    const shape = p[dayType(d.date)];
    for (let h = 0; h < 24; h++) out[i * 24 + h] = shape[h];
  });
  const mean = out.reduce((a, b) => a + b, 0) / cal.total;
  for (let i = 0; i < out.length; i++) out[i] *= mean > 0 ? avgMw / mean : 0;
  return out;
}
