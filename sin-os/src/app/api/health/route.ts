import { healthOf } from "@/lib/audit/alert";
import { listAuditRuns } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Endpoint de saúde para monitoramento externo (cron/uptime). Retorna 200 quando a
 * última auditoria está saudável e 503 quando degradada — assim um `curl -f` ou um
 * monitor grátis (UptimeRobot, cron do GitHub) avisa sem precisar ler o corpo.
 * O bloqueio esperado da CCEE não derruba a saúde (o PLD vem do CMO do ONS).
 */
export async function GET() {
  const last = (await listAuditRuns(1).catch(() => []))[0] ?? null;
  if (!last) return Response.json({ healthy: null, reason: "sem auditoria ainda" }, { status: 200, headers: { "Cache-Control": "no-store" } });
  const h = healthOf(last);
  return Response.json(
    { healthy: h.healthy, score: h.score, reasons: h.reasons, at: last.startedAt, ageMinutes: Math.round((Date.now() - last.startedAt) / 60_000) },
    { status: h.healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
