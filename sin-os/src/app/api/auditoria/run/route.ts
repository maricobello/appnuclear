import { runAuditAgent } from "@/lib/audit/agent";
import { runAudit } from "@/lib/audit/runner";
import type { AuditRun } from "@/lib/audit/types";
import { authorize } from "@/lib/auth";
import { listAuditRuns } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
