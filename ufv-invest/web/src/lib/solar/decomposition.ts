/**
 * Decomposição da irradiação: fração difusa e distribuição intradiária.
 *
 * Referências:
 *  - Erbs, D. G., Klein, S. A. & Duffie, J. A. (1982). Estimation of the diffuse radiation fraction for
 *    hourly, daily and monthly-average global radiation. Solar Energy 28(4):293–302. (D&B Eqs. 2.10.1,
 *    2.11.1 e 2.12.1)
 *  - Collares-Pereira, M. & Rabl, A. (1979). The average distribution of solar radiation — correlations
 *    between diffuse and hemispherical and between daily and hourly insolation values. Solar Energy
 *    22:155–164. (D&B Eq. 2.13.2)
 *  - Liu, B. Y. H. & Jordan, R. C. (1960). The interrelationship and characteristic distribution of direct,
 *    diffuse and total solar radiation. Solar Energy 4(3):1–19. (D&B Eq. 2.13.1)
 *  - Bendt, P., Collares-Pereira, M. & Rabl, A. (1981). The frequency distribution of daily insolation
 *    values. Solar Energy 27(1):1–5. (D&B §2.11)
 */

import { DEG } from "./geometry";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Fração difusa média mensal H̄d/H̄ — Erbs et al. (1982), D&B Eq. 2.12.1, em função do índice de
 * claridade médio mensal K̄T e do ângulo do pôr do sol ωs. Validade 0,3 ≤ K̄T ≤ 0,8 (fora disso o
 * K̄T é limitado ao intervalo).
 */
export function erbsMonthlyDiffuseFraction(kTbar: number, sunsetHourAngleDeg: number): number {
  const k = clamp(kTbar, 0.3, 0.8);
  if (sunsetHourAngleDeg <= 81.4) return 1.391 - 3.56 * k + 4.189 * k * k - 2.137 * k ** 3;
  return 1.311 - 3.022 * k + 3.427 * k * k - 1.821 * k ** 3;
}

/** Fração difusa diária Hd/H — Erbs et al. (1982), D&B Eq. 2.11.1 */
export function erbsDailyDiffuseFraction(kT: number, sunsetHourAngleDeg: number): number {
  const k = Math.max(0, kT);
  if (sunsetHourAngleDeg <= 81.4) {
    if (k < 0.715) return clamp(1.0 - 0.2727 * k + 2.4495 * k * k - 11.9514 * k ** 3 + 9.3879 * k ** 4, 0, 1);
    return 0.143;
  }
  if (k < 0.722) return clamp(1.0 + 0.2832 * k - 2.5557 * k * k + 0.8448 * k ** 3, 0, 1);
  return 0.175;
}

/** Fração difusa horária Id/I — Erbs et al. (1982), D&B Eq. 2.10.1 (usada no modelo instantâneo) */
export function erbsHourlyDiffuseFraction(kt: number): number {
  const k = Math.max(0, kt);
  if (k <= 0.22) return 1.0 - 0.09 * k;
  if (k <= 0.8) return 0.9511 - 0.1604 * k + 4.388 * k * k - 16.638 * k ** 3 + 12.336 * k ** 4;
  return 0.165;
}

function cprDenominator(wsDeg: number): number {
  return Math.sin(wsDeg * DEG) - ((Math.PI * wsDeg) / 180) * Math.cos(wsDeg * DEG);
}

/**
 * r_t de Collares-Pereira & Rabl (1979): razão entre a irradiação global horária (centrada no ângulo
 * horário ω) e a diária. Interpretável como taxa instantânea, em 1/h:
 *   r_t = (π/24)(a + b cos ω)(cos ω − cos ωs) / (sen ωs − (π ωs/180) cos ωs)
 *   a = 0,409 + 0,5016 sen(ωs − 60°);  b = 0,6609 − 0,4767 sen(ωs − 60°)
 */
export function collaresPereiraRablRt(hourAngleDeg: number, sunsetHourAngleDeg: number): number {
  const ws = sunsetHourAngleDeg;
  if (Math.abs(hourAngleDeg) >= ws || ws <= 0) return 0;
  const a = 0.409 + 0.5016 * Math.sin((ws - 60) * DEG);
  const b = 0.6609 - 0.4767 * Math.sin((ws - 60) * DEG);
  const cw = Math.cos(hourAngleDeg * DEG);
  return ((Math.PI / 24) * (a + b * cw) * (cw - Math.cos(ws * DEG))) / cprDenominator(ws);
}

/** r_d de Liu & Jordan (1960): mesma forma para a difusa, sem o termo (a + b cos ω), em 1/h */
export function liuJordanRd(hourAngleDeg: number, sunsetHourAngleDeg: number): number {
  const ws = sunsetHourAngleDeg;
  if (Math.abs(hourAngleDeg) >= ws || ws <= 0) return 0;
  return ((Math.PI / 24) * (Math.cos(hourAngleDeg * DEG) - Math.cos(ws * DEG))) / cprDenominator(ws);
}

/**
 * Perfil intradiário discretizado entre o nascer e o pôr do sol: `steps` passos iguais em ω,
 * avaliados no ponto médio. Devolve r_t·Δt e r_d·Δt já RENORMALIZADOS para somar exatamente 1
 * (a integral bruta de r_t vale ≈ 0,99–1,01; a de r_d vale 1 analiticamente).
 */
export function intradayProfile(
  sunsetHourAngleDeg: number,
  steps: number,
): { hourAngleDeg: number[]; dtHours: number; ft: number[]; fd: number[]; rawSumT: number; rawSumD: number } {
  const ws = sunsetHourAngleDeg;
  const dW = (2 * ws) / steps;
  const dtHours = dW / 15;
  const hourAngleDeg: number[] = [];
  const ft: number[] = [];
  const fd: number[] = [];
  let st = 0;
  let sd = 0;
  for (let j = 0; j < steps; j++) {
    const w = -ws + (j + 0.5) * dW;
    const rt = collaresPereiraRablRt(w, ws) * dtHours;
    const rd = liuJordanRd(w, ws) * dtHours;
    hourAngleDeg.push(w);
    ft.push(rt);
    fd.push(rd);
    st += rt;
    sd += rd;
  }
  for (let j = 0; j < steps; j++) {
    ft[j] = st > 0 ? ft[j] / st : 0;
    fd[j] = sd > 0 ? fd[j] / sd : 0;
  }
  return { hourAngleDeg, dtHours, ft, fd, rawSumT: st, rawSumD: sd };
}

/**
 * Frações horárias (24 horas solares, 0 = 00h–01h) de r_t e r_d, integradas por sub-passos dentro de
 * cada hora e renormalizadas para somar 1. Útil para gráficos e para testes de consistência.
 */
export function hourlyFractions(sunsetHourAngleDeg: number): { rt: number[]; rd: number[]; rawSumT: number; rawSumD: number } {
  const sub = 60;
  const rt = new Array<number>(24).fill(0);
  const rd = new Array<number>(24).fill(0);
  let st = 0;
  let sd = 0;
  for (let h = 0; h < 24; h++) {
    for (let k = 0; k < sub; k++) {
      const tSolar = h + (k + 0.5) / sub;
      const w = 15 * (tSolar - 12);
      const a = collaresPereiraRablRt(w, sunsetHourAngleDeg) / sub;
      const d = liuJordanRd(w, sunsetHourAngleDeg) / sub;
      rt[h] += a;
      rd[h] += d;
    }
    st += rt[h];
    sd += rd[h];
  }
  return { rt: rt.map((x) => (st > 0 ? x / st : 0)), rd: rd.map((x) => (sd > 0 ? x / sd : 0)), rawSumT: st, rawSumD: sd };
}

// ─── Distribuição de frequência do índice de claridade diário (Bendt et al., 1981) ─────────────

/** K_T,min e K_T,max de Bendt et al. (1981) */
export function bendtBounds(kTbar: number): { min: number; max: number } {
  return { min: 0.05, max: 0.6313 + 0.267 * kTbar - 11.9 * (kTbar - 0.75) ** 8 };
}

/** Média de K numa densidade ∝ exp(γK) restrita a [a, b] */
function truncExpMean(gamma: number, a: number, b: number): number {
  if (Math.abs(gamma) < 1e-8) return (a + b) / 2;
  // forma estável: subtrai o maior expoente
  const m = Math.max(gamma * a, gamma * b);
  const ea = Math.exp(gamma * a - m);
  const eb = Math.exp(gamma * b - m);
  return ((b - 1 / gamma) * eb - (a - 1 / gamma) * ea) / (eb - ea);
}

/** γ da distribuição de Bendt et al. (1981) tal que a média seja K̄T (bisseção; média é monótona em γ) */
export function bendtGamma(kTbar: number): number {
  const { min, max } = bendtBounds(kTbar);
  const target = clamp(kTbar, min + 1e-3, max - 1e-3);
  let lo = -200;
  let hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (truncExpMean(mid, min, max) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

/**
 * Dias-tipo equiprováveis: divide a distribuição de Bendt et al. (1981) em `n` faixas de igual
 * probabilidade e devolve a média condicional de K_T em cada uma (do dia mais nublado ao mais claro).
 * A média dos dias-tipo é K̄T (renormalizada para eliminar o erro numérico residual).
 */
export function clearnessDayTypes(kTbar: number, n = 5): number[] {
  if (!(kTbar > 0)) return new Array<number>(n).fill(0);
  const { min, max } = bendtBounds(kTbar);
  if (kTbar <= min || kTbar >= max) return new Array<number>(n).fill(kTbar);
  const g = bendtGamma(kTbar);
  const inv = (F: number) => {
    if (Math.abs(g) < 1e-8) return min + F * (max - min);
    // K(F) = (1/γ) ln(e^{γa} + F (e^{γb} − e^{γa})), em forma estável
    const m = Math.max(g * min, g * max);
    const ea = Math.exp(g * min - m);
    const eb = Math.exp(g * max - m);
    return (Math.log(ea + F * (eb - ea)) + m) / g;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k1 = inv(i / n);
    const k2 = inv((i + 1) / n);
    out.push(truncExpMean(g, k1, k2));
  }
  const mean = out.reduce((s, x) => s + x, 0) / n;
  return out.map((x) => (x * kTbar) / mean);
}

// ─── Teto de céu claro ───────────────────────────────────────────────────────────────────────

/**
 * GHI de céu claro, W/m² — Haurwitz, B. (1945). Insolation in relation to cloudiness and cloud
 * density. J. Meteorology 2:154–166:  G_cs = 1098 · cos θz · exp(−0,057 / cos θz).
 * Modelo de um parâmetro (só geometria) com bom desempenho entre os modelos simples (Reno, Hansen &
 * Stein, 2012, SAND2012-2389). Usado como TETO físico dos dias-tipo e do perfil intradiário.
 */
export function haurwitzGhiWm2(cosZ: number): number {
  return cosZ > 0 ? 1098 * cosZ * Math.exp(-0.057 / cosZ) : 0;
}

/**
 * Limita os dias-tipo ao índice de claridade de céu claro `kCap` e redistribui o excedente aos dias
 * abaixo do teto, proporcionalmente à folga de cada um — a média (K̄T) é preservada exatamente.
 * A expressão de K_T,max de Bendt et al. (1981) foi ajustada a estações dos EUA (ar mais seco); nos
 * trópicos úmidos ela produz dias "mais claros que o céu claro", o que superestimaria o clipping.
 * Se K̄T ≥ kCap (local mais límpido que o modelo de céu claro), os dias-tipo não são alterados.
 */
export function capDayTypes(types: number[], kCap: number): number[] {
  const n = types.length;
  const mean = types.reduce((s, x) => s + x, 0) / n;
  if (!(kCap > 0) || mean >= kCap) return types.slice();
  let excess = 0;
  const capped = types.map((k) => {
    if (k > kCap) {
      excess += k - kCap;
      return kCap;
    }
    return k;
  });
  if (excess <= 0) return capped;
  const room = capped.reduce((s, k) => s + (kCap - k), 0);
  return capped.map((k) => k + (excess * (kCap - k)) / room);
}

/**
 * Impõe um teto instantâneo ao perfil `g` (mesma unidade de `ceiling`) preservando a soma: o que
 * excede o teto é redistribuído aos demais passos proporcionalmente à folga. Se a soma do perfil
 * exceder a do teto (inviável), devolve o perfil inalterado.
 */
export function waterfillUnderCeiling(g: number[], ceiling: number[]): number[] {
  const out = g.slice();
  let excess = 0;
  let room = 0;
  for (let j = 0; j < out.length; j++) {
    if (out[j] > ceiling[j]) {
      excess += out[j] - ceiling[j];
      out[j] = ceiling[j];
    }
  }
  if (excess <= 0) return out;
  for (let j = 0; j < out.length; j++) room += Math.max(0, ceiling[j] - out[j]);
  if (room < excess) return g.slice();
  for (let j = 0; j < out.length; j++) out[j] += (excess * Math.max(0, ceiling[j] - out[j])) / room;
  return out;
}
