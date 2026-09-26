import { describe, expect, it } from "vitest";
import { alertRequest, healthTransition } from "../src/lib/audit/health";
import { computeSlo } from "../src/lib/audit/slo";
import type { AuditRun, SourceAudit } from "../src/lib/audit/types";

const src = (id: SourceAudit["id"], status: SourceAudit["status"], latencyMs: number | null = 500): SourceAudit => ({
  id, name: id, provider: "t", region: "BR", status, score: status === "ok" ? 100 : 40, checks: [],
  latencyMs, httpStatus: 200, attempts: 1, latestTs: null, ageHours: null, points: 10,
});
const run = (t: number, score: number, sources: SourceAudit[]): AuditRun => ({
  id: `r${t}`, trigger: "github", startedAt: t, finishedAt: t + 1, durationMs: 1, overallScore: score,
  counts: { ok: 0, degraded: 0, down: 0, disabled: 0 }, sources, cross: [], storage: "firestore", agentTriggered: false,
});

describe("SLO a partir do histórico do auditor", () => {
  it("disponibilidade, conformidade, latência e % saudável", () => {
    const runs = [
      run(3, 90, [src("ons_cmo", "ok", 100), src("ccee_pld", "down", null)]),
      run(2, 90, [src("ons_cmo", "degraded", 300), src("ccee_pld", "down", null)]),
      run(1, 50, [src("ons_cmo", "down", 900), src("ccee_pld", "down", null)]),
      run(0, 90, [src("ons_cmo", "ok", 200), src("ccee_pld", "down", null)]),
    ];
    const s = computeSlo(runs);
    expect(s.samples).toBe(4);
    expect(s.fromTs).toBe(0);
    expect(s.toTs).toBe(3);
    const cmo = s.sources.find((x) => x.id === "ons_cmo")!;
    expect(cmo.availabilityPct).toBe(75);
    expect(cmo.okPct).toBe(50);
    expect(cmo.latencyP50).toBeGreaterThanOrEqual(200);
    expect(cmo.latencyP50).toBeLessThanOrEqual(300);
    const ccee = s.sources.find((x) => x.id === "ccee_pld")!;
    expect(ccee.expectedDown).toBe(true);
    expect(ccee.latencyP50).toBeNull();
    // ccee "down" é esperado e não derruba a saúde; o run 1 (score 50 + CMO fora) sim
    expect(s.healthyPct).toBe(75);
    expect(computeSlo([]).samples).toBe(0);
  });

  it("alerta só na transição e no formato do destino (ntfy = texto + cabeçalhos)", () => {
    const good = run(2, 90, [src("ons_cmo", "ok")]);
    const bad = run(1, 90, [src("ons_cmo", "down")]);
    expect(healthTransition(good, good, "https://x")).toBeNull();
    const deg = healthTransition(bad, good, "https://x")!;
    expect(deg.kind).toBe("degraded");
    expect(deg.text).toContain("ons_cmo fora do ar");
    expect(healthTransition(good, bad, "https://x")!.kind).toBe("recovered");

    const n = alertRequest("https://ntfy.sh/sinos-abc", deg, undefined);
    expect(n.headers["Content-Type"]).toMatch(/text\/plain/);
    expect(n.headers.Priority).toBe("high");
    expect(n.headers.Click).toBe("https://x/auditoria");
    expect(n.body).toBe(deg.text);
    // cabeçalhos HTTP precisam ser latin-1: o título não pode ter emoji
    expect(/^[\x20-\x7e]*$/.test(n.headers.Title)).toBe(true);

    const j = alertRequest("https://hooks.slack.com/services/x", deg, undefined);
    expect(JSON.parse(j.body)).toEqual({ text: deg.text, content: deg.text });
    expect(alertRequest("https://example.com/hook", deg, "ntfy").headers.Title).toBeTruthy();
  });
});
