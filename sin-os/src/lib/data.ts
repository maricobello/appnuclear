import "server-only";
import { cached } from "./cache";
import { pldFromCmo } from "./market/brazil";
import { fetchPldHourly } from "./sources/ccee";
import { fetchEia } from "./sources/eia";
import { fetchEuPrices } from "./sources/europe";
import { fetchFx } from "./sources/fx";
import { fetchCmoHourly, fetchEarDaily, fetchEnaDaily, fetchLoadHourly } from "./sources/ons";
import * as sim from "./sources/simulate";
import { brtDate, brtHour } from "./sources/time";
import { SUBS, type SourceResult, type Sub, type SubPanel } from "./sources/types";
import { fetchUkCarbon, fetchUkMid, fetchUkSystemPrices } from "./sources/uk";
import { fetchBasinEnsemble, fetchWeather } from "./sources/weather";
import { isCompleteDay, loadPldDays, savePldDays, type PldDay } from "./store";

/**
 * Orquestra as fontes com a política de fallback definida por DATA_MODE:
 *   live — só dados reais; se a fonte falhar, o painel mostra o erro.
 *   auto — (padrão) dados reais; se falhar, usa cadeia de fallback e, em último caso,
 *          simulação SINALIZADA (simulated=true → banner na UI).
 *   demo — tudo simulado (apresentações / desenvolvimento offline).
 */
export type DataMode = "live" | "auto" | "demo";
export const dataMode = (): DataMode => {
  const m = (process.env.DATA_MODE ?? "auto").toLowerCase();
  return m === "live" || m === "demo" ? m : "auto";
};

function simulated<T>(id: SourceResult<T>["id"], data: T, reason: string, base?: SourceResult<T>): SourceResult<T> {
  return {
    id,
    ok: true,
    data,
    probes: base?.probes ?? [],
    quality: base?.quality ?? { latestTs: Date.now(), points: 0, duplicates: 0, invalid: 0, schemaIssues: [] },
    simulated: true,
    fallback: reason,
    error: base?.error,
    fetchedAt: Date.now(),
  };
}

async function withFallback<T>(id: SourceResult<T>["id"], live: () => Promise<SourceResult<T>>, make: () => T): Promise<SourceResult<T>> {
  const mode = dataMode();
  if (mode === "demo") return simulated(id, make(), "DATA_MODE=demo");
  const r = await live();
  if (r.ok || mode === "live") return r;
  return simulated(id, make(), `simulação — fonte falhou: ${r.error ?? "erro"}`, r);
}

/** Fonte gravada em pld_days quando o PLD vem do CMO do ONS (CCEE indisponível). */
export const PLD_FROM_CMO = "ons-cmo";

export function panelToDays(panel: SubPanel, source: string): PldDay[] {
  const byDay = new Map<string, Record<Sub, (number | null)[]>>();
  panel.ts.forEach((t, i) => {
    const d = brtDate(t);
    const row = byDay.get(d) ?? (Object.fromEntries(SUBS.map((s) => [s, new Array(24).fill(null)])) as Record<Sub, (number | null)[]>);
    for (const s of SUBS) row[s][brtHour(t)] = panel.values[s][i];
    byDay.set(d, row);
  });
  return [...byDay.entries()]
    .filter(([, v]) => isCompleteDay(v))
    .map(([date, v]) => ({ date, values: v as Record<Sub, number[]>, source }));
}

function daysToPanel(days: PldDay[]): SubPanel {
  const ts: number[] = [];
  const values = Object.fromEntries(SUBS.map((s) => [s, [] as number[]])) as Record<Sub, number[]>;
  for (const d of days) {
    for (let h = 0; h < 24; h++) {
      ts.push(Date.parse(`${d.date}T${String(h).padStart(2, "0")}:00:00-03:00`));
      for (const s of SUBS) values[s].push(d.values[s][h]);
    }
  }
  return { ts, values, unit: "R$/MWh" };
}

/**
 * PLD com cadeia de resiliência:
 * CCEE (oficial) → ONS CMO limitado ao piso/teto (mesma regra de formação)
 * → Firestore "last known good" → simulação sinalizada.
 */
export async function getPld(daysBack = 120): Promise<SourceResult<SubPanel>> {
  const mode = dataMode();
  if (mode === "demo") return simulated("ccee_pld", sim.simPld(daysBack), "DATA_MODE=demo");
  const primary = await fetchPldHourly(daysBack);
  if (primary.ok && primary.data) {
    savePldDays(panelToDays(primary.data, "ccee")).catch(() => undefined);
    return primary;
  }
  const cmo = await fetchCmoHourly(daysBack);
  if (cmo.ok && cmo.data) {
    const est = pldFromCmo(cmo.data);
    // guarda o estimado no histórico; a CCEE sobrescreve quando voltar
    savePldDays(panelToDays(est, PLD_FROM_CMO)).catch(() => undefined);
    return { ...cmo, id: "ccee_pld", data: est, fallback: `PLD calculado pela regra da ANEEL a partir do CMO/DESSEM (ONS) — CCEE indisponível: ${primary.error}`, error: primary.error };
  }
  const lkg = await loadPldDays(daysBack).catch(() => []);
  if (lkg.length >= 30) {
    const estimated = lkg.filter((d) => d.source !== "ccee").length;
    const note = estimated ? `; ${estimated} dia(s) estimados pelo CMO` : "";
    return { ...primary, ok: true, data: daysToPanel(lkg), fallback: `último dado bom persistido (${lkg[lkg.length - 1].date}${note})` };
  }
  if (mode === "live") return primary;
  return simulated("ccee_pld", sim.simPld(daysBack), `simulação — CCEE e ONS indisponíveis: ${primary.error}`, primary);
}

const TTL = 60_000;

export async function getBrazilBundle() {
  const { value } = await cached("bundle:br", TTL, async () => {
    const [pld, cmo, ear, ena, load] = await Promise.all([
      getPld(120),
      withFallback("ons_cmo", () => fetchCmoHourly(30), () => sim.simCmo(30)),
      withFallback("ons_ear", () => fetchEarDaily(365), () => sim.simEar(365)),
      withFallback("ons_ena", () => fetchEnaDaily(365), () => sim.simEna(365)),
      withFallback("ons_carga", () => fetchLoadHourly(30), () => sim.simLoad(30)),
    ]);
    return { pld, cmo, ear, ena, load };
  });
  return value;
}

export async function getGlobalBundle() {
  const { value } = await cached("bundle:global", TTL, async () => {
    const [eu, ukMid, ukSys, carbon, fx, eia] = await Promise.all([
      withFallback("energy_charts", () => fetchEuPrices(7), () => sim.simEu(7)),
      withFallback("elexon_mid", () => fetchUkMid(7), () => sim.simUkMid(7)),
      withFallback("elexon_sysprice", () => fetchUkSystemPrices(), () => sim.simUkSys()),
      withFallback("uk_carbon", () => fetchUkCarbon(), () => sim.simCarbon()),
      withFallback("bcb_fx", () => fetchFx(), () => sim.simFx()),
      fetchEia(),
    ]);
    return { eu, ukMid, ukSys, carbon, fx, eia };
  });
  return value;
}

export async function getWeatherBundle() {
  const { value } = await cached("bundle:wx", 10 * 60_000, async () => {
    const [weather, ensemble] = await Promise.all([
      withFallback("open_meteo", () => fetchWeather(), () => sim.simWeather()),
      withFallback("open_meteo_ens", () => fetchBasinEnsemble(), () => sim.simEnsemble()),
    ]);
    return { weather, ensemble };
  });
  return value;
}

/** Remove amostras brutas e sondas detalhadas antes de enviar ao cliente. */
export function publicMeta<T>(r: SourceResult<T>) {
  return {
    id: r.id,
    ok: r.ok,
    simulated: r.simulated,
    fallback: r.fallback ?? null,
    error: r.error ?? null,
    latestTs: r.quality.latestTs,
    fetchedAt: r.fetchedAt,
  };
}
