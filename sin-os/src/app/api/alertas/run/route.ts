import { authorize } from "@/lib/auth";
import { notifyMarketAlerts, notifyPldPublished } from "@/lib/audit/runner";
import { claimSlot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Checagem leve de alertas (PLD publicado + alertas de mercado), sem rodar a auditoria inteira.
 * Feita para um agendador externo (ex.: cron-job.org a cada 15 min) com
 * "Authorization: Bearer <ADMIN_KEY ou CRON_SECRET>". Cada alerta sai uma vez só.
 */
async function handle(req: Request) {
  const auth = authorize(req);
  if (!auth.privileged) return Response.json({ error: "não autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!(await claimSlot("alerts_run", 5 * 60_000).catch(() => true))) return Response.json({ ok: true, skipped: "rodou há menos de 5 min" }, { headers: { "Cache-Control": "no-store" } });
  const [pld, market] = await Promise.all([notifyPldPublished().catch(() => 0), notifyMarketAlerts().catch(() => 0)]);
  return Response.json({ ok: true, sent: { pldPublicado: pld, mercado: market } }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
