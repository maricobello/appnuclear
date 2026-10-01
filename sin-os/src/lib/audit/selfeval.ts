import { auditSource } from "./checks";
import type { SourceStatus } from "./types";
import { emptyQuality, type Quality, type SourceMeta, type SourceResult } from "../sources/types";

/**
 * Auto-avaliação da camada determinística do auditor: injeta falhas conhecidas em
 * `SourceResult` sintéticos e verifica se `auditSource` classifica o status esperado
 * (ok / degraded / down). Mede precisão e recall por classe — é o que torna a auditoria
 * "self-evaluating" (roda no `npm test`, sem custo e sem API).
 */
export interface Scenario {
  name: string;
  expected: SourceStatus;
  build: (now: number) => { meta: SourceMeta; result: SourceResult<unknown> };
}

const META: SourceMeta = {
  id: "ons_cmo",
  name: "CMO teste",
  provider: "teste",
  region: "BR",
  category: "preço",
  endpoint: "https://example.test",
  docs: "https://example.test",
  license: "teste",
  cadence: "diária",
  freshnessSlaHours: 24,
  description: "fonte sintética para self-eval",
};

const H = 3600_000;

/** SourceResult saudável base; os cenários deformam campos específicos. */
function healthy(now: number): SourceResult<unknown> {
  const q: Quality = {
    latestTs: now - 1 * H,
    points: 1000,
    expectedPoints: 1000,
    duplicates: 0,
    invalid: 0,
    schemaIssues: [],
    values: Array.from({ length: 96 }, (_, i) => 100 + 20 * Math.sin(i / 4)),
    range: [-100, 3000],
  };
  return {
    id: "ons_cmo",
    ok: true,
    data: {},
    probes: [{ url: "x", ok: true, status: 200, latencyMs: 400, bytes: 50_000, at: now }],
    quality: q,
    simulated: false,
    fetchedAt: now,
  };
}

export const SCENARIOS: Scenario[] = [
  { name: "saudável", expected: "ok", build: (now) => ({ meta: META, result: healthy(now) }) },
  {
    name: "429 recuperado (1 falha depois OK)",
    expected: "ok",
    build: (now) => {
      const r = healthy(now);
      r.probes = [
        { url: "x", ok: false, status: 429, latencyMs: 300, bytes: 0, at: now, error: "HTTP 429" },
        { url: "x", ok: true, status: 200, latencyMs: 500, bytes: 50_000, at: now },
      ];
      return { meta: META, result: r };
    },
  },
  {
    name: "403 bloqueado (WAF)",
    expected: "down",
    build: (now) => {
      const r = healthy(now);
      r.ok = false;
      r.data = null;
      r.error = "HTTP 403: Acesso bloqueado";
      r.probes = [{ url: "x", ok: false, status: 403, latencyMs: 80, bytes: 100, at: now, error: "HTTP 403" }];
      r.quality = emptyQuality();
      return { meta: META, result: r };
    },
  },
  {
    name: "falha de rede",
    expected: "down",
    build: (now) => {
      const r = healthy(now);
      r.ok = false;
      r.data = null;
      r.error = "TypeError: fetch failed (ECONNREFUSED)";
      r.probes = [{ url: "x", ok: false, status: null, latencyMs: 20000, bytes: 0, at: now, error: "ECONNREFUSED" }];
      r.quality = emptyQuality();
      return { meta: META, result: r };
    },
  },
  {
    name: "dado defasado (> 2×SLA)",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.quality.latestTs = now - 5 * 24 * H; // 120 h, SLA 24 h
      return { meta: META, result: r };
    },
  },
  {
    name: "sem timestamp",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.quality.latestTs = null;
      return { meta: META, result: r };
    },
  },
  {
    name: "janela incompleta (<90%)",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.quality.points = 800; // 80% de 1000
      return { meta: META, result: r };
    },
  },
  {
    name: "muitos registros inválidos (>5%)",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.quality.invalid = 100; // 100/1100 ≈ 9%
      return { meta: META, result: r };
    },
  },
  {
    name: "valores fora da faixa regulatória (>1%)",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.quality.values = [...(r.quality.values ?? [])];
      for (let i = 0; i < 10; i++) r.quality.values[i] = 99999; // ~10% fora de [-100, 3000]
      return { meta: META, result: r };
    },
  },
  {
    name: "latência altíssima (> 8 s)",
    expected: "degraded",
    build: (now) => {
      const r = healthy(now);
      r.probes = [{ url: "x", ok: true, status: 200, latencyMs: 30000, bytes: 50_000, at: now }];
      return { meta: META, result: r };
    },
  },
];

export interface SelfEvalResult {
  total: number;
  correct: number;
  accuracy: number;
  /** precisão e recall macro (média das classes presentes). */
  precisionMacro: number;
  recallMacro: number;
  perScenario: { name: string; expected: SourceStatus; got: SourceStatus; ok: boolean }[];
  confusion: Record<string, Record<string, number>>;
}

export function runSelfEval(now = Date.now()): SelfEvalResult {
  const classes: SourceStatus[] = ["ok", "degraded", "down"];
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of classes) confusion[a] = Object.fromEntries(classes.map((b) => [b, 0])) as Record<string, number>;
  const perScenario = SCENARIOS.map((s) => {
    const { meta, result } = s.build(now);
    const got = auditSource(meta, result, now).status;
    confusion[s.expected][got] = (confusion[s.expected][got] ?? 0) + 1;
    return { name: s.name, expected: s.expected, got, ok: got === s.expected };
  });
  const correct = perScenario.filter((p) => p.ok).length;
  const precisions: number[] = [];
  const recalls: number[] = [];
  for (const c of classes) {
    const tp = confusion[c][c] ?? 0;
    const predicted = classes.reduce((s, a) => s + (confusion[a][c] ?? 0), 0);
    const actual = classes.reduce((s, b) => s + (confusion[c][b] ?? 0), 0);
    if (predicted > 0) precisions.push(tp / predicted);
    if (actual > 0) recalls.push(tp / actual);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 1);
  return {
    total: perScenario.length,
    correct,
    accuracy: correct / perScenario.length,
    precisionMacro: avg(precisions),
    recallMacro: avg(recalls),
    perScenario,
    confusion,
  };
}
