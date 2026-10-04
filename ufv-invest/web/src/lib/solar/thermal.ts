/**
 * Temperatura ambiente horária e temperatura de célula.
 *
 * Referências:
 *  - Faiman, D. (2008). Assessing the outdoor operating temperature of photovoltaic modules. Progress in
 *    Photovoltaics 16(4):307–315. Coeficientes U0 = 25 W/m²K e U1 = 6,84 W·s/m³K (ajuste de Faiman para
 *    módulos c-Si em estrutura aberta; também os padrões do IEC 61853-2 / pvlib).
 *  - Perfil diurno: meia-cossenoide entre a mínima (no nascer do sol) e a máxima (~15h solar), forma
 *    usual em modelos de dia típico (cf. Parton, W. J. & Logan, J. A. (1981), Agric. Meteorol. 23:205–216,
 *    em versão simplificada simétrica).
 */

export const FAIMAN_U0 = 25;
export const FAIMAN_U1 = 6.84;
/** vento padrão quando a climatologia não traz velocidade do vento, m/s */
export const DEFAULT_WIND_MS = 2;
/** semi-amplitude diária padrão quando faltam Tmáx/Tmín, °C */
export const DEFAULT_HALF_AMPLITUDE_C = 5;
/** hora solar da temperatura máxima */
export const T_MAX_SOLAR_HOUR = 15;

/**
 * Temperatura ambiente na hora solar `tSolarH` (0..24): Tmín no nascer do sol, Tmáx às 15h solares,
 * meia-cossenoide crescente entre ambos e decrescente das 15h até o nascer do dia seguinte. A média
 * diária do perfil é exatamente (Tmín + Tmáx)/2.
 */
export function ambientTemperatureC(tSolarH: number, sunriseSolarH: number, tMinC: number, tMaxC: number): number {
  const sr = Math.min(9, Math.max(3, sunriseSolarH));
  let t = tSolarH;
  if (t < sr) t += 24;
  const amp = tMaxC - tMinC;
  if (t <= T_MAX_SOLAR_HOUR) {
    const x = (t - sr) / (T_MAX_SOLAR_HOUR - sr);
    return tMinC + amp * 0.5 * (1 - Math.cos(Math.PI * x));
  }
  const x = (t - T_MAX_SOLAR_HOUR) / (sr + 24 - T_MAX_SOLAR_HOUR);
  return tMaxC - amp * 0.5 * (1 - Math.cos(Math.PI * x));
}

/** Temperatura de célula — Faiman (2008): Tc = Ta + G_POA / (U0 + U1·v) */
export function faimanCellTempC(poaWm2: number, ambientC: number, windMs: number, u0 = FAIMAN_U0, u1 = FAIMAN_U1): number {
  return ambientC + Math.max(0, poaWm2) / (u0 + u1 * Math.max(0, windMs));
}
