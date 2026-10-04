/**
 * Cadeia de conversão da usina: irradiância → potência CC → potência CA injetada.
 *
 * Esta é a ÚNICA implementação da cadeia de perdas; é usada tanto pela simulação anual
 * (`simulateGeneration`, dias-tipo mensais) quanto pela potência instantânea (`instantPower`,
 * "ao vivo" e previsão horária), garantindo que ambos contem exatamente as mesmas perdas.
 *
 * Ordem das etapas (cada uma grava a potência após a etapa em `stages[i]`, em kW):
 *   0 POA × kWp (referência STC)       7 cabeamento CC
 *   1 IAM (Martin & Ruiz 2001)          8 degradação (LID/LeTID no ano 1)
 *   2 sujidade                          9 eficiência do inversor (europeia)
 *   3 sombreamento                     10 limitação na potência CA nominal (clipping)
 *   4 ganho bifacial                   11 cabeamento CA
 *   5 temperatura (Faiman 2008)        12 transformador
 *   6 descasamento (mismatch)          13 indisponibilidade
 * Sujidade e sombreamento reduzem a irradiância (afetam a temperatura e o clipping); descasamento,
 * cabeamento CC e degradação reduzem a potência CC antes do inversor; as perdas CA vêm depois do
 * clipping.
 *
 * Potência CC: P = P_stc · (G_ef / 1000) · [1 + γ (Tc − 25 °C)]  (modelo linear de potência, p. ex.
 * PVWatts — Dobos, A. P. (2014), PVWatts Version 5 Manual, NREL/TP-6A20-62641).
 */

import type { Plant } from "@/lib/types";
import { faimanCellTempC } from "./thermal";
import { singleAxisRotationDeg, trackerSurface, transposeHDKR, TRACKER_GCR, type Surface, type SunVector } from "./transposition";

/**
 * Ganho bifacial simplificado (conservador). Irradiância traseira G_tras = k · albedo · GHI, com k um
 * fator de visada efetivo do solo pelo verso: 0,35 (estrutura fixa, mesa baixa) e 0,45 (seguidor,
 * eixo elevado e mais solo iluminado entre fileiras). Contribuição = bifacialidade (0,70) × G_tras ×
 * (1 − 10 % de perdas traseiras: sombra da estrutura/tubo de torque e descasamento frente-verso).
 * Resulta em ganhos de ~3–5 % (fixo) e ~4–6 % (seguidor) para albedo 0,20–0,22, abaixo dos 5–10 %
 * reportados para seguidores (p. ex. Pelaez et al. 2019, IEEE JPV 9(1):82–87) — conservador de propósito.
 */
export const BIFACIALITY = 0.7;
export const BIFACIAL_VIEW_COEFF_FIXED = 0.35;
export const BIFACIAL_VIEW_COEFF_TRACKER = 0.45;
export const BIFACIAL_REAR_LOSS = 0.1;

export const STAGE_LABELS = [
  "Irradiação no plano (POA) × kWp",
  "Ângulo de incidência (IAM)",
  "Sujidade",
  "Sombreamento",
  "Ganho bifacial",
  "Temperatura dos módulos",
  "Descasamento (mismatch)",
  "Cabeamento CC",
  "Degradação inicial (LID/LeTID, ano 1)",
  "Eficiência do inversor",
  "Limitação CA do inversor (clipping)",
  "Cabeamento CA",
  "Transformador",
  "Indisponibilidade",
] as const;
export const N_STAGES = STAGE_LABELS.length;
export const STAGE_BIFACIAL = 4;

export interface PlantModel {
  lat: number;
  lon: number;
  pdcKW: number;
  acKW: number;
  /** coeficiente de temperatura de Pmax, fração/°C (negativo) */
  gamma: number;
  albedo: number;
  mounting: "fixed" | "single-axis";
  fixedSurface: Surface;
  axisAzimuthDeg: number;
  maxAngleDeg: number;
  gcr: number;
  bifacial: boolean;
  /** fator efetivo da contribuição traseira: bifacialidade × k × (1 − perdas traseiras) × albedo */
  rearFactor: number;
  soiling: number;
  shading: number;
  mismatch: number;
  dcWiring: number;
  acWiring: number;
  transformer: number;
  unavailability: number;
  inverterEff: number;
  firstYearDeg: number;
  annualDeg: number;
  commissioningMs: number;
}

const frac = (pct: number | undefined) => Math.min(1, Math.max(0, (pct ?? 0) / 100));

export function buildPlantModel(plant: Plant): PlantModel {
  const t = plant.tech;
  const tracker = t.mounting === "single-axis";
  const k = tracker ? BIFACIAL_VIEW_COEFF_TRACKER : BIFACIAL_VIEW_COEFF_FIXED;
  const commissioningMs = Date.parse(t.commissioning);
  return {
    lat: plant.location.lat,
    lon: plant.location.lon,
    pdcKW: t.dcKWp,
    acKW: t.acKW,
    gamma: t.module.gammaPmaxPctPerC / 100,
    albedo: t.albedo,
    mounting: t.mounting,
    fixedSurface: { tiltDeg: t.tiltDeg, azimuthDeg: t.azimuthDeg },
    axisAzimuthDeg: t.azimuthDeg,
    maxAngleDeg: t.trackerMaxAngleDeg ?? 60,
    gcr: TRACKER_GCR,
    bifacial: t.module.bifacial,
    rearFactor: t.module.bifacial ? BIFACIALITY * k * (1 - BIFACIAL_REAR_LOSS) * t.albedo : 0,
    soiling: frac(t.losses.soilingPct),
    shading: frac(t.losses.shadingPct),
    mismatch: frac(t.losses.mismatchPct),
    dcWiring: frac(t.losses.dcWiringPct),
    acWiring: frac(t.losses.acWiringPct),
    transformer: frac(t.losses.transformerPct),
    unavailability: frac(t.losses.unavailabilityPct),
    inverterEff: frac(t.inverter.euroEfficiencyPct) || 0.98,
    firstYearDeg: frac(t.degradation.firstYearPct),
    annualDeg: frac(t.degradation.annualPct),
    commissioningMs: Number.isFinite(commissioningMs) ? commissioningMs : NaN,
  };
}

/** Orientação dos módulos para a posição do Sol (fixa, ou rotação do seguidor com backtracking) */
export function surfaceFor(m: PlantModel, sun: SunVector): Surface {
  if (m.mounting === "single-axis") {
    return trackerSurface(singleAxisRotationDeg(sun, m.axisAzimuthDeg, m.maxAngleDeg, m.gcr, true), m.axisAzimuthDeg);
  }
  return m.fixedSurface;
}

export interface StepResult {
  /** POA incidente (frente), W/m² */
  poaWm2: number;
  cellTempC: number;
  /** potência CA injetada, kW */
  acKW: number;
}

/**
 * Avalia a cadeia num instante. Irradiâncias em W/m²; `degradationFactor` = fração de potência CC
 * remanescente por degradação (ex.: 0,99 no ano 1). Se `stages` for informado, grava a potência
 * (kW) após cada etapa.
 */
export function evaluateStep(
  m: PlantModel,
  sun: SunVector,
  surf: Surface,
  ghi: number,
  dhi: number,
  dni: number,
  g0nWm2: number,
  ambientC: number,
  windMs: number,
  degradationFactor: number,
  stages?: Float64Array,
): StepResult {
  const poa = transposeHDKR(sun, surf, ghi, dhi, dni, g0nWm2, m.albedo);
  const kwPerWm2 = m.pdcKW / 1000;

  const p0 = poa.total * kwPerWm2;
  const gIam = poa.effective;
  const p1 = gIam * kwPerWm2;
  const gSoil = gIam * (1 - m.soiling);
  const p2 = gSoil * kwPerWm2;
  const gFront = gSoil * (1 - m.shading);
  const p3 = gFront * kwPerWm2;
  const gEff = gFront + m.rearFactor * Math.max(0, ghi);
  const p4 = gEff * kwPerWm2;

  // temperatura de célula pela POA incidente na face frontal (Faiman usa a POA medida no plano)
  const tc = faimanCellTempC(poa.total * (1 - m.soiling) * (1 - m.shading), ambientC, windMs);
  const p5 = Math.max(0, p4 * (1 + m.gamma * (tc - 25)));
  const p6 = p5 * (1 - m.mismatch);
  const p7 = p6 * (1 - m.dcWiring);
  const p8 = p7 * degradationFactor;
  const p9 = p8 * m.inverterEff;
  const p10 = Math.min(p9, m.acKW);
  const p11 = p10 * (1 - m.acWiring);
  const p12 = p11 * (1 - m.transformer);
  const p13 = p12 * (1 - m.unavailability);

  if (stages) {
    stages[0] = p0;
    stages[1] = p1;
    stages[2] = p2;
    stages[3] = p3;
    stages[4] = p4;
    stages[5] = p5;
    stages[6] = p6;
    stages[7] = p7;
    stages[8] = p8;
    stages[9] = p9;
    stages[10] = p10;
    stages[11] = p11;
    stages[12] = p12;
    stages[13] = p13;
  }
  return { poaWm2: poa.total, cellTempC: tc, acKW: p13 };
}
