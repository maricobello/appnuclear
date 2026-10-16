import { getRegimeBacktest } from "@/lib/regimes";
import { errorResponse, jsonResponse, SUB_PARAM } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Erro da previsão de D+1 contra o ingênuo por regime (período hidrológico, nível do
 * reservatório, piso recente, faixa de PLD), num walk-forward de 365 dias (um ciclo hidrológico completo). Recalculado uma vez por dia.
 */
export async function GET(req: Request) {
  try {
    const sub = SUB_PARAM(new URL(req.url).searchParams.get("sub"));
    return jsonResponse(await getRegimeBacktest(sub), 3600);
  } catch (e) {
    return errorResponse(e);
  }
}
