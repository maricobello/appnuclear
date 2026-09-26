import { getBrazilBundle, getPld, publicMeta } from "@/lib/data";
import { monthlyPldFromPanel } from "@/lib/market/book";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PLD médio mensal por submercado — base da liquidação da carteira. Puxa uma janela longa
 * (padrão ~2 anos) para que PPAs anuais liquidem o período realizado inteiro, não só os
 * meses recentes; a fonte é o CMO do ONS pela regra da ANEEL (mesmo do resto do app).
 */
export async function GET(req: Request) {
  try {
    const days = Math.min(1460, Math.max(120, Number(new URL(req.url).searchParams.get("days")) || 760));
    const pld = await getPld(days);
    if (!pld.data) {
      const br = await getBrazilBundle(); // fallback para o bundle padrão
      if (!br.pld.data) throw new Error(pld.error ?? "PLD indisponível");
      const m = monthlyPldFromPanel(br.pld.data);
      return jsonResponse({ ...m, meta: publicMeta(br.pld), simulated: br.pld.simulated, fallback: br.pld.fallback ?? null }, 600);
    }
    const monthly = monthlyPldFromPanel(pld.data);
    return jsonResponse({ ...monthly, meta: publicMeta(pld), simulated: pld.simulated, fallback: pld.fallback ?? null }, 600);
  } catch (e) {
    return errorResponse(e);
  }
}
