import { buildPlanView } from "@/lib/planning/view";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Planejamento da operação: o último relatório do NovoModelo (SDDP oficial de ONS/CCEE/EPE) rodado
 * sobre o caso do SIN montado com dados abertos do ONS, e o PLD realizado para comparar.
 */
export async function GET() {
  try {
    const r = await buildPlanView();
    return jsonResponse(r, 900, 200);
  } catch (e) {
    return errorResponse(e);
  }
}
