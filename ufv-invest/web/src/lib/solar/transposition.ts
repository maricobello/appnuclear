/**
 * Irradiância no plano dos módulos (POA): orientação da superfície (fixa ou seguidor de um eixo),
 * transposição anisotrópica HDKR e modificador de ângulo de incidência (IAM).
 *
 * Referências:
 *  - Duffie & Beckman (2013), §1.6 (ângulo de incidência) e §2.16 (modelo HDKR, Eq. 2.16.7).
 *  - Hay, J. E. & Davies, J. A. (1980). Calculation of the solar radiation incident on an inclined surface.
 *    Proc. First Canadian Solar Radiation Data Workshop, 59–72.
 *  - Klucher, T. M. (1979). Evaluation of models to predict insolation on tilted surfaces. Solar Energy 23:111–114.
 *  - Reindl, D. T., Beckman, W. A. & Duffie, J. A. (1990). Evaluation of hourly tilted surface radiation
 *    models. Solar Energy 45(1):9–17.
 *  - Marion, W. F. & Dobos, A. P. (2013). Rotation Angle for the Optimum Tracking of One-Axis Trackers.
 *    NREL/TP-6A20-58891.
 *  - Lorenzo, E., Narvarte, L. & Muñoz, J. (2011). Tracking and back-tracking. Prog. Photovolt. 19:747–753.
 *  - Anderson, K. & Mikofski, M. (2020). Slope-Aware Backtracking for Single-Axis Trackers. NREL/TP-5K00-76626.
 *  - Martin, N. & Ruiz, J. M. (2001). Calculation of the PV modules angular losses under field conditions by
 *    means of an analytical model. Solar Energy Materials & Solar Cells 70:25–38.
 *
 * Convenção: vetores em coordenadas locais (Leste, Norte, Zênite). Azimutes em bússola (0 = Norte).
 * O cos do ângulo de incidência é o produto escalar sol·normal:
 *   cos θ = cos θz cos β + sen θz sen β cos(Az_sol − Az_sup)
 * — idêntico a D&B Eq. 1.6.3 com γ_D&B = Az_bússola − 180°, mas sem ambiguidade de hemisfério:
 * no Brasil uma superfície voltada para o Norte tem Az_sup = 0 (γ_D&B = 180°).
 */

import { DEG } from "./geometry";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Posição do Sol já reduzida ao necessário para a transposição */
export interface SunVector {
  cosZ: number;
  sinZ: number;
  /** azimute solar em bússola, graus */
  azimuthDeg: number;
}

export interface Surface {
  tiltDeg: number;
  /** azimute da normal em bússola (0 = Norte) */
  azimuthDeg: number;
}

export function sunVectorFromAngles(zenithDeg: number, azimuthDeg: number): SunVector {
  return { cosZ: Math.cos(zenithDeg * DEG), sinZ: Math.sin(zenithDeg * DEG), azimuthDeg };
}

/** cos do ângulo de incidência na superfície */
export function cosIncidence(sun: SunVector, surf: Surface): number {
  return sun.cosZ * Math.cos(surf.tiltDeg * DEG) + sun.sinZ * Math.sin(surf.tiltDeg * DEG) * Math.cos((sun.azimuthDeg - surf.azimuthDeg) * DEG);
}

// ─── Seguidor de um eixo horizontal ──────────────────────────────────────────────────────────

/**
 * Razão de ocupação do solo (GCR = largura da fileira / distância entre eixos) ASSUMIDA para
 * seguidores de um eixo: 0,35 — valor típico de projetos utility/minigeração com backtracking no
 * Brasil (pitch ≈ 6,5 m para mesas 2P de ≈ 2,3 m). Não consta do cadastro da usina; ajustar quando
 * houver projeto executivo.
 */
export const TRACKER_GCR = 0.35;

/**
 * Ângulo de rotação de um seguidor de eixo HORIZONTAL com azimute de eixo `axisAzimuthDeg`
 * (0 = eixo Norte-Sul). Positivo = módulos inclinados para o lado "à direita" do eixo, isto é, para
 * Az_eixo + 90° (Leste num eixo N-S).
 *
 * 1. Rastreamento verdadeiro (Marion & Dobos 2013, Eq. 7 com eixo horizontal): R = atan2(s·e, s·z),
 *    projeção do vetor solar no plano perpendicular ao eixo.
 * 2. Backtracking sem declividade transversal (Lorenzo et al. 2011; Anderson & Mikofski 2020, Eq. 14):
 *    se |cos R| / GCR < 1, R ← R − sinal(R)·acos(|cos R| / GCR) — evita sombreamento entre fileiras.
 * 3. Limite mecânico ±maxAngle (aplicado após o backtracking, como no pvlib).
 */
export function singleAxisRotationDeg(sun: SunVector, axisAzimuthDeg: number, maxAngleDeg: number, gcr = TRACKER_GCR, backtrack = true): number {
  if (sun.cosZ <= 0) return 0;
  const az = sun.azimuthDeg * DEG;
  const ax = axisAzimuthDeg * DEG;
  // vetor solar (E, N, Z)
  const sx = sun.sinZ * Math.sin(az);
  const sy = sun.sinZ * Math.cos(az);
  // e = direção horizontal perpendicular ao eixo (Az_eixo + 90°)
  const ex = Math.cos(ax);
  const ey = -Math.sin(ax);
  const se = sx * ex + sy * ey;
  let r = Math.atan2(se, sun.cosZ) / DEG;
  if (backtrack && gcr > 0) {
    const temp = Math.abs(Math.cos(r * DEG)) / gcr;
    if (temp < 1) r = r - Math.sign(r) * (Math.acos(temp) / DEG);
  }
  return clamp(r, -maxAngleDeg, maxAngleDeg);
}

/** Superfície equivalente (inclinação e azimute) de um seguidor com rotação R */
export function trackerSurface(rotationDeg: number, axisAzimuthDeg: number): Surface {
  const tilt = Math.abs(rotationDeg);
  const az = rotationDeg >= 0 ? axisAzimuthDeg + 90 : axisAzimuthDeg + 270;
  return { tiltDeg: tilt, azimuthDeg: ((az % 360) + 360) % 360 };
}

// ─── Modificador de ângulo de incidência (Martin & Ruiz 2001) ────────────────────────────────

/** Coeficiente angular a_r para vidro padrão limpo (Martin & Ruiz 2001; padrão do pvlib) */
export const MARTIN_RUIZ_AR = 0.16;

/** IAM da componente direta: (1 − exp(−cos θ / a_r)) / (1 − exp(−1 / a_r)) */
export function iamBeam(cosAoi: number, ar = MARTIN_RUIZ_AR): number {
  if (cosAoi <= 0) return 0;
  return (1 - Math.exp(-cosAoi / ar)) / (1 - Math.exp(-1 / ar));
}

/**
 * IAM da difusa do céu e da refletida pelo solo — aproximações analíticas de Martin & Ruiz (2001),
 * c1 = 4/(3π), c2 = 0,5·a_r − 0,154:
 *   X_céu  = sen β + (π − β − sen β)/(1 + cos β);  X_solo = sen β + (β − sen β)/(1 − cos β)
 *   IAM = 1 − exp(−(c1 + c2 X) X / a_r)
 */
export function iamDiffuse(tiltDeg: number, ar = MARTIN_RUIZ_AR): { sky: number; ground: number } {
  const beta = clamp(tiltDeg, 0, 180) * DEG;
  const c1 = 4 / (3 * Math.PI);
  const c2 = 0.5 * ar - 0.154;
  const sinB = Math.sin(beta);
  const cosB = Math.cos(beta);
  const xSky = sinB + (Math.PI - beta - sinB) / (1 + cosB);
  // limite β → 0: (β − sen β)/(1 − cos β) ≈ β/3
  const xGnd = 1 - cosB < 1e-9 ? sinB + beta / 3 : sinB + (beta - sinB) / (1 - cosB);
  const f = (x: number) => 1 - Math.exp((-(c1 + c2 * x) * x) / ar);
  return { sky: f(xSky), ground: f(xGnd) };
}

// ─── Transposição HDKR ───────────────────────────────────────────────────────────────────────

export interface PoaComponents {
  /** direta no plano, W/m² (ou kW/m², mesma unidade da entrada) */
  beam: number;
  /** difusa circunsolar (tratada como direta) */
  circumsolar: number;
  /** difusa isotrópica + brilho do horizonte */
  skyDiffuse: number;
  ground: number;
  total: number;
  /** POA efetiva após o IAM de cada componente */
  effective: number;
  cosAoi: number;
}

/** cos θz mínimo usado em razões com cos θz (≈ 87°), evita singularidades junto ao horizonte */
const MIN_COSZ = Math.cos(87 * DEG);

/**
 * Modelo HDKR (D&B Eq. 2.16.7):
 *   I_T = (I_b + I_d·A_i)·R_b + I_d·(1 − A_i)·(1 + cos β)/2·[1 + f·sen³(β/2)] + I·ρ_g·(1 − cos β)/2
 * com A_i = I_b/I_o (índice de anisotropia), f = √(I_b/I) e R_b = cos θ / cos θz.
 * A parcela direta é calculada como DNI·cos θ (equivalente a I_b·R_b).
 *
 * @param ghi, dhi, dni irradiâncias (mesma unidade); g0n irradiância extraterrestre normal (mesma unidade)
 */
export function transposeHDKR(sun: SunVector, surf: Surface, ghi: number, dhi: number, dni: number, g0n: number, albedo: number): PoaComponents {
  const beta = surf.tiltDeg * DEG;
  const cosB = Math.cos(beta);
  const cosAoi = cosIncidence(sun, surf);
  const cAoi = Math.max(0, cosAoi);
  const bh = Math.max(0, ghi - dhi); // direta horizontal
  const ai = g0n > 0 ? clamp(dni / g0n, 0, 1) : 0;
  const f = ghi > 0 ? Math.sqrt(clamp(bh / ghi, 0, 1)) : 0;
  const cosZ = Math.max(sun.cosZ, MIN_COSZ);

  const beam = dni * cAoi;
  const circumsolar = (dhi * ai * cAoi) / cosZ;
  const skyDiffuse = dhi * (1 - ai) * ((1 + cosB) / 2) * (1 + f * Math.sin(beta / 2) ** 3);
  const ground = ghi * albedo * ((1 - cosB) / 2);
  const total = beam + circumsolar + skyDiffuse + ground;

  const iamB = iamBeam(cAoi);
  const iamD = iamDiffuse(surf.tiltDeg);
  const effective = (beam + circumsolar) * iamB + skyDiffuse * iamD.sky + ground * iamD.ground;
  return { beam, circumsolar, skyDiffuse, ground, total, effective, cosAoi };
}
