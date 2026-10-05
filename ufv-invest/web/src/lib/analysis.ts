import "server-only";
import { createHash } from "node:crypto";
import { getPlant, plants } from "@/data/plants";
import { analyzeFinance } from "@/lib/finance";
import { canonicalAnalysisJson } from "@/lib/report/canonical";
import { instantPower, simulateGeneration } from "@/lib/solar";
import { getLiveWeather, getLocationInfo, getMarketRates, getPvgisCrossCheck, getSolarResource, type LiveWeather } from "@/lib/sources";
import type { LiveConditions, Plant, PlantAnalysis, Provenance } from "@/lib/types";

/**
 * Orquestrador: busca as fontes em paralelo (cada uma com fallback próprio), roda o modelo de
 * geração e o econômico e carimba a análise com o SHA-256 do JSON canônico.
 * Cache em memória por usina (15 min) com deduplicação de chamadas simultâneas.
 */

const TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; value: Promise<PlantAnalysis> }>();

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Monta as condições ao vivo e a previsão diária de energia a partir do tempo horário. */
export function buildLive(plant: Plant, weather: LiveWeather): LiveConditions {
  // irradiância horária do Open-Meteo é média da hora anterior (carimbo = fim do intervalo) →
  // posição do sol no meio do intervalo; o bloco "current" é média de 15 min (centro = −7,5 min)
  const mid = (iso: string, minutes = 30) => new Date(new Date(iso).getTime() - minutes * 60_000);
  const now = instantPower(plant, { time: mid(weather.time, 7.5), ghiWm2: weather.ghiWm2, dhiWm2: weather.dhiWm2, dniWm2: weather.dniWm2, tempC: weather.tempC, windMs: weather.windMs });

  const byDay = new Map<string, { kwh: number; poa: number }>();
  for (const h of weather.hourly) {
    const day = h.time.slice(0, 10);
    const p = h.ghiWm2 > 0 ? instantPower(plant, { time: mid(h.time), ghiWm2: h.ghiWm2, dhiWm2: h.dhiWm2, dniWm2: h.dniWm2, tempC: h.tempC, windMs: h.windMs }) : { acKW: 0, poaWm2: 0 };
    const acc = byDay.get(day) ?? { kwh: 0, poa: 0 };
    acc.kwh += p.acKW;
    acc.poa += p.poaWm2 / 1000;
    byDay.set(day, acc);
  }

  return {
    time: weather.time,
    ghiWm2: weather.ghiWm2,
    poaWm2: now.poaWm2,
    tempC: weather.tempC,
    cloudCoverPct: weather.cloudCoverPct,
    isDay: weather.isDay,
    estimatedPowerKW: Math.max(0, now.acKW),
    forecast: weather.daily.map((d) => {
      const e = byDay.get(d.date);
      return { date: d.date, ghiKWhM2: d.ghiKWhM2, poaKWhM2: e?.poa ?? 0, energyMWh: (e?.kwh ?? 0) / 1000, tempMaxC: d.tempMaxC, cloudCoverPct: d.cloudCoverPct };
    }),
    provenance: weather.provenance,
  };
}

async function compute(plant: Plant): Promise<PlantAnalysis> {
  const [resource, pvgis, market, location, weather] = await Promise.all([
    getSolarResource(plant),
    getPvgisCrossCheck(plant),
    getMarketRates(),
    getLocationInfo(plant),
    getLiveWeather(plant),
  ]);

  const generation = simulateGeneration(plant, resource, pvgis);
  const finance = analyzeFinance(plant, generation, market, { monteCarloRuns: 2000, seed: 42 });
  let live: LiveConditions | null = null;
  try {
    live = weather ? buildLive(plant, weather) : null;
  } catch {
    live = null;
  }

  const provenance: Provenance[] = [...location.provenance, ...resource.provenance, ...(pvgis ? [pvgis.provenance] : []), ...market.provenance, ...(weather ? [weather.provenance] : [])];

  const analysis: PlantAnalysis = {
    plant,
    generatedAt: new Date().toISOString(),
    location,
    resource,
    pvgis,
    generation,
    market,
    finance,
    live,
    provenance,
    dataHash: "",
  };
  analysis.dataHash = sha256Hex(canonicalAnalysisJson(analysis));
  return analysis;
}

export async function getPlantAnalysis(slug: string): Promise<PlantAnalysis | null> {
  const plant = getPlant(slug);
  if (!plant) return null;
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = compute(plant);
  cache.set(slug, { at: Date.now(), value });
  value.catch(() => cache.delete(slug));
  return value;
}

export async function getAllAnalyses(): Promise<PlantAnalysis[]> {
  const all = await Promise.all(plants.map((p) => getPlantAnalysis(p.slug)));
  return all.filter((a): a is PlantAnalysis => a !== null);
}

/** Resumo enxuto para listagens (cards) */
export function summarize(a: PlantAnalysis) {
  const { plant, generation: g, finance: f } = a;
  return {
    slug: plant.slug,
    name: plant.name,
    tagline: plant.tagline,
    status: plant.status,
    illustrative: plant.illustrative,
    municipio: plant.location.municipio,
    uf: plant.location.uf,
    dcKWp: plant.tech.dcKWp,
    mounting: plant.tech.mounting,
    p50MWh: g.annualP50MWh,
    specificYield: g.specificYieldKWhPerKWp,
    irrNominalPct: f.irrNominalPct,
    irrRealPct: f.irrRealPct,
    paybackYears: f.paybackYears,
    firstYearYieldPct: f.firstYearYieldPct,
    cotaPriceBRL: plant.token.cotaPriceBRL,
    totalCotas: plant.token.totalCotas,
    investmentBRL: f.investmentBRL,
    monthlyPerCotaBRL: f.perCota.avgMonthlyIncomeBRL,
    co2: g.co2AvoidedTonsYear,
    symbol: plant.token.symbol,
  };
}
export type PlantSummary = ReturnType<typeof summarize>;
