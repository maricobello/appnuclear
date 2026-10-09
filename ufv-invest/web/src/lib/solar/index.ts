/**
 * Modelo de geração fotovoltaica da Aferi Capital.
 *
 * API pública:
 *  - simulateGeneration(plant, resource, pvgis?) → GenerationResult (P50/P75/P90/P99, PR, cascata de perdas…)
 *  - sunPosition(date, lat, lon) → { zenithDeg, elevationDeg, azimuthDeg (bússola, 0 = Norte) }
 *  - instantPower(plant, { time, ghiWm2, dhiWm2?, dniWm2?, tempC, windMs? }) → { poaWm2, cellTempC, acKW }
 *
 * Os submódulos (geometry, decomposition, transposition, thermal, pvchain, uncertainty) são exportados
 * para testes e para quem precisar das peças (ex.: gráficos de perfil horário).
 */

export { simulateGeneration, DAY_TYPES, STEPS_PER_DAY, SIN_EMISSION_FACTOR_TCO2_PER_MWH } from "./simulate";
export { sunPosition, sunPositionDetailed } from "./geometry";
export { instantPower } from "./instant";

export * as geometry from "./geometry";
export * as decomposition from "./decomposition";
export * as transposition from "./transposition";
export * as thermal from "./thermal";
export * as uncertainty from "./uncertainty";
export { STAGE_LABELS } from "./pvchain";
