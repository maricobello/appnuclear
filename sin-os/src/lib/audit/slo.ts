import { quantile } from "../quant/stats";
import type { SourceId } from "../sources/types";
import { healthOf } from "./health";
import type { AuditRun } from "./types";

/**
 * SLO das fontes a partir do histórico de execuções do auditor (Firestore). Cada run é
 * uma amostra: disponibilidade = fração dos runs em que a fonte NÃO estava "down";
 * conformidade = fração em "ok"; latência p50/p95 das sondas. A saúde geral usa a mesma
 * regra do /api/health (`healthOf`), então o número bate com o alerta.
 *
 * É uma amostragem — com o cron best-effort do GitHub os runs não são equiespaçados —,
 * por isso a janela e o nº de amostras são expostos junto com a porcentagem.
 */
export interface SourceSlo {
  id: SourceId;
  name: string;
  samples: number;
  /** % dos runs com a fonte fora de "down". */
  availabilityPct: number;
  /** % dos runs com a fonte "ok". */
  okPct: number;
  latencyP50: number | null;
  latencyP95: number | null;
  /** Falha esperada e coberta por fallback (ex.: CCEE bloqueia IPs de nuvem). */
  expectedDown: boolean;
}

export interface Slo {
  samples: number;
  fromTs: number | null;
  toTs: number | null;
  /** % dos runs saudáveis pela regra do /api/health. */
  healthyPct: number;
  meanScore: number | null;
  sources: SourceSlo[];
}

const EXPECTED_DOWN = new Set<string>(["ccee_pld"]);
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);

export function computeSlo(runs: AuditRun[]): Slo {
  const byId = new Map<SourceId, { name: string; n: number; up: number; ok: number; lat: number[] }>();
  let healthy = 0;
  let scoreSum = 0;
  for (const run of runs) {
    if (healthOf(run).healthy) healthy++;
    scoreSum += run.overallScore;
    for (const s of run.sources) {
      if (s.status === "disabled") continue;
      const e = byId.get(s.id) ?? { name: s.name, n: 0, up: 0, ok: 0, lat: [] };
      e.n++;
      if (s.status !== "down") e.up++;
      if (s.status === "ok") e.ok++;
      if (s.latencyMs !== null && Number.isFinite(s.latencyMs)) e.lat.push(s.latencyMs);
      byId.set(s.id, e);
    }
  }
  const ts = runs.map((r) => r.startedAt);
  return {
    samples: runs.length,
    fromTs: ts.length ? Math.min(...ts) : null,
    toTs: ts.length ? Math.max(...ts) : null,
    healthyPct: pct(healthy, runs.length),
    meanScore: runs.length ? Math.round((10 * scoreSum) / runs.length) / 10 : null,
    sources: [...byId.entries()].map(([id, e]) => ({
      id,
      name: e.name,
      samples: e.n,
      availabilityPct: pct(e.up, e.n),
      okPct: pct(e.ok, e.n),
      latencyP50: e.lat.length ? Math.round(quantile(e.lat, 0.5)) : null,
      latencyP95: e.lat.length ? Math.round(quantile(e.lat, 0.95)) : null,
      expectedDown: EXPECTED_DOWN.has(id),
    })),
  };
}
