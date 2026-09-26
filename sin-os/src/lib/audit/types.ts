import type { Region, SourceId } from "../sources/types";

export type CheckId = "availability" | "latency" | "freshness" | "schema" | "completeness" | "validity" | "outliers";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type SourceStatus = "ok" | "degraded" | "down" | "disabled";

export interface Check {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail: string;
  weight: number;
  score: number; // 0..1
}

export interface SourceAudit {
  id: SourceId;
  name: string;
  provider: string;
  region: Region;
  status: SourceStatus;
  score: number; // 0..100
  checks: Check[];
  latencyMs: number | null;
  httpStatus: number | null;
  attempts: number;
  latestTs: number | null;
  ageHours: number | null;
  points: number;
  error?: string;
}

export interface CrossCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  metrics: Record<string, number | null>;
}

export interface AuditRun {
  id: string;
  trigger: "cron" | "manual" | "github" | "api";
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  overallScore: number;
  counts: Record<SourceStatus, number>;
  sources: SourceAudit[];
  cross: CrossCheck[];
  storage: "firestore" | "memory";
  agentTriggered: boolean;
}

export interface AgentFinding {
  sourceId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  evidence: string;
  hypothesis: string;
  action: string;
}

export interface AgentReport {
  id: string;
  runId: string;
  createdAt: number;
  model: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  findings: AgentFinding[];
  markdown: string;
  toolCalls: { name: string; input: unknown; ms: number }[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  stopReason: string | null;
}
