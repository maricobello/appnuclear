import { buildThermalReport } from "@/lib/market/thermal-report";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despacho térmico por motivo (ONS), pilha de mérito com o CMO e o ESS estimado pela regra da CCEE.
 * `?dias=N` (3–31, padrão 7) dias fechados.
 */
export async function GET(req: Request) {
  try {
    const n = Number(new URL(req.url).searchParams.get("dias") ?? 7);
    const days = Number.isFinite(n) ? Math.min(31, Math.max(3, Math.round(n))) : 7;
    const r = await buildThermalReport(days);
    return jsonResponse(r, 900, r.report ? 200 : 502);
  } catch (e) {
    return errorResponse(e);
  }
}
