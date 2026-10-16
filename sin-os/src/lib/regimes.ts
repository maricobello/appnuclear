import "server-only";
import { cached } from "./cache";
import { getPld } from "./data";
import { regimeBacktest, type RegimeBacktestResult } from "./market/regime-backtest";
import { fetchEarDaily } from "./sources/ons";
import { brtDate } from "./sources/time";
import type { Sub } from "./sources/types";
import { loadDoc, saveDoc } from "./store";

export type StoredRegimes = RegimeBacktestResult & { pldSource: string; computedAt: number };

/** Sobe quando o método muda, para não servir o resultado do dia calculado pelo método antigo. */
const METHOD_VERSION = 2;

/**
 * Erro da previsão de D+1 contra o ingênuo por regime (período hidrológico, nível do
 * reservatório, piso recente, faixa de PLD), num walk-forward de 365 dias. Calculado uma vez por dia por
 * submercado e guardado (memória + Firestore): a tela de Previsão e a auditoria dos modelos
 * leem o mesmo resultado.
 */
export async function getRegimeBacktest(sub: Sub): Promise<StoredRegimes> {
  const id = `${sub}_${brtDate(Date.now())}_v${METHOD_VERSION}`;
  const { value } = await cached(`regimes:${id}`, 12 * 3600_000, async (): Promise<StoredRegimes> => {
    const stored = await loadDoc<StoredRegimes>("regime_backtest", id).catch(() => null);
    if (stored) return stored;
    const [pld, ear] = await Promise.all([getPld(500), fetchEarDaily(500)]);
    if (!pld.ok || !pld.data || pld.simulated) throw new Error(`PLD indisponível para o backtest: ${pld.error ?? "sem dados"}`);
    const r = regimeBacktest(pld.data, sub, ear.ok ? ear.data : null, 365);
    const doc: StoredRegimes = { ...r, pldSource: pld.fallback ? "PLD estimado pelo CMO/DESSEM (ONS)" : (pld.note ?? "PLD oficial da CCEE"), computedAt: Date.now() };
    await saveDoc("regime_backtest", id, doc).catch(() => undefined);
    return doc;
  });
  return value;
}
