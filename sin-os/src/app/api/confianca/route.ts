import { buildTrustReport } from "@/lib/audit/trust-report";
import { errorResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Selos de confiança dos dados abertos: revisões retroativas detectadas nos últimos 30 dias
 * (um dia fechado que reapareceu com valores diferentes) e completude dos últimos 10 dias
 * fechados, por fonte. Não afirma qual versão está certa — mostra que o passado mudou.
 */
export async function GET() {
  try {
    return Response.json(await buildTrustReport(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
  } catch (e) {
    return errorResponse(e);
  }
}
