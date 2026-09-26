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

describe("aviso de publicação do PLD", () => {
  it("resume média/mín/máx e hora do pico por submercado, com fonte e alerta de limiar", async () => {
    const { pldPublishedMessage } = await import("../src/lib/audit/pld-alert");
    const flat = (v: number) => Array.from({ length: 24 }, (_, h) => (h === 19 ? v * 3 : v));
    const msg = pldPublishedMessage({ date: "2026-09-27", values: { SE: flat(100), S: flat(90), NE: flat(60), N: flat(60) }, official: true }, "2026-09-26", "https://x", 250);
    expect(msg.kind).toBe("pld");
    expect(msg.title).toContain("amanhã (27/09)");
    expect(msg.title).toContain("oficial CCEE");
    expect(/^[\x20-\x7e]*$/.test(msg.title.normalize("NFD").replace(/[̀-ͯ]/g, ""))).toBe(true);
    expect(msg.text).toContain("SE: média R$ 108,33");
    expect(msg.text).toContain("máx R$ 300,00 às 19h ⚠");
    expect(msg.text).not.toContain("NE: média R$ 65,00 · mín R$ 60,00 · máx R$ 180,00 às 19h ⚠");
    expect(alertRequest("https://ntfy.sh/t", msg, undefined).headers.Tags).toBe("zap");
  });
});

describe("título do ntfy com acento", () => {
  it("vai em RFC 2047 (UTF-8/base64) para não corromper o cabeçalho", () => {
    const r = alertRequest("https://ntfy.sh/t", { kind: "pld", title: "PLD de amanhã", text: "x" }, undefined);
    expect(r.headers.Title).toBe(`=?UTF-8?B?${Buffer.from("PLD de amanhã").toString("base64")}?=`);
  });
});
