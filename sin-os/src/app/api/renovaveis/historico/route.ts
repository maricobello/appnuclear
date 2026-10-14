import { curtailmentHistory } from "@/lib/sources/ons-renewables-history";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Corte de eólica + solar por mês (ONS), últimos `?meses=N` (3–24, padrão 12). Cada mês fica em
 * cache persistente e só é recalculado quando o ONS republica o arquivo — o que fica registrado.
 */
export async function GET(req: Request) {
  try {
    const n = Number(new URL(req.url).searchParams.get("meses") ?? 12);
    const months = Number.isFinite(n) ? Math.min(24, Math.max(3, Math.round(n))) : 12;
    const list = await curtailmentHistory(months);
    if (!list.length) return errorResponse(new Error("histórico do ONS indisponível agora"));
    return jsonResponse({ generatedAt: Date.now(), months: list.map((m) => ({ ...m, version: undefined })) }, 6 * 3600);
  } catch (e) {
    return errorResponse(e);
  }
}
