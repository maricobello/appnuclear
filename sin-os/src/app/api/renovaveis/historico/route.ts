import { curtailmentHistoryWithin } from "@/lib/sources/ons-renewables-history";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Corte de eólica + solar por mês (ONS), últimos `?meses=N` (3–24, padrão 12). Cada mês fica em
 * cache persistente e só é recalculado quando o ONS republica o arquivo — o que fica registrado.
 * Com prazo de 40 s: se faltar mês, a resposta diz quantos e fica pouco tempo na CDN.
 */
export async function GET(req: Request) {
  try {
    const n = Number(new URL(req.url).searchParams.get("meses") ?? 12);
    const months = Number.isFinite(n) ? Math.min(24, Math.max(3, Math.round(n))) : 12;
    const { months: list, missing } = await curtailmentHistoryWithin(months, 40_000);
    if (!list.length) return errorResponse(new Error("histórico do ONS indisponível agora"));
    return jsonResponse({ generatedAt: Date.now(), months: list.map((m) => ({ ...m, version: undefined })), missing }, missing ? 120 : 6 * 3600);
  } catch (e) {
    return errorResponse(e);
  }
}
