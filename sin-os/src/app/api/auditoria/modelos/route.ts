import { cached } from "@/lib/cache";
import { buildModelAudit } from "@/lib/model-audit";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Auditoria dos modelos sobre o PLD real (previsão, bandas, quantis, GARCH, MRJD, HMM, backtest
 * de 1 ano por regime, despacho da bateria, arbitragem e o próprio auditor). Recalculada no
 * máximo 1x por hora; a CDN responde nesse intervalo.
 */
export async function GET() {
  try {
    const { value } = await cached("model-audit", 60 * 60_000, () => buildModelAudit());
    return jsonResponse(value, 3600);
  } catch (e) {
    return errorResponse(e);
  }
}
