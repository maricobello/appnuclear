import { postAlert } from "@/lib/audit/alert";
import { alertKind } from "@/lib/audit/health";
import { authorize } from "@/lib/auth";
import { claimSlot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Dispara uma notificação de TESTE no destino de ALERT_WEBHOOK_URL (ntfy, Slack,
 * Discord, Teams) para validar a configuração. Com ADMIN_KEY/CRON_SECRET, exige a
 * credencial; sem elas, fica limitado a 1 envio por hora (global) para não virar spam.
 * Nunca devolve a URL do destino.
 */
export async function POST(req: Request) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return Response.json({ configured: false, sent: false, error: "defina ALERT_WEBHOOK_URL na Vercel" }, { status: 400 });
  const auth = authorize(req);
  if (!auth.ok) return Response.json({ error: "não autorizado" }, { status: 401 });
  if (!(await claimSlot("alert_test", auth.privileged ? 60_000 : 3600_000))) {
    return Response.json({ configured: true, sent: false, throttled: true, destination: alertKind(url) }, { status: 429 });
  }
  const base = process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app";
  const sent = await postAlert(url, {
    kind: "test",
    title: "SIN OS - teste de alerta",
    text: `🧪 SIN OS — teste de alerta: o destino está recebendo as notificações de saúde da auditoria.\n${base}/auditoria`,
  });
  return Response.json({ configured: true, sent, destination: alertKind(url) }, { status: sent ? 200 : 502 });
}
