/**
 * Geometria solar.
 *
 * Referências:
 *  - Duffie, J. A. & Beckman, W. A. (2013). Solar Engineering of Thermal Processes, 4ª ed. Wiley — cap. 1
 *    (doravante "D&B"). Convenção de D&B para o ângulo horário: ω < 0 de manhã, ω > 0 à tarde, ω = 0 ao
 *    meio-dia solar.
 *  - Spencer, J. W. (1971). Fourier series representation of the position of the Sun. Search 2(5):172.
 *  - Cooper, P. I. (1969). The absorption of radiation in solar stills. Solar Energy 12:333–346.
 *  - Klein, S. A. (1977). Calculation of monthly average insolation on tilted surfaces. Solar Energy 19:325–329.
 *  - Meeus, J. (1998). Astronomical Algorithms, 2ª ed. — base do NOAA Solar Calculator (NOAA GML).
 *  - Kopp, G. & Lean, J. L. (2011). A new, lower value of total solar irradiance. GRL 38, L01706.
 *
 * Azimute solar devolvido SEMPRE em convenção de bússola (0 = Norte, 90 = Leste, 180 = Sul,
 * 270 = Oeste), como o resto do domínio (ver cabeçalho de lib/types.ts). A convenção de D&B
 * (γ = 0 ao Sul, Leste negativo, Oeste positivo) relaciona-se por γ_D&B = Az_bússola − 180°.
 */

export const DEG = Math.PI / 180;

/** Constante solar, W/m² — Kopp & Lean (2011), valor adotado por D&B na 4ª ed. */
export const SOLAR_CONSTANT_WM2 = 1361;

/** Dias de cada mês num ano de 365 dias (climatologia) */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Dia do ano "médio" recomendado para cada mês — Klein (1977), D&B Tabela 1.6.1: o dia cuja H₀ mais
 * se aproxima da média mensal de H₀.
 */
export const KLEIN_MEAN_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344] as const;

const sind = (x: number) => Math.sin(x * DEG);
const cosd = (x: number) => Math.cos(x * DEG);
const tand = (x: number) => Math.tan(x * DEG);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Declinação solar, graus — série de Fourier de Spencer (1971), D&B Eq. 1.6.1b */
export function declinationDeg(dayOfYear: number): number {
  const B = ((dayOfYear - 1) * 2 * Math.PI) / 365;
  const rad =
    0.006918 -
    0.399912 * Math.cos(B) +
    0.070257 * Math.sin(B) -
    0.006758 * Math.cos(2 * B) +
    0.000907 * Math.sin(2 * B) -
    0.002697 * Math.cos(3 * B) +
    0.00148 * Math.sin(3 * B);
  return rad / DEG;
}

/** Declinação solar, graus — Cooper (1969), D&B Eq. 1.6.1a (forma simples, para conferência) */
export function declinationCooperDeg(dayOfYear: number): number {
  return 23.45 * sind((360 * (284 + dayOfYear)) / 365);
}

/** Equação do tempo, minutos — Spencer (1971) em Iqbal (1983), D&B Eq. 1.5.3 */
export function equationOfTimeMin(dayOfYear: number): number {
  const B = ((dayOfYear - 1) * 2 * Math.PI) / 365;
  return 229.2 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) - 0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B));
}

/** Fator de correção da distância Terra-Sol (excentricidade), D&B Eq. 1.4.1a */
export function eccentricityFactor(dayOfYear: number): number {
  return 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
}

/** Irradiância extraterrestre normal, W/m² */
export function extraterrestrialNormalWm2(dayOfYear: number): number {
  return SOLAR_CONSTANT_WM2 * eccentricityFactor(dayOfYear);
}

/**
 * Ângulo horário do pôr do sol ωs, graus — D&B Eq. 1.6.10: cos ωs = −tan φ · tan δ.
 * Devolve 0 na noite polar e 180 no dia polar.
 */
export function sunsetHourAngleDeg(latDeg: number, declDeg: number): number {
  const x = -tand(latDeg) * tand(declDeg);
  if (x >= 1) return 0;
  if (x <= -1) return 180;
  return Math.acos(x) / DEG;
}

/**
 * Irradiação extraterrestre diária sobre plano horizontal H₀, MJ/m² — D&B Eq. 1.10.3:
 * H₀ = (24·3600·Gsc/π)·(1 + 0,033 cos(360n/365))·(cos φ cos δ sen ωs + (π ωs/180) sen φ sen δ).
 */
export function extraterrestrialDailyMJm2(latDeg: number, dayOfYear: number): number {
  const decl = declinationDeg(dayOfYear);
  const ws = sunsetHourAngleDeg(latDeg, decl);
  const h0 =
    ((24 * 3600 * SOLAR_CONSTANT_WM2) / Math.PI) *
    eccentricityFactor(dayOfYear) *
    (cosd(latDeg) * cosd(decl) * sind(ws) + ((Math.PI * ws) / 180) * sind(latDeg) * sind(decl));
  return Math.max(0, h0) / 1e6;
}

/** H₀ em kWh/m² (1 kWh = 3,6 MJ) */
export function extraterrestrialDailyKWhm2(latDeg: number, dayOfYear: number): number {
  return extraterrestrialDailyMJm2(latDeg, dayOfYear) / 3.6;
}

/** cos do ângulo zenital — D&B Eq. 1.6.5: cos θz = cos φ cos δ cos ω + sen φ sen δ */
export function cosZenith(latDeg: number, declDeg: number, hourAngleDeg: number): number {
  return cosd(latDeg) * cosd(declDeg) * cosd(hourAngleDeg) + sind(latDeg) * sind(declDeg);
}

/**
 * Azimute solar em bússola (0 = N, 90 = L, 180 = S, 270 = O).
 * Forma com atan2 equivalente a D&B Eq. 1.6.6 (γs = sinal(ω)·|acos(...)|, γs = 0 ao Sul):
 *   γs = atan2(sen ω · cos δ, cos ω · sen φ · cos δ − sen δ · cos φ);  Az = γs + 180°.
 * Válida nos dois hemisférios; não sofre de divisão por zero no zênite.
 */
export function solarAzimuthCompassDeg(latDeg: number, declDeg: number, hourAngleDeg: number): number {
  const gammaS =
    Math.atan2(sind(hourAngleDeg) * cosd(declDeg), cosd(hourAngleDeg) * sind(latDeg) * cosd(declDeg) - sind(declDeg) * cosd(latDeg)) / DEG;
  return mod(gammaS + 180, 360);
}

/** Dia do ano (1..366) em UTC */
export function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

export interface SunPositionDetailed {
  zenithDeg: number;
  elevationDeg: number;
  azimuthDeg: number;
  declinationDeg: number;
  hourAngleDeg: number;
  equationOfTimeMin: number;
  /** irradiância extraterrestre normal no instante, W/m² */
  extraterrestrialWm2: number;
}

/**
 * Posição do Sol para um instante arbitrário — algoritmo do NOAA Solar Calculator (Meeus, 1998):
 * longitude aparente, obliquidade corrigida, declinação e equação do tempo a partir do século
 * juliano; hora solar verdadeira = UTC + EoT + 4·longitude. Exatidão ≈ 0,01° em 1800–2100,
 * mais do que suficiente para irradiância. Posição geométrica (sem refração atmosférica, que
 * altera a elevação em < 0,6° só junto ao horizonte).
 */
export function sunPositionDetailed(date: Date, latDeg: number, lonDeg: number): SunPositionDetailed {
  const ms = date.getTime();
  const jd = ms / 86_400_000 + 2_440_587.5;
  const T = (jd - 2_451_545) / 36_525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sind(2 * M) * (0.019993 - 0.000101 * T) + sind(3 * M) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * sind(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosd(omega);
  const decl = Math.asin(sind(eps) * sind(lambda)) / DEG;
  const y = Math.tan((eps / 2) * DEG) ** 2;
  const l0 = L0 * DEG;
  const m = M * DEG;
  const eotMin =
    (4 / DEG) *
    (y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m));
  // distância Terra-Sol (UA) para a irradiância extraterrestre
  const vRad = (M + C) * DEG;
  const rAU = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(vRad));

  const utcMin = mod(ms / 60_000, 1440);
  const trueSolarMin = mod(utcMin + eotMin + 4 * lonDeg, 1440);
  const hourAngle = trueSolarMin / 4 - 180;

  const cz = clamp(cosZenith(latDeg, decl, hourAngle), -1, 1);
  const zenith = Math.acos(cz) / DEG;
  return {
    zenithDeg: zenith,
    elevationDeg: 90 - zenith,
    azimuthDeg: solarAzimuthCompassDeg(latDeg, decl, hourAngle),
    declinationDeg: decl,
    hourAngleDeg: hourAngle,
    equationOfTimeMin: eotMin,
    extraterrestrialWm2: SOLAR_CONSTANT_WM2 / (rAU * rAU),
  };
}

/** Posição do Sol: zênite, elevação e azimute de bússola (0 = Norte), em graus */
export function sunPosition(date: Date, lat: number, lon: number): { zenithDeg: number; elevationDeg: number; azimuthDeg: number } {
  const p = sunPositionDetailed(date, lat, lon);
  return { zenithDeg: p.zenithDeg, elevationDeg: p.elevationDeg, azimuthDeg: p.azimuthDeg };
}
