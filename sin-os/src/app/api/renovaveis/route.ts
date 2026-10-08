import { buildRenewablesReport } from "@/lib/market/renewables-report";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Corte de eólica e solar (constrained-off) e carga líquida, das bases abertas do ONS, cruzados
 * com o PLD. `?dias=N` (3–31, padrão 14) dias fechados.
 */
export async function GET(req: Request) {
  try {
    const n = Number(new URL(req.url).searchParams.get("dias") ?? 14);
    const days = Number.isFinite(n) ? Math.min(31, Math.max(3, Math.round(n))) : 14;
    const r = await buildRenewablesReport(days);
    return jsonResponse(r, 900, r.curtailment || r.netLoad ? 200 : 502);
  } catch (e) {
    return errorResponse(e);
  }
}
