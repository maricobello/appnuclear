/**
 * Potência instantânea da usina a partir de irradiância e temperatura medidas/previstas
 * (condições "ao vivo" e previsão horária do Open-Meteo).
 *
 * Usa a mesma cadeia de perdas da simulação anual (pvchain.ts). Quando a DHI/DNI não são
 * informadas, a global é decomposta pela correlação horária de Erbs et al. (1982) (D&B Eq. 2.10.1).
 * Para médias horárias (Open-Meteo devolve a média da hora ANTERIOR ao rótulo), passe em `time` o
 * instante central do intervalo.
 *
 * Degradação: aplica LID/LeTID e a degradação anual conforme a idade da usina no instante
 * (ano de operação contado a partir de `tech.commissioning`; antes disso, ano 1).
 */

import type { Plant } from "@/lib/types";
import { erbsHourlyDiffuseFraction } from "./decomposition";
import { DEG, sunPositionDetailed } from "./geometry";
import { buildPlantModel, evaluateStep, surfaceFor, type PlantModel } from "./pvchain";
import { DEFAULT_WIND_MS } from "./thermal";

const modelCache = new WeakMap<Plant, PlantModel>();
function modelFor(plant: Plant): PlantModel {
  let m = modelCache.get(plant);
  if (!m) {
    m = buildPlantModel(plant);
    modelCache.set(plant, m);
  }
  return m;
}

/** Fração de potência CC remanescente no instante, pela idade da usina */
export function degradationFactorAt(m: PlantModel, time: Date): number {
  const ageYears = Number.isFinite(m.commissioningMs) ? (time.getTime() - m.commissioningMs) / (365.25 * 86_400_000) : 0;
  const opYear = Math.max(1, Math.floor(Math.max(0, ageYears)) + 1);
  return (1 - m.firstYearDeg) * Math.max(0, 1 - m.annualDeg * (opYear - 1));
}

/** cos θz abaixo do qual (elevação < ~3°) a direta é tratada como nula na decomposição */
const LOW_SUN_COSZ = Math.cos(87 * DEG);

export function instantPower(
  plant: Plant,
  input: { time: Date; ghiWm2: number; dhiWm2?: number; dniWm2?: number; tempC: number; windMs?: number },
): { poaWm2: number; cellTempC: number; acKW: number } {
  const m = modelFor(plant);
  const tempC = Number.isFinite(input.tempC) ? input.tempC : 25;
  const ghi = Number.isFinite(input.ghiWm2) ? Math.max(0, input.ghiWm2) : 0;
  const sp = sunPositionDetailed(input.time, m.lat, m.lon);
  if (ghi <= 0 || sp.elevationDeg <= 0) return { poaWm2: 0, cellTempC: tempC, acKW: 0 };

  const cosZ = Math.cos(sp.zenithDeg * DEG);
  const g0n = sp.extraterrestrialWm2;
  const hasDhi = typeof input.dhiWm2 === "number" && Number.isFinite(input.dhiWm2) && input.dhiWm2 >= 0;
  const hasDni = typeof input.dniWm2 === "number" && Number.isFinite(input.dniWm2) && input.dniWm2 >= 0;

  let dhi: number;
  let dni: number;
  if (cosZ < LOW_SUN_COSZ) {
    // sol rasante: toda a irradiância como difusa (evita DNI = Bh/cos θz instável)
    dhi = ghi;
    dni = 0;
  } else if (hasDhi && hasDni) {
    dhi = Math.min(ghi, input.dhiWm2!);
    dni = input.dniWm2!;
  } else if (hasDhi) {
    dhi = Math.min(ghi, input.dhiWm2!);
    dni = (ghi - dhi) / cosZ;
  } else if (hasDni) {
    dni = input.dniWm2!;
    dhi = Math.max(0, ghi - dni * cosZ);
  } else {
    const kt = Math.min(1, ghi / (g0n * cosZ));
    dhi = ghi * erbsHourlyDiffuseFraction(kt);
    dni = (ghi - dhi) / cosZ;
  }
  dni = Math.min(Math.max(0, dni), g0n);

  const sun = { cosZ, sinZ: Math.sin(sp.zenithDeg * DEG), azimuthDeg: sp.azimuthDeg };
  const surf = surfaceFor(m, sun);
  const wind = typeof input.windMs === "number" && Number.isFinite(input.windMs) ? input.windMs : DEFAULT_WIND_MS;
  const r = evaluateStep(m, sun, surf, ghi, dhi, dni, g0n, tempC, wind, degradationFactorAt(m, input.time));
  return { poaWm2: r.poaWm2, cellTempC: r.cellTempC, acKW: r.acKW };
}
