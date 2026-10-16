import { buildGridReport } from "@/lib/grid/report";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Intercâmbio entre subsistemas (medido e programado, ONS) com o PLD dos dois lados e o último
 * retrato do fluxo de potência AC do SIN. `?dias=N` (2–14, padrão 7) de intercâmbio.
 */
export async function GET(req: Request) {
  try {
    const n = Number(new URL(req.url).searchParams.get("dias") ?? 7);
    const days = Number.isFinite(n) ? Math.min(14, Math.max(2, Math.round(n))) : 7;
    const r = await buildGridReport(days);
    return jsonResponse(r, 900, r.interchange || r.grid ? 200 : 502);
  } catch (e) {
    return errorResponse(e);
  }
}
