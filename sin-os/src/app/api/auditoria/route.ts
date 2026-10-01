import { AGENT_MODEL } from "@/lib/audit/agent";
import { alertKind } from "@/lib/audit/health";
import { computeSlo } from "@/lib/audit/slo";
import { dataMode } from "@/lib/data";
import { firebaseStatus } from "@/lib/firebase";
import { quantile } from "@/lib/quant/stats";
import { errorResponse } from "@/lib/services";
import { recentTelemetry } from "@/lib/sources/http";
import { SOURCE_LIST } from "@/lib/sources/registry";
import { listAgentReports, listAuditRuns, storageKind } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const lite = new URL(req.url).searchParams.get("lite") === "1";
    const runs = await listAuditRuns(lite ? 1 : 48);
    const latest = runs[0] ?? null;
    if (lite) {
      return Response.json(
        { latest: latest ? { id: latest.id, startedAt: latest.startedAt, overallScore: latest.overallScore, counts: latest.counts } : null, dataMode: dataMode() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const reports = await listAgentReports(3);
    const byHost = new Map<string, { lat: number[]; errors: number; count: number }>();
    for (const p of recentTelemetry()) {
      const host = (() => { try { return new URL(p.url).host; } catch { return p.url; } })();
      const e = byHost.get(host) ?? { lat: [], errors: 0, count: 0 };
      e.count++;
      e.lat.push(p.latencyMs);
      if (!p.ok) e.errors++;
      byHost.set(host, e);
    }
    const telemetry = [...byHost.entries()].map(([host, e]) => ({
      host,
      count: e.count,
      errors: e.errors,
      p50: quantile(e.lat, 0.5),
      p95: quantile(e.lat, 0.95),
    }));
    return Response.json(
      {
        latest,
        slo: computeSlo(runs),
        history: runs.map((r) => ({ id: r.id, startedAt: r.startedAt, overallScore: r.overallScore, counts: r.counts, trigger: r.trigger })).reverse(),
        reports,
        registry: SOURCE_LIST,
        telemetry,
        storage: storageKind(),
        firebase: firebaseStatus(),
        agent: { configured: !!process.env.ANTHROPIC_API_KEY, model: AGENT_MODEL },
        alerts: process.env.ALERT_WEBHOOK_URL ? { configured: true, destination: alertKind(process.env.ALERT_WEBHOOK_URL) } : { configured: false, destination: null },
        auth: { required: !!(process.env.CRON_SECRET || process.env.ADMIN_KEY) },
        dataMode: dataMode(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e, 500);
  }
}
