/**
 * Contratação ótima no mercado livre, com risco.
 *
 * O consumidor (ou a comercializadora que o atende) compra um volume flat q (MWmed, todas as horas)
 * a um preço P e liquida a diferença entre a carga e o contrato, hora a hora, ao PLD:
 *
 *     C_s(q) = Σ_m Σ_h D_m · [ q·P + (L_mh − q)·PLD_mhs ] = A_s + q·(H·P − T_s)
 *
 * com A_s o custo de comprar toda a carga ao PLD no cenário s e T_s a soma do PLD em todas as horas.
 * O custo é afim em q, então E[C] é linear e o CVaR é convexo em q; o volume ótimo minimiza
 * (1 − β)·E[C] + β·CVaR_α[C] (β = aversão a risco). Com β = 0 a resposta é de canto (tudo no
 * contrato se P < preço justo, nada se P > preço justo): contratar é proteção, não aposta.
 *
 * Cenários de preço: o nível mensal de cada cenário é lognormal com mediana no P50 e cauda alta no
 * P90 da faixa publicada pelo planejamento (/planejamento), com piso no PLD mínimo. Os meses andam
 * juntos por um fator comum (hidrologia): a correlação ρ é a implícita nos cenários do próprio SDDP
 * — a que faz a faixa da média de 12 meses ter a largura que o SDDP produziu. A forma horária é a
 * do PLD real do mesmo mês civil no último ano (desvio de cada hora à média do dia), somada ao nível,
 * limitada ao piso e ao teto horário e recentrada para a média do mês continuar sendo o nível.
 *
 * Risco de contraparte: se a comercializadora quebra no início do mês t, o volume do resto do
 * contrato volta a ser comprado ao PLD; a perda é a parte positiva do valor de mercado do contrato,
 * V_ts = q · Σ_{m≥t} 24·D_m·(PLD̄_ms − P). Exposição esperada EE_t = E[V⁺] e potencial PFE_t =
 * quantil 95% de V⁺ (a mesma métrica que bancos usam para limite e garantia de derivativos).
 */

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
}

/** MW médio por mês civil (0–11) e hora do dia (0–23); `covered[c]` diz se o mês tem dado próprio. */
export interface LoadProfile {
  mw: number[][];
  covered: boolean[];
}

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

/** Choques fixos: os mesmos para todo ρ, para a calibração e a comparação entre volumes serem suaves. */
export function shocks(n: number, months: number, seed = 20261030): Shocks {
  const r = rng(seed);
  const z = Float64Array.from({ length: n }, () => r.normal());
  const e = Array.from({ length: n }, () => Float64Array.from({ length: months }, () => r.normal()));
  return { z, e };
}

/** Mediana e dispersão lognormal do nível mensal: mediana no P50, cauda alta pelo P90. */
export function lognormal(b: MonthBand, floor: number): { mu: number; sigma: number } {
  const p50 = Math.max(b.p50 ?? floor, floor);
  const sigma = b.p90 !== null && b.p90 > p50 ? Math.log(b.p90 / p50) / Z90 : 0.05;
  return { mu: Math.log(p50), sigma };
}

/** Nível mensal (R$/MWh) por cenário × mês, com correlação ρ entre os meses e piso no PLD mínimo. */
export function monthlyLevels(bands: MonthBand[], rho: number, sh: Shocks, floors: number[]): Float64Array[] {
  const a = Math.sqrt(Math.min(Math.max(rho, 0), 1));
  const b = Math.sqrt(1 - a * a);
  const par = bands.map((x, m) => lognormal(x, floors[m]));
  return Array.from(sh.z, (z, s) => Float64Array.from(par, ({ mu, sigma }, m) => Math.max(floors[m], Math.exp(mu + sigma * (a * z + b * sh.e[s][m])))));
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
export function impliedRho(bands: MonthBand[], target: number, floors: number[], n = 1500): number | null {
  if (!Number.isFinite(target) || bands.length < 3) return null;
  const sh = shocks(n, bands.length, 7);
  const f = (rho: number) => spreadRatio(monthlyLevels(bands, rho, sh, floors));
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

const clampTo = (v: number, lim: Limits) => Math.min(lim.maxHourly, Math.max(lim.min, v));

/** As 24 horas do mês com média `level`: nível + desvio da hora, entre piso e teto, recentrado na média. */
export function hourlyPrices(level: number, dev: number[], lim: Limits): Float64Array {
  if (level <= lim.min) return new Float64Array(24).fill(lim.min);
  if (level >= lim.maxHourly) return new Float64Array(24).fill(lim.maxHourly);
  const mean = (d: number) => dev.reduce((acc, x) => acc + clampTo(level + d + x, lim), 0) / 24;
  let lo = lim.min - level - Math.max(...dev.map(Math.abs)) - 1;
  let hi = lim.maxHourly - level + Math.max(...dev.map(Math.abs)) + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (mean(mid) < level) lo = mid;
    else hi = mid;
  }
  const d = (lo + hi) / 2;
  return Float64Array.from(dev, (x) => clampTo(level + d + x, lim));
}

export interface ContractMonth {
  mes: string;
  band: MonthBand;
  lim: Limits;
}

export interface Simulation {
  months: string[];
  hoursByMonth: number[];
  hours: number; // H
  energyMwh: number;
  avgMw: number;
  /** Custo de comprar toda a carga ao PLD, por cenário (R$). */
  A: Float64Array;
  /** Soma do PLD em todas as horas do horizonte, por cenário (R$/MWh·h): custo spot de 1 MWmed flat. */
  T: Float64Array;
  /** PLD médio do mês por cenário (para a exposição de contraparte). */
  monthAvg: Float64Array[];
  n: number;
}

const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

export interface PriceScenarios {
  n: number;
  months: string[];
  cal: number[]; // mês civil (0–11) de cada mês do horizonte
  days: number[];
  /** PLD horário: índice (s·M + m)·24 + h. */
  prices: Float64Array;
}

/** Cenários de PLD horário dos próximos meses (não dependem da carga: calcula uma vez e reaproveita). */
export function priceScenarios(months: ContractMonth[], dev: number[][], rho: number, n = 2000, seed = 20261030): PriceScenarios {
  const M = months.length;
  const levels = monthlyLevels(
    months.map((m) => m.band),
    rho,
    shocks(n, M, seed),
    months.map((m) => m.lim.min),
  );
  const cal = months.map((m) => Number(m.mes.slice(5, 7)) - 1);
  const prices = new Float64Array(n * M * 24);
  for (let s = 0; s < n; s++) for (let m = 0; m < M; m++) prices.set(hourlyPrices(levels[s][m], dev[cal[m]], months[m].lim), (s * M + m) * 24);
  return { n, months: months.map((m) => m.mes), cal, days: months.map((m) => daysIn(m.mes)), prices };
}

/** Custo spot da carga em cada cenário de preço. */
export function simulateWith(ps: PriceScenarios, load: LoadProfile): Simulation {
  const { n, cal, days, prices } = ps;
  const M = cal.length;
  const A = new Float64Array(n);
  const T = new Float64Array(n);
  const monthAvg = Array.from({ length: n }, () => new Float64Array(M));
  let energy = 0;
  for (let m = 0; m < M; m++) for (let h = 0; h < 24; h++) energy += days[m] * load.mw[cal[m]][h];
  for (let s = 0; s < n; s++) {
    let a = 0;
    let t = 0;
    for (let m = 0; m < M; m++) {
      const o = (s * M + m) * 24;
      const L = load.mw[cal[m]];
      let sum = 0;
      for (let h = 0; h < 24; h++) {
        sum += prices[o + h];
        a += days[m] * L[h] * prices[o + h];
      }
      t += days[m] * sum;
      monthAvg[s][m] = sum / 24;
    }
    A[s] = a;
    T[s] = t;
  }
  const hoursByMonth = days.map((d) => d * 24);
  const hours = hoursByMonth.reduce((x, y) => x + y, 0);
  return { months: ps.months, hoursByMonth, hours, energyMwh: energy, avgMw: hours ? energy / hours : 0, A, T, monthAvg, n };
}

/** Cenários + custo spot da carga; `dev[c][h]` é o desvio horário do PLD no mês civil c. */
export function simulate(months: ContractMonth[], dev: number[][], load: LoadProfile, rho: number, n = 2000, seed = 20261030): Simulation {
  return simulateWith(priceScenarios(months, dev, rho, n, seed), load);
}

export interface RiskStats {
  q: number;
  mean: number;
  cvar: number;
  var: number;
  p05: number;
  p95: number;
}

export const costs = (sim: Simulation, q: number, price: number) => Float64Array.from(sim.A, (a, s) => a + q * (sim.hours * price - sim.T[s]));

/** Média, VaR e CVaR do custo (cauda alta: o lado ruim para quem compra). */
export function riskAt(sim: Simulation, q: number, price: number, alpha = 0.95): RiskStats {
  const c = costs(sim, q, price).sort();
  const n = c.length;
  const k = Math.max(1, Math.ceil((1 - alpha) * n));
  let tail = 0;
  for (let i = n - k; i < n; i++) tail += c[i];
  const mean = c.reduce((x, y) => x + y, 0) / n;
  return { q, mean, cvar: tail / k, var: c[n - k], p05: quantile(c, 0.05), p95: quantile(c, 0.95) };
}

export interface ContractResult {
  fairFlat: number; // R$/MWh: PLD médio esperado no tempo (preço justo do contrato flat)
  captureLoad: number; // R$/MWh: PLD médio esperado ponderado pela carga
  profileCost: number; // R$/MWh: captura da carga − preço justo flat
  qOpt: number;
  hedgeRatio: number;
  opt: RiskStats;
  spot: RiskStats; // q = 0
  full: RiskStats; // q = carga média
  frontier: RiskStats[];
}

/** Volume ótimo: mínimo de (1 − β)·E + β·CVaR em [0, qMax] (convexo: grade + seção áurea). */
export function optimize(sim: Simulation, price: number, beta: number, alpha = 0.95, qMaxFactor = 1.5): ContractResult {
  const qMax = Math.max(sim.avgMw * qMaxFactor, 1e-6);
  const obj = (r: RiskStats) => (1 - beta) * r.mean + beta * r.cvar;
  const frontier = Array.from({ length: 31 }, (_, i) => riskAt(sim, (qMax * i) / 30, price, alpha));
  let best = frontier.reduce((a, b) => (obj(b) < obj(a) ? b : a));
  let lo = Math.max(0, best.q - qMax / 30);
  let hi = Math.min(qMax, best.q + qMax / 30);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = obj(riskAt(sim, x1, price, alpha));
  let f2 = obj(riskAt(sim, x2, price, alpha));
  for (let i = 0; i < 40; i++) {
    if (f1 <= f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = obj(riskAt(sim, x1, price, alpha));
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = obj(riskAt(sim, x2, price, alpha));
    }
  }
  const refined = riskAt(sim, (lo + hi) / 2, price, alpha);
  if (obj(refined) < obj(best)) best = refined;
  const meanT = sim.T.reduce((x, y) => x + y, 0) / sim.n;
  const meanA = sim.A.reduce((x, y) => x + y, 0) / sim.n;
  const fairFlat = meanT / sim.hours;
  const captureLoad = sim.energyMwh ? meanA / sim.energyMwh : NaN;
  return {
    fairFlat,
    captureLoad,
    profileCost: captureLoad - fairFlat,
    qOpt: best.q,
    hedgeRatio: sim.avgMw ? best.q / sim.avgMw : NaN,
    opt: best,
    spot: riskAt(sim, 0, price, alpha),
    full: riskAt(sim, sim.avgMw, price, alpha),
    frontier,
  };
}

export interface Exposure {
  mes: string;
  ee: number; // exposição esperada (R$)
  pfe: number; // exposição potencial 95% (R$)
  mtm: number; // valor de mercado esperado do resto do contrato (R$)
}

/** Perda se a comercializadora quebrar no início de cada mês: reposição do resto do contrato ao PLD. */
export function counterpartyExposure(sim: Simulation, q: number, price: number, pfeLevel = 0.95): Exposure[] {
  const M = sim.months.length;
  return sim.months.map((mes, t) => {
    const pos = new Float64Array(sim.n);
    let mtm = 0;
    for (let s = 0; s < sim.n; s++) {
      let v = 0;
      for (let m = t; m < M; m++) v += sim.hoursByMonth[m] * (sim.monthAvg[s][m] - price);
      v *= q;
      mtm += v;
      pos[s] = Math.max(0, v);
    }
    return { mes, ee: pos.reduce((a, b) => a + b, 0) / sim.n, pfe: quantile(pos, pfeLevel), mtm: mtm / sim.n };
  });
}

/** Histograma comum do custo em R$/MWh de carga para alguns volumes. */
export function costHistogram(sim: Simulation, price: number, qs: number[], bins = 28): { edges: number[]; counts: number[][] } {
  const per = qs.map((q) => Array.from(costs(sim, q, price), (c) => c / sim.energyMwh));
  const lo = Math.min(...per.map((v) => quantile(v, 0.005)));
  const hi = Math.max(...per.map((v) => quantile(v, 0.995)));
  const w = (hi - lo) / bins || 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  const counts = per.map((v) => {
    const c = new Array(bins).fill(0);
    for (const x of v) c[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++;
    return c.map((k) => k / v.length);
  });
  return { edges, counts };
}

/** Perfis típicos (exemplo, sem sazonalidade) para quem ainda não tem a curva de carga. */
export const TYPICAL: Record<"comercial" | "industrial24" | "industrial2t", { label: string; shape: number[] }> = {
  comercial: {
    label: "Comércio (horário comercial)",
    shape: [0.35, 0.33, 0.32, 0.32, 0.33, 0.36, 0.45, 0.65, 0.95, 1.05, 1.1, 1.12, 1.1, 1.12, 1.12, 1.1, 1.05, 0.95, 0.8, 0.65, 0.55, 0.48, 0.42, 0.38],
  },
  industrial24: {
    label: "Indústria 24 h (evita a ponta)",
    shape: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1],
  },
  industrial2t: {
    label: "Indústria em 2 turnos (6h–22h)",
    shape: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.25, 0.25],
  },
};

export function typicalProfile(kind: keyof typeof TYPICAL, avgMw: number): LoadProfile {
  const s = TYPICAL[kind].shape;
  const k = avgMw / (s.reduce((a, b) => a + b, 0) / 24);
  return { mw: Array.from({ length: 12 }, () => s.map((x) => x * k)), covered: new Array(12).fill(true) };
}
