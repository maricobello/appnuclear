import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SOURCES } from "../sources/registry";
import type { SourceId, SourceResult } from "../sources/types";
import { listAuditRuns, saveAgentReport } from "../store";
import { auditSource } from "./checks";
import { probeOne, type AuditOutcome } from "./runner";
import type { AgentFinding, AgentReport } from "./types";

/**
 * Agente auditor (Claude + tool use). Recebe o resultado determinístico da auditoria e
 * investiga: re-sonda endpoints para separar falha transitória de persistente, lê o
 * histórico no Firestore, inspeciona amostras normalizadas (drift de schema) e
 * integridade cruzada (PLD × CMO), e entrega um relatório estruturado com causa
 * provável e ação recomendada.
 */
export const AGENT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORT = (process.env.AGENT_EFFORT ?? "high") as Effort;

const SOURCE_IDS = Object.keys(SOURCES) as [SourceId, ...SourceId[]];

const SYSTEM = `Você é o agente auditor de dados do SIN OS, um terminal de arbitragem e previsão do setor elétrico.
Sua função: garantir que as APIs públicas que alimentam modelos de preço e decisões de arbitragem estão disponíveis, frescas, íntegras e coerentes entre si.

Contexto do domínio (use para não gerar falsos alarmes):
- PLD horário (CCEE) é o CMO do DESSEM (ONS) limitado ao piso/teto regulatórios de 2026: mínimo R$ 57,31, máximo horário R$ 1.611,04. PLD colado no piso por dias é comportamento normal no período úmido — não é anomalia de dados.
- A CCEE publica o PLD de D+1 à tarde; o ONS publica o CMO programado de D+1. Timestamps no futuro são esperados nessas fontes.
- EAR/ENA/carga do ONS são diários (D−1). O BCB não publica câmbio em fins de semana e feriados.
- Energy-Charts (Europa) opera em resolução de 15 min desde o MTU de 15 min do SDAC; preços negativos são legítimos (mín. harmonizado −500 €/MWh).
- Elexon (GB) e a Carbon Intensity API atualizam a cada 30 min.
- A EIA exige chave (opcional); status "disabled" sem chave é esperado.

Método:
1. Leia o resultado da auditoria determinística fornecido.
2. Para cada fonte "down" ou "degraded", use probe_source para verificar se a falha persiste (transitória vs. persistente) e get_source_history para ver tendência. Use inspect_sample quando suspeitar de drift de schema, unidade ou valores implausíveis.
3. Classifique a causa provável: indisponibilidade do provedor, bloqueio de IP/WAF (403), limite de taxa (429), atraso de publicação, drift de schema/URL (ex.: recurso anual novo no CKAN), erro de parsing nosso, ou comportamento legítimo de mercado.
4. Recomende ações concretas e verificáveis (ex.: "manter fallback CMO→PLD ativo", "ajustar SLA", "atualizar regex de coluna X", "abrir chamado no portal Y").
Seja econômico: não sonde fontes saudáveis sem motivo. Baseie cada afirmação em evidência observada nas ferramentas.

Finalize chamando submit_report exatamente uma vez, em português, com sumário executivo de até 3 frases.`;

const FindingSchema = z.object({
  sourceId: z.string().describe("id da fonte ou 'cross' para integridade cruzada"),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  evidence: z.string().describe("fatos observados (status HTTP, idade, contagens, métricas)"),
  hypothesis: z.string().describe("causa provável"),
  action: z.string().describe("ação recomendada e verificável"),
});

const ReportSchema = z.object({
  summary: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  findings: z.array(FindingSchema),
});

function preview(data: unknown): string {
  const json = JSON.stringify(
    data,
    (_k, v) => (Array.isArray(v) && v.length > 24 ? { note: `${v.length} itens; últimos 24`, tail: v.slice(-24) } : v),
  );
  return json.length > 6000 ? `${json.slice(0, 6000)}… [truncado]` : json;
}

function compact(r: SourceResult<unknown>) {
  const a = auditSource(SOURCES[r.id], r);
  return {
    id: r.id,
    status: a.status,
    score: a.score,
    error: r.error ?? null,
    httpStatus: a.httpStatus,
    attempts: a.attempts,
    latencyMs: a.latencyMs,
    ageHours: a.ageHours !== null ? Number(a.ageHours.toFixed(2)) : null,
    points: r.quality.points,
    schemaIssues: r.quality.schemaIssues,
    checks: a.checks.map((c) => `${c.id}:${c.status} — ${c.detail}`),
    probes: r.probes.slice(-4).map((p) => ({ url: p.url, status: p.status, ms: p.latencyMs, error: p.error })),
  };
}

export async function runAuditAgent(outcome: AuditOutcome): Promise<AgentReport> {
  const client = new Anthropic();
  let submitted: z.infer<typeof ReportSchema> | null = null;
  const toolCalls: AgentReport["toolCalls"] = [];
  const timed = async <T,>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      toolCalls.push({ name, input, ms: Date.now() - t0 });
    }
  };

  const tools = [
    betaZodTool({
      name: "probe_source",
      description: "Re-executa ao vivo (sem cache) a chamada à API de uma fonte e retorna status HTTP, latência, erros, frescor e checagens. Use para distinguir falha transitória de persistente.",
      inputSchema: z.object({ source_id: z.enum(SOURCE_IDS) }),
      run: ({ source_id }) => timed("probe_source", { source_id }, async () => JSON.stringify(compact(await probeOne(source_id)))),
    }),
    betaZodTool({
      name: "get_source_history",
      description: "Histórico de auditorias persistidas (Firestore) para uma fonte: status, score, latência, idade do dado e erro por execução, da mais recente para a mais antiga.",
      inputSchema: z.object({ source_id: z.enum(SOURCE_IDS), limit: z.number().int().min(1).max(50).default(12) }),
      run: ({ source_id, limit }) =>
        timed("get_source_history", { source_id, limit }, async () => {
          const runs = await listAuditRuns(limit);
          return JSON.stringify(
            runs.map((r) => {
              const s = r.sources.find((x) => x.id === source_id);
              return { at: new Date(r.startedAt).toISOString(), status: s?.status, score: s?.score, latencyMs: s?.latencyMs, ageHours: s?.ageHours, error: s?.error };
            }),
          );
        }),
    }),
    betaZodTool({
      name: "inspect_sample",
      description: "Mostra uma amostra dos dados normalizados da fonte nesta execução (arrays truncados aos últimos 24 itens), para detectar drift de schema, unidade ou valores implausíveis.",
      inputSchema: z.object({ source_id: z.enum(SOURCE_IDS) }),
      run: ({ source_id }) =>
        timed("inspect_sample", { source_id }, async () => {
          const r = outcome.results[source_id];
          return r?.data ? preview(r.data) : `sem dados: ${r?.error ?? "fonte não executada"}`;
        }),
    }),
    betaZodTool({
      name: "get_cross_checks",
      description: "Resultados das verificações de integridade entre fontes (PLD da CCEE vs CMO do ONS limitado; triangulação cambial do BCB).",
      inputSchema: z.object({}),
      run: () => timed("get_cross_checks", {}, async () => JSON.stringify(outcome.run.cross)),
    }),
    betaZodTool({
      name: "submit_report",
      description: "Registra o relatório final da auditoria. Chame exatamente uma vez, ao final.",
      inputSchema: ReportSchema,
      run: (report) =>
        timed("submit_report", { findings: report.findings.length }, async () => {
          submitted = report;
          return "relatório registrado";
        }),
    }),
  ];

  const snapshot = {
    runId: outcome.run.id,
    at: new Date(outcome.run.startedAt).toISOString(),
    trigger: outcome.run.trigger,
    reasons: outcome.reasons,
    overallScore: outcome.run.overallScore,
    previousOverallScore: outcome.previous?.overallScore ?? null,
    counts: outcome.run.counts,
    sources: outcome.run.sources.map((s) => ({
      id: s.id,
      status: s.status,
      previousStatus: outcome.previous?.sources.find((p) => p.id === s.id)?.status ?? null,
      score: s.score,
      latencyMs: s.latencyMs,
      ageHours: s.ageHours !== null ? Number(s.ageHours.toFixed(2)) : null,
      error: s.error,
      checks: s.checks.filter((c) => c.status !== "pass").map((c) => `${c.id}:${c.status} — ${c.detail}`),
    })),
    cross: outcome.run.cross.map((c) => `${c.id}:${c.status} — ${c.detail}`),
  };

  const runner = client.beta.messages.toolRunner({
    model: AGENT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    tools,
    max_iterations: 12,
    messages: [
      {
        role: "user",
        content: `Resultado da auditoria determinística (JSON):\n${JSON.stringify(snapshot)}\n\nInvestigue o que for necessário e registre o relatório.`,
      },
    ],
  });

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let stopReason: string | null = null;
  let finalText = "";
  let servedModel = AGENT_MODEL;
  for await (const message of runner) {
    usage.inputTokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += message.usage.output_tokens;
    usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    stopReason = message.stop_reason;
    servedModel = message.model;
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    if (text) finalText = text;
    if (message.stop_reason === "refusal") break;
  }

  const rep = submitted as z.infer<typeof ReportSchema> | null;
  const findings: AgentFinding[] = rep?.findings ?? [];
  const severity = rep?.severity ?? (outcome.run.counts.down > 0 ? "critical" : outcome.run.counts.degraded > 0 ? "warning" : "info");
  const summary = rep?.summary ?? (finalText || "O agente não registrou relatório estruturado.");
  const markdown = [
    `### Auditoria ${new Date(outcome.run.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — score ${outcome.run.overallScore}/100`,
    "",
    summary,
    "",
    ...findings.map((f) => `- **[${f.severity.toUpperCase()}] ${f.sourceId} — ${f.title}**\n  - Evidência: ${f.evidence}\n  - Hipótese: ${f.hypothesis}\n  - Ação: ${f.action}`),
  ].join("\n");

  const report: AgentReport = {
    id: `rep_${Date.now()}`,
    runId: outcome.run.id,
    createdAt: Date.now(),
    model: servedModel,
    severity,
    summary,
    findings,
    markdown,
    toolCalls,
    usage,
    stopReason,
  };
  await saveAgentReport(report);
  return report;
}
