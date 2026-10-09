/**
 * Simulação da produção anual (P50 do ano 1) por "dia médio" mensal com resolução sub-horária.
 *
 * Passos (Duffie & Beckman 2013, cap. 1–2 e 23; demais referências nos módulos):
 *  1. Para cada mês: dia médio de Klein (1977), declinação (Spencer 1971), ωs e H₀ → K̄T = H̄/H₀.
 *  2. Difusa média mensal: DHI informada ou Erbs et al. (1982) mensal.
 *  3. O dia médio é decomposto em DAY_TYPES dias-tipo equiprováveis de K_T pela distribuição de Bendt
 *     et al. (1981), preservando exatamente H̄ e H̄d. Motivo: a cadeia CC/CA é não linear (temperatura
 *     e, sobretudo, clipping na potência CA — relação CC/CA ≈ 1,25–1,3) e um único dia médio "achata"
 *     os picos dos dias claros, subestimando o clipping. Os dias-tipo e o perfil intradiário são
 *     limitados pelo céu claro de Haurwitz (1945), redistribuindo o excedente (totais preservados).
 *  4. Distribuição intradiária: r_t (Collares-Pereira & Rabl 1979) e r_d (Liu & Jordan 1960) em
 *     STEPS_PER_DAY passos entre nascer e pôr do sol, renormalizados aos totais diários.
 *  5. POA por HDKR + IAM (Martin & Ruiz 2001), temperatura de célula (Faiman 2008), cadeia de perdas
 *     (pvchain.ts), clipping CA.
 *  6. Energia mensal = energia do dia médio × dias do mês; P50 do ano 1 inclui LID/LeTID.
 */

import { fmtNum, fmtPct } from "@/lib/finance/format";
import type { GenerationResult, LossWaterfallItem, MonthlyGeneration, Plant, PvgisCrossCheck, SolarResource } from "@/lib/types";
import {
  capDayTypes,
  clearnessDayTypes,
  erbsDailyDiffuseFraction,
  erbsMonthlyDiffuseFraction,
  haurwitzGhiWm2,
  intradayProfile,
  waterfillUnderCeiling,
} from "./decomposition";
import {
  cosZenith,
  DAYS_IN_MONTH,
  declinationDeg,
  extraterrestrialDailyKWhm2,
  extraterrestrialNormalWm2,
  KLEIN_MEAN_DAY,
  solarAzimuthCompassDeg,
  sunsetHourAngleDeg,
} from "./geometry";
import {
  BIFACIAL_REAR_LOSS,
  BIFACIAL_VIEW_COEFF_FIXED,
  BIFACIAL_VIEW_COEFF_TRACKER,
  BIFACIALITY,
  buildPlantModel,
  evaluateStep,
  N_STAGES,
  STAGE_BIFACIAL,
  STAGE_LABELS,
  surfaceFor,
} from "./pvchain";
import { ambientTemperatureC, DEFAULT_HALF_AMPLITUDE_C, DEFAULT_WIND_MS, FAIMAN_U0, FAIMAN_U1 } from "./thermal";
import { MARTIN_RUIZ_AR, TRACKER_GCR } from "./transposition";
import {
  exceedance,
  multiYearSigmaPct,
  SIGMA_DEGRADATION_PCT,
  SIGMA_MODEL_PCT,
  SIGMA_RESOURCE_DATA_FALLBACK_PCT,
  SIGMA_RESOURCE_DATA_PCT,
  uncertaintyBudget,
  Z_P75,
  Z_P90,
  Z_P99,
} from "./uncertainty";

/** número de dias-tipo de K_T por mês (Bendt et al. 1981) */
export const DAY_TYPES = 5;
/** passos entre o nascer e o pôr do sol (≈ 8 min em dias de 12–13 h) */
export const STEPS_PER_DAY = 96;
/**
 * Fator médio de emissão de CO₂ do Sistema Interligado Nacional em 2023: 0,0385 tCO₂/MWh — MCTI,
 * "Fatores de emissão de CO₂ pela geração de energia elétrica no SIN" (método para inventários /
 * fator médio anual). Usado para CO₂ evitado (aproximação: a energia injetada desloca a média do SIN).
 */
export const SIN_EMISSION_FACTOR_TCO2_PER_MWH = 0.0385;

const LABEL_FINAL = "Energia injetada (AC)";

function monthlyArray(arr: number[] | undefined, fallback: (m: number) => number): number[] {
  return Array.from({ length: 12 }, (_, m) => {
    const v = arr?.[m];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback(m);
  });
}

export function simulateGeneration(plant: Plant, resource: SolarResource, pvgis?: PvgisCrossCheck | null): GenerationResult {
  const model = buildPlantModel(plant);
  const clim = resource.monthly;
  const lat = model.lat;

  const ghi = monthlyArray(clim.ghiKWhM2Day, () => NaN);
  if (ghi.some((v) => !Number.isFinite(v))) throw new Error(`simulateGeneration: ghiKWhM2Day precisa de 12 valores numéricos (${plant.slug})`);
  const hasDhi = Array.isArray(clim.dhiKWhM2Day) && clim.dhiKWhM2Day.length === 12 && clim.dhiKWhM2Day.every((v) => Number.isFinite(v) && v > 0);
  const tMean = monthlyArray(clim.tempC, () => 25);
  const tMax = monthlyArray(clim.tempMaxC, (m) => tMean[m] + DEFAULT_HALF_AMPLITUDE_C);
  const tMin = monthlyArray(clim.tempMinC, (m) => tMean[m] - DEFAULT_HALF_AMPLITUDE_C);
  const wind = monthlyArray(clim.windMs, () => DEFAULT_WIND_MS);

  const degY1 = 1 - model.firstYearDeg;
  const annualStages = new Float64Array(N_STAGES);
  const stepStages = new Float64Array(N_STAGES);
  const monthStages = new Float64Array(N_STAGES);
  const monthly: MonthlyGeneration[] = [];
  let annualPoa = 0;
  let annualGhi = 0;
  const wDay = 1 / DAY_TYPES;

  for (let m = 0; m < 12; m++) {
    const n = KLEIN_MEAN_DAY[m];
    const days = DAYS_IN_MONTH[m];
    const decl = declinationDeg(n);
    const ws = sunsetHourAngleDeg(lat, decl);
    const h0 = extraterrestrialDailyKWhm2(lat, n);
    const hBar = Math.max(0, ghi[m]);
    annualGhi += hBar * days;
    monthStages.fill(0);
    let poaDay = 0;
    let tcNum = 0;
    let tcDen = 0;

    if (ws > 0 && h0 > 0 && hBar > 0) {
      const kBar = hBar / h0;
      const hdBar = hasDhi ? Math.min(0.95 * hBar, Math.max(0.05 * hBar, clim.dhiKWhM2Day![m])) : erbsMonthlyDiffuseFraction(kBar, ws) * hBar;

      const prof = intradayProfile(ws, STEPS_PER_DAY);
      const sunriseH = 12 - ws / 15;
      const g0n = extraterrestrialNormalWm2(n);
      // fração do dia no passo → irradiância média no passo (W/m²)
      const toWm2 = 1000 / prof.dtHours;

      // geometria de cada passo (independe do dia-tipo)
      const cosZs = prof.hourAngleDeg.map((w) => cosZenith(lat, decl, w));
      const ceiling = cosZs.map((cz) => haurwitzGhiWm2(cz));
      const kClear = (ceiling.reduce((s, g) => s + g, 0) * prof.dtHours) / 1000 / h0;

      // dias-tipo (Bendt et al. 1981) limitados ao céu claro: médias exatamente iguais a H̄ e H̄d
      const kTypes = capDayTypes(clearnessDayTypes(kBar, DAY_TYPES), kClear);
      const hTypes = kTypes.map((k) => k * h0);
      const hdRaw = kTypes.map((k, i) => erbsDailyDiffuseFraction(k, ws) * hTypes[i]);
      const hdRawMean = hdRaw.reduce((s, x) => s + x, 0) / DAY_TYPES;
      const hdTypes = hdRaw.map((x, i) => Math.min(hTypes[i], hdRawMean > 0 ? (x * hdBar) / hdRawMean : hdBar));

      // perfis intradiários de cada dia-tipo: r_t·H com teto de céu claro, r_d·Hd
      const gTypes = hTypes.map((h) =>
        waterfillUnderCeiling(
          prof.ft.map((f) => h * f * toWm2),
          ceiling,
        ),
      );
      const gdTypes = hdTypes.map((hd) => prof.fd.map((f) => hd * f * toWm2));

      for (let j = 0; j < STEPS_PER_DAY; j++) {
        const w = prof.hourAngleDeg[j];
        const cosZ = cosZs[j];
        if (cosZ <= 0) continue;
        const sun = { cosZ, sinZ: Math.sqrt(Math.max(0, 1 - cosZ * cosZ)), azimuthDeg: solarAzimuthCompassDeg(lat, decl, w) };
        const surf = surfaceFor(model, sun);
        const ta = ambientTemperatureC(12 + w / 15, sunriseH, tMin[m], tMax[m]);
        for (let i = 0; i < DAY_TYPES; i++) {
          const g = gTypes[i][j];
          const gd = Math.min(g, gdTypes[i][j]);
          const dni = (g - gd) / Math.max(cosZ, 0.01);
          const r = evaluateStep(model, sun, surf, g, gd, dni, g0n, ta, wind[m], degY1, stepStages);
          const wt = prof.dtHours * wDay;
          for (let k = 0; k < N_STAGES; k++) monthStages[k] += stepStages[k] * wt;
          poaDay += (r.poaWm2 / 1000) * wt;
          tcNum += r.cellTempC * r.poaWm2 * wt;
          tcDen += r.poaWm2 * wt;
        }
      }
    }

    for (let k = 0; k < N_STAGES; k++) annualStages[k] += monthStages[k] * days;
    const energyMWh = (monthStages[N_STAGES - 1] * days) / 1000;
    const poaMonth = poaDay * days;
    annualPoa += poaMonth;
    monthly.push({
      month: m,
      poaKWhM2: poaMonth,
      energyMWh,
      prPct: poaMonth > 0 ? (energyMWh / ((poaMonth * model.pdcKW) / 1000)) * 100 : 0,
      cellTempC: tcDen > 0 ? tcNum / tcDen : tMean[m],
    });
  }

  const p50 = annualStages[N_STAGES - 1] / 1000;

  // ── cascata de perdas ────────────────────────────────────────────────────────────────────
  const lossWaterfall: LossWaterfallItem[] = [{ label: STAGE_LABELS[0], pct: 0, energyMWhAfter: annualStages[0] / 1000 }];
  for (let k = 1; k < N_STAGES; k++) {
    if (k === STAGE_BIFACIAL && !model.bifacial) continue;
    const before = annualStages[k - 1];
    const after = annualStages[k];
    lossWaterfall.push({ label: STAGE_LABELS[k], pct: before > 0 ? (1 - after / before) * 100 : 0, energyMWhAfter: after / 1000 });
  }
  lossWaterfall.push({ label: LABEL_FINAL, pct: 0, energyMWhAfter: p50 });

  // ── incerteza e excedência ──────────────────────────────────────────────────────────────
  const iav = Number.isFinite(resource.interannualCvPct) && resource.interannualCvPct > 0 ? resource.interannualCvPct : plant.fallbackClimate.interannualCvPct;
  const allFallback = resource.provenance.length > 0 && resource.provenance.every((p) => p.status === "fallback");
  const sigmaData = allFallback ? SIGMA_RESOURCE_DATA_FALLBACK_PCT : SIGMA_RESOURCE_DATA_PCT;
  const unc = uncertaintyBudget(iav, sigmaData, SIGMA_MODEL_PCT, SIGMA_DEGRADATION_PCT);
  const sigma10 = multiYearSigmaPct(unc, 10);

  // ── degradação ao longo do horizonte (linear após o ano 1) ──────────────────────────────
  const horizon = Math.max(1, Math.round(plant.finance.horizonYears));
  const yearly = Array.from({ length: horizon }, (_, i) => ({ year: i + 1, energyMWh: p50 * Math.max(0, 1 - model.annualDeg * i) }));

  // ── validação cruzada ───────────────────────────────────────────────────────────────────
  let crossCheck: GenerationResult["crossCheck"];
  if (pvgis && Number.isFinite(pvgis.annualKWhPerKWp) && pvgis.annualKWhPerKWp > 0) {
    const pvgisMWh = (pvgis.annualKWhPerKWp * model.pdcKW) / 1000;
    crossCheck = { source: pvgis.provenance?.name ?? "PVGIS (JRC)", annualMWh: pvgisMWh, deviationPct: ((p50 - pvgisMWh) / pvgisMWh) * 100 };
  }

  const specificYield = (p50 * 1000) / model.pdcKW;
  const prPct = annualPoa > 0 ? (p50 / ((annualPoa * model.pdcKW) / 1000)) * 100 : 0;
  const cfPct = model.acKW > 0 ? (p50 / ((model.acKW / 1000) * 8760)) * 100 : 0;

  return {
    monthly,
    annualP50MWh: p50,
    p75MWh: exceedance(p50, unc.totalPct, Z_P75),
    p90MWh: exceedance(p50, unc.totalPct, Z_P90),
    p99MWh: exceedance(p50, unc.totalPct, Z_P99),
    p90TenYearMWh: exceedance(p50, sigma10, Z_P90),
    specificYieldKWhPerKWp: specificYield,
    performanceRatioPct: prPct,
    capacityFactorPct: cfPct,
    annualPoaKWhM2: annualPoa,
    annualGhiKWhM2: annualGhi,
    uncertainty: unc,
    lossWaterfall,
    yearly,
    crossCheck,
    co2AvoidedTonsYear: p50 * SIN_EMISSION_FACTOR_TCO2_PER_MWH,
    method: methodNotes(plant, hasDhi, unc, allFallback, crossCheck),
  };
}

function methodNotes(plant: Plant, hasDhi: boolean, unc: ReturnType<typeof uncertaintyBudget>, allFallback: boolean, crossCheck: GenerationResult["crossCheck"]): string[] {
  const t = plant.tech;
  const tracker = t.mounting === "single-axis";
  const notes = [
    "Geometria solar: declinação de Spencer (1971), ângulo horário do pôr do sol e irradiação extraterrestre diária H₀ (Duffie & Beckman, 2013, cap. 1), dia médio de cada mês de Klein (1977); constante solar 1361 W/m² (Kopp & Lean, 2011).",
    hasDhi
      ? "Fração difusa: irradiação difusa horizontal (DHI) mensal informada pela fonte de dados."
      : "Fração difusa: correlação média mensal de Erbs, Klein & Duffie (1982) em função do índice de claridade K̄T e do ângulo do pôr do sol.",
    `Variabilidade diária: cada mês é representado por ${DAY_TYPES} dias-tipo equiprováveis de K_T segundo a distribuição de Bendt, Collares-Pereira & Rabl (1981), limitados pelo céu claro de Haurwitz (1945) e com difusa diária de Erbs et al. (1982) reescalada para preservar os totais mensais — captura o clipping e a temperatura nos dias claros.`,
    `Distribuição intradiária: r_t de Collares-Pereira & Rabl (1979) para a global e r_d de Liu & Jordan (1960) para a difusa, renormalizadas aos totais diários, em ${STEPS_PER_DAY} passos entre o nascer e o pôr do sol (≈ 8 min).`,
    `Transposição para o plano dos módulos: modelo anisotrópico HDKR (Hay & Davies, 1980; Klucher, 1979; Reindl et al., 1990) com reflexão do solo, albedo ${fmtNum(t.albedo, 2)}.`,
    tracker
      ? `Seguidor de um eixo horizontal (eixo a ${fmtNum(t.azimuthDeg, 0)}° de bússola): rotação de rastreamento verdadeiro (Marion & Dobos, 2013, NREL/TP-6A20-58891) limitada a ±${fmtNum(t.trackerMaxAngleDeg ?? 60, 0)}°, com retrorrastreamento (backtracking) de Lorenzo et al. (2011) / Anderson & Mikofski (2020) para GCR = ${fmtNum(TRACKER_GCR, 2)} (valor assumido, típico de projetos com backtracking).`
      : `Estrutura fixa: inclinação ${fmtNum(t.tiltDeg, 0)}°, azimute ${fmtNum(t.azimuthDeg, 0)}° (bússola, 0° = Norte).`,
    `Modificador de ângulo de incidência: Martin & Ruiz (2001), a_r = ${fmtNum(MARTIN_RUIZ_AR, 2)}, para a direta (e circunsolar), a difusa do céu e a refletida pelo solo.`,
    `Temperatura: perfil diurno senoidal entre Tmín (nascer do sol) e Tmáx (15 h solar); célula pelo modelo de Faiman (2008) com U0 = ${fmtNum(FAIMAN_U0, 0)} W/m²K, U1 = ${fmtNum(FAIMAN_U1, 2)} W·s/m³K e vento médio mensal (padrão ${fmtNum(DEFAULT_WIND_MS, 0)} m/s).`,
    `Potência CC: P = P_STC · (G_ef/1000) · [1 + γ (Tc − 25 °C)], γ = ${fmtNum(t.module.gammaPmaxPctPerC, 2)} %/°C; ${fmtNum(t.dcKWp, 0)} kWp CC / ${fmtNum(t.acKW, 0)} kW CA (relação CC/CA ${fmtNum(t.dcKWp / t.acKW, 2)}).`,
  ];
  if (t.module.bifacial) {
    const k = tracker ? BIFACIAL_VIEW_COEFF_TRACKER : BIFACIAL_VIEW_COEFF_FIXED;
    notes.push(
      `Ganho bifacial simplificado e conservador: irradiância traseira = ${fmtNum(k, 2)} × albedo × GHI, bifacialidade ${fmtNum(BIFACIALITY, 2)} e ${fmtNum(BIFACIAL_REAR_LOSS * 100, 0)} % de perdas traseiras (sombra da estrutura e descasamento).`,
    );
  }
  const l = t.losses;
  notes.push(
    `Perdas: sujidade ${fmtPct(l.soilingPct)}, sombreamento ${fmtPct(l.shadingPct)}, descasamento ${fmtPct(l.mismatchPct)} e cabeamento CC ${fmtPct(l.dcWiringPct)} antes do inversor; eficiência europeia do inversor ${fmtPct(t.inverter.euroEfficiencyPct)} e limitação (clipping) na potência CA nominal; cabeamento CA ${fmtPct(l.acWiringPct)}, transformador ${fmtPct(l.transformerPct)} e indisponibilidade ${fmtPct(l.unavailabilityPct)}.`,
    `Degradação: ${fmtPct(t.degradation.firstYearPct)} no ano 1 (LID/LeTID, incluída no P50) e ${fmtNum(t.degradation.annualPct, 2)} %/ano linear a partir do ano 2.`,
    `Incerteza (P75/P90/P99): combinação quadrática de variabilidade interanual (${fmtPct(unc.interannualPct)}), dados de recurso (${fmtPct(unc.resourceDataPct)}${allFallback ? ", elevada por usar a climatologia de referência embarcada" : ""}), modelo (${fmtPct(unc.modelPct)}) e degradação (${fmtPct(unc.degradationPct)}) → σ = ${fmtPct(unc.totalPct)}, distribuição normal (Dobos et al., 2012, NREL/CP-6A20-54488); P90 de 10 anos com σ_interanual/√10.`,
    "Indicadores: PR = E_CA / (H_POA × P_STC) (IEC 61724-1), incluindo o ganho bifacial quando houver; fator de capacidade sobre a potência CA nominal, E_CA / (P_CA × 8760 h); produtividade específica sobre a potência CC.",
    `CO₂ evitado: P50 × fator médio de emissão do SIN 2023 (MCTI) = ${fmtNum(SIN_EMISSION_FACTOR_TCO2_PER_MWH, 4)} tCO₂/MWh.`,
  );
  if (crossCheck) {
    notes.push(
      `Validação cruzada: ${crossCheck.source} estima ${fmtNum(crossCheck.annualMWh, 0)} MWh/ano; desvio do P50 deste modelo = ${fmtNum(crossCheck.deviationPct, 1)} % (o PVGIS usa a perda de sistema informada na consulta e não modela ganho bifacial nem clipping).`,
    );
  }
  return notes;
}
