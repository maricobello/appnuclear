import "server-only";
import { invalidate } from "../cache";
import { fetchPldHourly } from "../sources/ccee";
import { fetchPldPI } from "../sources/ccee-pi";
import { fetchEia } from "../sources/eia";
import { fetchEuPrices } from "../sources/europe";
import { fetchFx, type FxData } from "../sources/fx";
import { fetchCmoHourly, fetchEarDaily, fetchEnaDaily, fetchLoadHourly } from "../sources/ons";
import { fetchBalance, fetchCurtailment, fetchInterchange } from "../sources/ons-renewables";
import { SOURCES } from "../sources/registry";
import { SUBS, type SourceId, type SourceResult, type SubPanel } from "../sources/types";
import { fetchUkCarbon, fetchUkMid, fetchUkSystemPrices } from "../sources/uk";
import { fetchBasinEnsemble, fetchWeather } from "../sources/weather";
import { getPld, PLD_FROM_CMO, panelToDays, recentDays } from "../data";
import { brtDate, brtHour } from "../sources/time";
import { curtailmentDailyPanel } from "../market/renewables";
import { pickDay } from "../market/opportunities";
import { postAlert } from "./alert";
import { evaluateMarketAlerts, thresholdsFromEnv } from "./market-alerts";
import { pldPublishedMessage } from "./pld-alert";
import { pldFromCmo } from "../market/brazil";
import { claimSlot, euZoneStore, listAuditRuns, saveAuditRun, savePldDays, storageKind } from "../store";
import { notifyHealthChange } from "./alert";
import { auditSource, crossFx, crossPldCmo } from "./checks";
import { runTrustCheck } from "./trust-run";
import type { AuditRun, SourceAudit } from "./types";

/** Sondas "frescas" (cache invalidado) de todas as fontes, em paralelo. */
export async function probeAll(): Promise<Record<SourceId, SourceResult<unknown>>> {
  invalidate("");
  const entries = await Promise.all([
    fetchPldHourly(30),
    fetchPldPI(3),
    fetchCmoHourly(10),
    fetchEarDaily(30),
    fetchEnaDaily(30),
    fetchLoadHourly(10),
    fetchCurtailment(12), // 12 dias: a camada de confiança compara os últimos 10 fechados
    fetchBalance(3),
    fetchInterchange(3),
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
    ccee_pi: () => fetchPldPI(3),
    ons_cmo: () => fetchCmoHourly(10),
    ons_ear: () => fetchEarDaily(30),
    ons_ena: () => fetchEnaDaily(30),
    ons_carga: () => fetchLoadHourly(10),
    ons_curtailment: () => fetchCurtailment(12),
    ons_balanco: () => fetchBalance(3),
    ons_intercambio: () => fetchInterchange(3),
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
  const shouldInvokeAgent = !!process.env.GROQ_API_KEY && (reasons.length > 0 || trigger === "manual");

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
  await notifyHealthChange(run, previous).catch(() => false);
  // cada auditoria também alimenta o histórico próprio de PLD (Firestore) — base do fallback "last known good"
  if (results.ccee_pld.ok && results.ccee_pld.data) {
    await savePldDays(recentDays(panelToDays(results.ccee_pld.data as SubPanel, "ccee"), 30)).catch(() => 0);
  } else if (results.ons_cmo.ok && results.ons_cmo.data) {
    await savePldDays(recentDays(panelToDays(pldFromCmo(results.ons_cmo.data as SubPanel), PLD_FROM_CMO), 30)).catch(() => 0);
  }
  await notifyPldPublished().catch(() => 0);
  await notifyMarketAlerts().catch(() => 0);
  // revisões retroativas dos dados abertos (no máx. 1 verificação a cada 5 h, para poupar leituras)
  if (await claimSlot("trust_check", 5 * 3600_000).catch(() => false)) await runTrustCheck(results).catch(() => undefined);
  return { run, previous, results, shouldInvokeAgent, reasons };
}

/**
 * Avisa (uma vez por data, trava global no Firestore) quando o PLD completo de hoje ou de
 * amanhã fica disponível. Opt-in por ALERT_WEBHOOK_URL; PLD_ALERTS=off desliga;
 * PLD_ALERT_ABOVE marca submercados com máximo acima do valor.
 */
export async function notifyPldPublished(now = Date.now()): Promise<number> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || process.env.PLD_ALERTS === "off") return 0;
  const pld = await getPld(10);
  if (!pld.ok || !pld.data || pld.simulated) return 0;
  const today = brtDate(now);
  const official = !pld.fallback;
  const days = panelToDays(pld.data, official ? "ccee" : PLD_FROM_CMO).filter((d) => d.date >= today).slice(-2);
  const above = Number(process.env.PLD_ALERT_ABOVE);
  let sent = 0;
  for (const d of days) {
    if (!(await claimSlot(`pldpub_${d.date}_${official ? "oficial" : "cmo"}`, 400 * 86400_000, now))) continue;
    const msg = pldPublishedMessage({ date: d.date, values: d.values, official }, today, process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app", Number.isFinite(above) ? above : undefined);
    if (await postAlert(url, msg)) sent++;
  }
  return sent;
}

/**
 * Alertas de mercado (pico de PLD, descolamento entre submercados, janela de bateria, corte de
 * renováveis disparando), cada um enviado uma vez (trava global no Firestore). Opt-in por
 * ALERT_WEBHOOK_URL; MARKET_ALERTS=off desliga; limiares em ALERT_PLD_MAX, ALERT_SPREAD,
 * ALERT_INTRADAY, ALERT_CURTAIL_FACTOR e ALERT_CURTAIL_MIN_GWH.
 */
/** Alertas de mercado que valem agora (sem enviar nada). */
export async function currentMarketAlerts(now = Date.now()) {
  const [pld, curt] = await Promise.all([getPld(10), fetchCurtailment(10, now)]);
  const today = brtDate(now);
  const day = pld.ok && pld.data && !pld.simulated ? pickDay(pld.data.ts, pld.data.values, today, brtDate, brtHour) : null;
  const panel = curt.ok && curt.data ? curtailmentDailyPanel(curt.data) : null;
  const curtailDaily = panel
    ? panel.dates.flatMap((d, i) => {
        const v = SUBS.map((s) => panel.values[s][i]);
        return v.every((x) => x !== null) && d < today ? [{ date: d, mwh: (v as number[]).reduce((a, b) => a + b, 0) }] : [];
      })
    : [];
  const thresholds = thresholdsFromEnv();
  const alerts = evaluateMarketAlerts(
    {
      day: day && day.published ? { date: day.date, values: day.values, official: !pld.fallback } : null,
      today,
      curtailDaily,
      baseUrl: process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app",
    },
    thresholds,
  );
  return { alerts, thresholds, day: day?.published ? day.date : null, pldOfficial: !!pld.ok && !pld.fallback };
}

export async function notifyMarketAlerts(now = Date.now()): Promise<number> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || process.env.MARKET_ALERTS === "off") return 0;
  const { alerts } = await currentMarketAlerts(now);
  let sent = 0;
  for (const a of alerts) {
    if (!(await claimSlot(`mkt_${a.id}`, 400 * 86400_000, now))) continue;
    if (await postAlert(url, a.message)) sent++;
  }
  return sent;
}
