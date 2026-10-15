import { cached } from "@/lib/cache";
import { getPld } from "@/lib/data";
import { regimeBacktest, type RegimeBacktestResult } from "@/lib/market/regime-backtest";
import { errorResponse, jsonResponse, SUB_PARAM } from "@/lib/services";
import { fetchEarDaily } from "@/lib/sources/ons";
import { brtDate } from "@/lib/sources/time";
import { loadDoc, saveDoc } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Stored = RegimeBacktestResult & { pldSource: string; computedAt: number };

/**
 * Erro da previsão de D+1 contra o ingênuo por regime (período hidrológico, nível do
 * reservatório, faixa de PLD), num walk-forward de 365 dias (um ciclo hidrológico completo). Recalculado uma vez por dia.
 */
export async function GET(req: Request) {
  try {
    const sub = SUB_PARAM(new URL(req.url).searchParams.get("sub"));
    const id = `${sub}_${brtDate(Date.now())}`;
    const { value } = await cached(`regimes:${id}`, 12 * 3600_000, async (): Promise<Stored> => {
      const stored = await loadDoc<Stored>("regime_backtest", id).catch(() => null);
      if (stored) return stored;
      const [pld, ear] = await Promise.all([getPld(500), fetchEarDaily(500)]);
      if (!pld.ok || !pld.data || pld.simulated) throw new Error(`PLD indisponível para o backtest: ${pld.error ?? "sem dados"}`);
      const r = regimeBacktest(pld.data, sub, ear.ok ? ear.data : null, 365);
      const doc: Stored = { ...r, pldSource: pld.fallback ? "PLD estimado pelo CMO/DESSEM (ONS)" : (pld.note ?? "PLD oficial da CCEE"), computedAt: Date.now() };
      await saveDoc("regime_backtest", id, doc).catch(() => undefined);
      return doc;
    });
    return jsonResponse(value, 3600);
  } catch (e) {
    return errorResponse(e);
  }
}
