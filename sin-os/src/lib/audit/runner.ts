import "server-only";
import { invalidate } from "../cache";
import { fetchPldHourly } from "../sources/ccee";
import { fetchEia } from "../sources/eia";
import { fetchEuPrices } from "../sources/europe";
import { fetchFx, type FxData } from "../sources/fx";
import { fetchCmoHourly, fetchEarDaily, fetchEnaDaily, fetchLoadHourly } from "../sources/ons";
import { SOURCES } from "../sources/registry";
import type { SourceId, SourceResult, SubPanel } from "../sources/types";
import { fetchUkCarbon, fetchUkMid, fetchUkSystemPrices } from "../sources/uk";
import { fetchBasinEnsemble, fetchWeather } from "../sources/weather";
import { PLD_FROM_CMO, panelToDays } from "../data";
import { pldFromCmo } from "../market/brazil";
import { euZoneStore, listAuditRuns, saveAuditRun, savePldDays, storageKind } from "../store";
import { auditSource, crossFx, crossPldCmo } from "./checks";
import type { AuditRun, SourceAudit } from "./types";

/** Sondas "frescas" (cache invalidado) de todas as fontes, em paralelo. */
export async function probeAll(): Promise<Record<SourceId, SourceResult<unknown>>> {
  invalidate("");
  const entries = await Promise.all([
    fetchPldHourly(30),
    fetchCmoHourly(10),
    fetchEarDaily(30),
    fetchEnaDaily(30),
    fetchLoadHourly(10),
    fetchEuPrices(3, { store: euZoneStore, probe: true }),
    fetchUkMid(2),
    fetchUkSystemPrices(),
    fetchUkCarbon(),
    fetchWeather(),
    fetchBasinEnsemble(),
    fetchFx(),
    fetchEia(),
  ] as Promise<SourceResult<unknown>>[]);
  return Object.fromEntries(entries.map((r) => [r.id, r])) as Record<SourceId, SourceResult<unknown>>;
}

export async function probeOne(id: SourceId): Promise<SourceResult<unknown>> {
  invalidate("");
  const map: Record<SourceId, () => Promise<SourceResult<unknown>>> = {
    ccee_pld: () => fetchPldHourly(30),
    ons_cmo: () => fetchCmoHourly(10),
    ons_ear: () => fetchEarDaily(30),
    ons_ena: () => fetchEnaDaily(30),
    ons_carga: () => fetchLoadHourly(10),
    energy_charts: () => fetchEuPrices(3, { store: euZoneStore, probe: true }),
    elexon_mid: () => fetchUkMid(2),
    elexon_sysprice: () => fetchUkSystemPrices(),
    uk_carbon: () => fetchUkCarbon(),
    open_meteo: () => fetchWeather(),
    open_meteo_ens: () => fetchBasinEnsemble(),
    bcb_fx: () => fetchFx(),
    eia: () => fetchEia(),
  };
  return map[id]();
}

export interface AuditOutcome {
  run: AuditRun;
  previous: AuditRun | null;
  results: Record<SourceId, SourceResult<unknown>>;
  shouldInvokeAgent: boolean;
  reasons: string[];
}

export async function runAudit(trigger: AuditRun["trigger"]): Promise<AuditOutcome> {
  const startedAt = Date.now();
  const previous = (await listAuditRuns(1).catch(() => []))[0] ?? null;
  const results = await probeAll();
  const sources: SourceAudit[] = (Object.keys(SOURCES) as SourceId[]).map((id) => auditSource(SOURCES[id], results[id]));
  const cross = [
    crossPldCmo(results.ccee_pld.data as SubPanel | null, results.ons_cmo.data as SubPanel | null),
    crossFx(results.bcb_fx.data as FxData | null),
  ];
  const enabled = sources.filter((s) => s.status !== "disabled");
  const overallScore = Math.round(enabled.reduce((s, x) => s + x.score, 0) / Math.max(1, enabled.length));
  const counts = { ok: 0, degraded: 0, down: 0, disabled: 0 };
  sources.forEach((s) => counts[s.status]++);

  // quando acionar o agente IA: degradação nova, queda de score ou execução agendada
  const reasons: string[] = [];
  const prevById = new Map(previous?.sources.map((s) => [s.id, s]) ?? []);
  for (const s of sources) {
    const p = prevById.get(s.id);
    if ((s.status === "down" || s.status === "degraded") && (!p || p.status === "ok")) reasons.push(`${s.id}: ${p?.status ?? "novo"} → ${s.status}`);
  }
  if (previous && previous.overallScore - overallScore >= 10) reasons.push(`score geral caiu ${previous.overallScore} → ${overallScore}`);
  if (cross.some((c) => c.status === "fail")) reasons.push("falha de integridade cruzada");
  if (trigger === "cron") reasons.push("execução agendada diária");
  const shouldInvokeAgent = !!process.env.ANTHROPIC_API_KEY && (reasons.length > 0 || trigger === "manual");

  const finishedAt = Date.now();
  const run: AuditRun = {
    id: `run_${startedAt}`,
    trigger,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    overallScore,
    counts,
    sources,
    cross,
    storage: storageKind(),
    agentTriggered: shouldInvokeAgent,
  };
  await saveAuditRun(run);
  // cada auditoria também alimenta o histórico próprio de PLD (Firestore) — base do fallback "last known good"
  if (results.ccee_pld.ok && results.ccee_pld.data) {
    await savePldDays(panelToDays(results.ccee_pld.data as SubPanel, "ccee")).catch(() => 0);
  } else if (results.ons_cmo.ok && results.ons_cmo.data) {
    await savePldDays(panelToDays(pldFromCmo(results.ons_cmo.data as SubPanel), PLD_FROM_CMO)).catch(() => 0);
  }
  return { run, previous, results, shouldInvokeAgent, reasons };
}
