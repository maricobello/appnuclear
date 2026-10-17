import "server-only";
import { auditModels, type ModelAudit } from "./audit/models";
import { runSelfEval } from "./audit/selfeval";
import { evaluateTrackRecord } from "./audit/track-record";
import { cached } from "./cache";
import { getBrazilBundle } from "./data";
import { bessArbitrage, DEFAULT_BESS } from "./market/arbitrage";
import { BESS_QUERY, toBessParams } from "./market/bess-params";
import { PLD_LIMITS, toDayMatrix } from "./market/brazil";
import { publicForecast } from "./market/forecast";
import { loadForecastLog } from "./forecast-log";
import { snapshotAgeDays } from "./grid/snapshot";
import { loadGridSnapshot } from "./grid/store";
import { thermalReport } from "./market/thermal";
import { getRegimeBacktest } from "./regimes";
import { fetchThermal } from "./sources/ons-thermal";
import { getBessStudy, getForecast } from "./services";
import { brtDate } from "./sources/time";
import { SUBS, type Sub } from "./sources/types";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
/** Espera no máximo `ms`; passado o prazo, a parte fica marcada como não calculada (e a auditoria sai assim mesmo). */
const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T | { error: string }> =>
  Promise.race([p.catch((e) => ({ error: msg(e) })), new Promise<{ error: string }>((r) => setTimeout(() => r({ error: `${what} não terminou em ${Math.round(ms / 1000)} s` }), ms))]);

/**
 * Roda todos os modelos sobre o PLD real e audita o resultado (ver audit/models.ts). Usa os mesmos
 * caches das telas: previsão (30 min), backtest por regime (1x/dia), estudo do BESS (15 min).
 */
export async function buildModelAudit(now = Date.now()): Promise<ModelAudit> {
  const br = await getBrazilBundle();
  const fc = Object.fromEntries(await Promise.all(SUBS.map(async (s) => [s, await within(getForecast(s), 120_000, `previsão ${s}`)] as const))) as Record<Sub, Awaited<ReturnType<typeof getForecast>> | { error: string }>;
  const ok = (s: Sub) => {
    const v = fc[s];
    return "error" in v ? null : v;
  };

  const [regimes, bess, arb, grid, thermal] = await Promise.all([
    Promise.all(SUBS.map(async (s) => [s, await within(getRegimeBacktest(s), 150_000, `backtest por regime ${s}`)] as const)).then((e) => Object.fromEntries(e)),
    within(
      getBessStudy(toBessParams("SE", BESS_QUERY.parse({}))).then(({ study }) => ({ days: study.daily, maxCycles: study.params.maxCyclesPerDay })),
      90_000,
      "estudo do BESS",
    ),
    ok("SE")
      ? within(
          cached(`model-audit:arb:${ok("SE")!.fc.generatedAt}`, 30 * 60_000, () => bessArbitrage(ok("SE")!.fc, DEFAULT_BESS)).then((r) => ({ captureRatio: r.value.realized?.captureRatio ?? null })),
          90_000,
          "arbitragem SE",
        )
      : Promise.resolve(null),
    loadGridSnapshot().then(
      (g) => ({ snapshot: g.snapshot, ageDays: g.snapshot ? snapshotAgeDays(g.snapshot.date, brtDate(now)) : null }),
      () => null,
    ),
    within(
      fetchThermal(10, now).then((r) => {
        if (!r.ok || !r.data) throw new Error(r.error ?? "sem dados");
        const rep = thermalReport(r.data.rows, r.data.cvus, null, null, 7);
        return { identityMaxGap: rep.checks.identityMaxGap, cvuCoverage: rep.checks.cvuCoverage, to: rep.to };
      }),
      60_000,
      "despacho térmico",
    ),
  ]);

  const p = br.pld;
  // previsões publicadas (gravadas no dia em que saíram) × PLD realizado
  const trackRecords =
    p.ok && p.data && !p.simulated
      ? Object.fromEntries(await Promise.all(SUBS.map(async (s) => [s, evaluateTrackRecord(await loadForecastLog(s), toDayMatrix(p.data!, s))] as const)))
      : {};
  const cut = now - 30 * 86400_000;
  const idx = p.ok && p.data ? p.data.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= cut).map(([, i]) => i) : [];
  const pld = p.ok && p.data && !p.simulated ? { ts: idx.map((i) => p.data!.ts[i]), values: Object.fromEntries(SUBS.map((s) => [s, idx.map((i) => p.data!.values[s][i])])) as Record<Sub, (number | null)[]> } : null;

  return auditModels({
    now,
    forecasts: Object.fromEntries(SUBS.map((s) => [s, ok(s) ? publicForecast(ok(s)!.fc) : (fc[s] as { error: string })])),
    regimes,
    bess,
    arbitrage: arb,
    selfEval: runSelfEval(now),
    pld,
    limits: { min: PLD_LIMITS.min, maxHourly: PLD_LIMITS.maxHourly },
    pldSource: p.simulated ? "PLD simulado (fontes fora do ar)" : p.fallback ? "PLD estimado pelo CMO/DESSEM do ONS (a CCEE não responde ao servidor)" : (p.note ?? "PLD oficial da CCEE"),
    trackRecords,
    grid,
    thermal,
  });
}
