import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AGENT_TOOLS, runAuditAgent, type AgentDeps } from "../src/lib/audit/agent";
import type { AuditOutcome } from "../src/lib/audit/runner";
import type { ChatFn, ChatRequest } from "../src/lib/assistant/groq";
import type { AgentReport } from "../src/lib/audit/types";

const outcome = {
  run: {
    id: "run_1",
    trigger: "manual",
    startedAt: Date.UTC(2026, 9, 9, 12),
    finishedAt: Date.UTC(2026, 9, 9, 12),
    durationMs: 1,
    overallScore: 92,
    counts: { ok: 13, degraded: 0, down: 1, disabled: 2 },
    sources: [{ id: "ccee_pld", name: "PLD", provider: "CCEE", region: "BR", latencyMs: 70, httpStatus: 403, attempts: 1, latestTs: null, ageHours: null, points: 0, status: "down", score: 0, checks: [], error: "HTTP 403" }],
    cross: [{ id: "pld_vs_cmo", label: "PLD × CMO", status: "skip", detail: "uma fonte indisponível", metrics: {} }],
    storage: "memory",
    agentTriggered: true,
  },
  previous: null,
  results: { ccee_pld: { id: "ccee_pld", ok: false, data: null, error: "HTTP 403", probes: [], quality: { latestTs: null, points: 0, duplicates: 0, invalid: 0, schemaIssues: [] }, simulated: false, fetchedAt: 0 } },
  shouldInvokeAgent: true,
  reasons: ["execução manual"],
} as unknown as AuditOutcome;

const call = (id: string, name: string, args: unknown) => ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

describe("agente auditor na Groq", () => {
  it("usa as ferramentas, corrige argumento inválido e registra o relatório", async () => {
    const seen: ChatRequest[] = [];
    const script = [
      [call("1", "probe_source", { source_id: "nao_existe" })],
      [call("2", "get_cross_checks", {})],
      [call("3", "submit_report", { summary: "CCEE bloqueia o servidor (403); fallback CMO ativo.", severity: "warning", findings: [{ sourceId: "ccee_pld", severity: "warning", title: "Bloqueio 403", evidence: "HTTP 403", hypothesis: "WAF da CCEE", action: "manter fallback e abrir chamado" }] })],
    ];
    const chat: ChatFn = async (req) => {
      seen.push(JSON.parse(JSON.stringify(req)));
      const tool_calls = script[seen.length - 1];
      return { message: { role: "assistant", content: null, tool_calls }, model: "openai/gpt-oss-120b", usage: { prompt_tokens: 100, completion_tokens: 20 } };
    };
    let saved: AgentReport | null = null;
    const deps: AgentDeps = { chat, probe: vi.fn(), history: vi.fn(async () => []), save: async (r) => void (saved = r) };
    const rep = await runAuditAgent(outcome, deps);

    expect(seen).toHaveLength(3);
    expect(seen[0].tools?.map((t) => t.function.name)).toEqual(AGENT_TOOLS.map((t) => t.function.name));
    // argumento inválido volta como erro para o modelo, sem derrubar o agente
    expect(seen[1].messages.find((m) => m.role === "tool" && m.tool_call_id === "1")?.content).toMatch(/^erro:/);
    expect(deps.probe).not.toHaveBeenCalled();
    expect(rep.stopReason).toBe("submitted");
    expect(rep.severity).toBe("warning");
    expect(rep.findings[0].title).toBe("Bloqueio 403");
    expect(rep.usage).toEqual({ inputTokens: 300, outputTokens: 60, cacheReadTokens: 0 });
    expect(rep.model).toBe("openai/gpt-oss-120b");
    expect(saved).toBe(rep);
  });

  it("sem relatório estruturado, usa o texto final e a severidade da auditoria", async () => {
    const chat: ChatFn = async () => ({ message: { role: "assistant", content: "Tudo certo exceto a CCEE." }, model: "m", usage: null });
    const rep = await runAuditAgent(outcome, { chat, probe: vi.fn(), history: vi.fn(async () => []), save: async () => undefined });
    expect(rep.summary).toBe("Tudo certo exceto a CCEE.");
    expect(rep.severity).toBe("critical"); // há fonte "down"
    expect(rep.stopReason).toBe("end_turn");
  });
});
