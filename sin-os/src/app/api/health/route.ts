import { healthWithAge } from "@/lib/audit/alert";
import { firebaseStatus } from "@/lib/firebase";
import { listAuditRuns } from "@/lib/store";

export const dynamic = "force-dynamic";

// monitores externos podem consultar a cada minuto: a CDN responde por 60 s
const CDN_CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };

/**
 * Endpoint de saúde para monitoramento externo (cron/uptime). Retorna 200 quando a última
 * auditoria está saudável E recente, e 503 quando degradada OU antiga (auditor parado).
 * O bloqueio esperado da CCEE não derruba a saúde (o PLD vem do CMO do ONS).
 */
export async function GET() {
  const last = (await listAuditRuns(1).catch(() => []))[0] ?? null;
  if (!last) {
    const fb = firebaseStatus();
    const reason = fb.configured && fb.error ? `histórico do auditor indisponível: ${fb.error}` : "sem auditoria ainda";
    return Response.json({ healthy: null, reason }, { status: 200, headers: CDN_CACHE });
  }
  const h = healthWithAge(last);
  return Response.json(
    { healthy: h.healthy, score: h.score, reasons: h.reasons, at: last.startedAt, ageMinutes: h.ageMinutes },
    { status: h.healthy ? 200 : 503, headers: CDN_CACHE },
  );
}
