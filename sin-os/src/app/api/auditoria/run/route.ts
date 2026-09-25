import { timingSafeEqual } from "node:crypto";
import { runAuditAgent } from "@/lib/audit/agent";
import { runAudit } from "@/lib/audit/runner";
import type { AuditRun } from "@/lib/audit/types";
import { listAuditRuns } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Autorização:
 *  - Vercel Cron envia "Authorization: Bearer $CRON_SECRET" automaticamente.
 *  - GitHub Actions / execução manual: mesmo header ou "x-admin-key: $ADMIN_KEY".
 * Sem nenhum segredo configurado, a auditoria determinística fica aberta (com
 * limite de 1 execução/min) e o agente IA (que tem custo) não é acionado.
 */
function authorize(req: Request): { ok: boolean; privileged: boolean } {
  const cron = process.env.CRON_SECRET;
  const admin = process.env.ADMIN_KEY;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const key = req.headers.get("x-admin-key") ?? "";
  const privileged = (!!cron && !!bearer && safeEq(bearer, cron)) || (!!admin && !!key && safeEq(key, admin)) || (!!admin && !!bearer && safeEq(bearer, admin));
  if (privileged) return { ok: true, privileged };
  return { ok: !cron && !admin, privileged: false };
}

function triggerOf(req: Request): AuditRun["trigger"] {
  const ua = req.headers.get("user-agent") ?? "";
  if (/vercel-cron/i.test(ua)) return "cron";
  const t = req.headers.get("x-trigger");
  return t === "github" ? "github" : t === "api" ? "api" : "manual";
}

async function handle(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return Response.json({ error: "não autorizado" }, { status: 401 });
  const url = new URL(req.url);

  if (!auth.privileged) {
    const last = (await listAuditRuns(1).catch(() => []))[0];
    if (last && Date.now() - last.startedAt < 60_000) {
      return Response.json({ run: last, report: null, reasons: ["limite: 1 execução/min sem credencial"], throttled: true });
    }
  }

  const outcome = await runAudit(triggerOf(req));
  const wantAgent = url.searchParams.get("agent") !== "false";
  let report = null;
  let agentError: string | null = null;
  if (auth.privileged && wantAgent && outcome.shouldInvokeAgent) {
    try {
      report = await runAuditAgent(outcome);
    } catch (e) {
      agentError = e instanceof Error ? e.message : String(e);
    }
  }
  return Response.json(
    { run: outcome.run, reasons: outcome.reasons, report, agentError, agentEligible: outcome.shouldInvokeAgent && auth.privileged },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
