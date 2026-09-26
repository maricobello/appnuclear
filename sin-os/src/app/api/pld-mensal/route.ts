import { getBrazilBundle, publicMeta } from "@/lib/data";
import { monthlyPldFromPanel } from "@/lib/market/book";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PLD médio mensal por submercado (do painel realizado do app) — base da liquidação da carteira. */
export async function GET() {
  try {
    const br = await getBrazilBundle();
    if (!br.pld.data) throw new Error(br.pld.error ?? "PLD indisponível");
    const monthly = monthlyPldFromPanel(br.pld.data);
    return jsonResponse({ ...monthly, meta: publicMeta(br.pld), simulated: br.pld.simulated, fallback: br.pld.fallback ?? null }, 600);
  } catch (e) {
    return errorResponse(e);
  }
}
