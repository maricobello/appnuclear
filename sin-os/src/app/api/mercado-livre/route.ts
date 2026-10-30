import { buildFreeMarketInputs } from "@/lib/market/free-market";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Insumos do simulador de contratação no mercado livre: faixas de preço dos próximos 12 meses
 * (planejamento), correlação entre meses implícita nos cenários do SDDP, forma horária do PLD no
 * último ano, limites e bandeiras. A curva de carga do usuário não passa por aqui: o cálculo roda
 * no navegador.
 */
export async function GET() {
  try {
    return jsonResponse(await buildFreeMarketInputs(), 900);
  } catch (e) {
    return errorResponse(e);
  }
}
