import "server-only";
import { liveStatus, type LiveStatus } from "./audit/live";
import { cached } from "./cache";
import { getBrazilBundle, getGlobalBundle, getWeatherBundle } from "./data";
import { ccePiConfigured, fetchPldPI } from "./sources/ccee-pi";
import { fetchBalance, fetchCurtailment, fetchInterchange } from "./sources/ons-renewables";
import { fetchThermal } from "./sources/ons-thermal";
import { SOURCE_LIST } from "./sources/registry";
import type { SourceId, SourceResult } from "./sources/types";
import { listAuditRuns } from "./store";

/** Espera no máximo `ms`; o que não chegar fica "pendente" nesta consulta (e chega na próxima, pelo cache). */
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

const piOff = (): SourceResult<unknown> => ({
  id: "ccee_pi",
  ok: false,
  data: null,
  error: "Plataforma de Integração não configurada (credencial de agente da CCEE)",
  probes: [],
  quality: { latestTs: null, points: 0, duplicates: 0, invalid: 0, schemaIssues: [] },
  simulated: false,
  fetchedAt: Date.now(),
});

/**
 * Estado de todas as fontes agora, a partir das mesmas buscas (e caches) que as telas usam:
 * consultar esta rota não dispara downloads além dos que as telas já fariam.
 */
export async function getLiveStatus(budgetMs = 20_000): Promise<LiveStatus> {
  const [br, gl, wx, curt, bal, ic, th, pi, runs] = await Promise.all([
    within(getBrazilBundle(), budgetMs),
    within(getGlobalBundle(), budgetMs),
    within(getWeatherBundle(), budgetMs),
    within(fetchCurtailment(14), budgetMs),
    within(fetchBalance(14), budgetMs),
    within(fetchInterchange(14), budgetMs),
    within(fetchThermal(7), budgetMs),
    ccePiConfigured() ? within(cached("pld:pi", 10 * 60_000, () => fetchPldPI(14)).then((r) => r.value), budgetMs) : Promise.resolve(piOff()),
    listAuditRuns(1).catch(() => []),
  ]);
  const results: Partial<Record<SourceId, SourceResult<unknown> | null>> = {
    ccee_pld: br?.pld,
    ccee_pi: pi,
    ons_cmo: br?.cmo,
    ons_ear: br?.ear,
    ons_ena: br?.ena,
    ons_carga: br?.load,
    ons_curtailment: curt,
    ons_balanco: bal,
    ons_intercambio: ic,
    ons_termica: th,
    energy_charts: gl?.eu,
    elexon_mid: gl?.ukMid,
    elexon_sysprice: gl?.ukSys,
    uk_carbon: gl?.carbon,
    open_meteo: wx?.weather,
    open_meteo_ens: wx?.ensemble,
    bcb_fx: gl?.fx,
    eia: gl?.eia,
  };
  const last = runs[0];
  return liveStatus(SOURCE_LIST, results, last ? { score: last.overallScore, at: last.startedAt } : null);
}
