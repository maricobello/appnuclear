import { hampelOutliers, mean, pearson } from "../quant/stats";
import { clampPld } from "../market/brazil";
import type { FxData } from "../sources/fx";
import { SUBS, type SourceMeta, type SourceResult, type SubPanel } from "../sources/types";
import type { Check, CheckStatus, CrossCheck, SourceAudit } from "./types";

/**
 * Checagens determinísticas por fonte. Pesos somam 100:
 * disponibilidade 30 · frescor 20 · schema 15 · completude 15 · validade 10 · latência 5 · outliers 5
 */
const W = { availability: 30, freshness: 20, schema: 15, completeness: 15, validity: 10, latency: 5, outliers: 5 } as const;

const mk = (id: Check["id"], label: string, status: CheckStatus, score: number, detail: string): Check => ({
  id,
  label,
  status,
  score,
  detail,
  weight: W[id],
});

export function auditSource(meta: SourceMeta, r: SourceResult<unknown>, now = Date.now()): SourceAudit {
  const probes = r.probes;
  const last = probes[probes.length - 1];
  const base = {
    id: meta.id,
    name: meta.name,
    provider: meta.provider,
    region: meta.region,
    latencyMs: last ? Math.max(...probes.map((p) => p.latencyMs)) : null,
    httpStatus: last?.status ?? null,
    attempts: probes.length,
    latestTs: r.quality.latestTs,
    ageHours: r.quality.latestTs ? (now - r.quality.latestTs) / 3600_000 : null,
    points: r.quality.points,
  };

  if (meta.requiresKey && !process.env[meta.requiresKey]) {
    return { ...base, status: "disabled", score: 0, checks: [], error: `defina ${meta.requiresKey} para habilitar` };
  }

  const checks: Check[] = [];
  const failedProbes = probes.filter((p) => !p.ok).length;
  if (!r.ok) {
    checks.push(mk("availability", "Disponibilidade", "fail", 0, r.error ?? "falhou"));
    return { ...base, status: "down", score: 0, checks, error: r.error };
  }
  checks.push(
    failedProbes > 0
      ? mk("availability", "Disponibilidade", "warn", 0.8, `respondeu após ${failedProbes} tentativa(s) com falha`)
      : mk("availability", "Disponibilidade", "pass", 1, `HTTP ${last?.status ?? "—"} em ${probes.length} chamada(s)`),
  );

  // latência (downloads grandes toleram mais)
  const bytes = probes.reduce((s, p) => s + p.bytes, 0);
  const lat = base.latencyMs ?? 0;
  const k = bytes > 1_000_000 ? 3 : 1;
  checks.push(
    lat < 2000 * k
      ? mk("latency", "Latência", "pass", 1, `${lat} ms (${(bytes / 1024).toFixed(0)} KB)`)
      : lat < 8000 * k
        ? mk("latency", "Latência", "warn", 0.5, `${lat} ms — lenta`)
        : mk("latency", "Latência", "fail", 0.1, `${lat} ms — muito lenta`),
  );

  // frescor
  const age = base.ageHours;
  if (age === null) checks.push(mk("freshness", "Frescor", "fail", 0, "sem timestamp de observação"));
  else if (age <= meta.freshnessSlaHours)
    checks.push(mk("freshness", "Frescor", "pass", 1, age < 0 ? `inclui dados futuros (+${(-age).toFixed(1)} h — programação)` : `${age.toFixed(1)} h (SLA ${meta.freshnessSlaHours} h)`));
  else if (age <= 2 * meta.freshnessSlaHours)
    checks.push(mk("freshness", "Frescor", "warn", 0.5, `${age.toFixed(1)} h — acima do SLA de ${meta.freshnessSlaHours} h`));
  else checks.push(mk("freshness", "Frescor", "fail", 0, `${age.toFixed(1)} h — dado defasado (SLA ${meta.freshnessSlaHours} h)`));

  // schema
  const si = r.quality.schemaIssues;
  checks.push(si.length === 0 ? mk("schema", "Schema", "pass", 1, "campos esperados presentes") : mk("schema", "Schema", "warn", 0.4, si.slice(0, 3).join("; ")));

  // completude
  const { points, expectedPoints, duplicates, invalid } = r.quality;
  const ratio = expectedPoints ? points / expectedPoints : null;
  const invalidPct = points + invalid > 0 ? invalid / (points + invalid) : 0;
  const parts = [
    ratio !== null ? `${(100 * ratio).toFixed(1)}% da janela` : `${points} pontos`,
    duplicates ? `${duplicates} duplicados` : null,
    invalid ? `${invalid} registros inválidos` : null,
  ].filter(Boolean).join(" · ");
  if ((ratio === null || ratio >= 0.98) && duplicates === 0 && invalidPct < 0.01) checks.push(mk("completeness", "Completude", "pass", 1, parts));
  else if ((ratio === null || ratio >= 0.9) && invalidPct < 0.05) checks.push(mk("completeness", "Completude", "warn", 0.6, parts));
  else checks.push(mk("completeness", "Completude", "fail", 0.2, parts));

  // validade (faixa plausível / regulatória)
  const vals = r.quality.values ?? [];
  const range = r.quality.range;
  if (!range || !vals.length) checks.push(mk("validity", "Validade", "skip", 1, "sem faixa definida"));
  else {
    const out = vals.filter((v) => v < range[0] || v > range[1]).length;
    const pct = out / vals.length;
    checks.push(
      out === 0
        ? mk("validity", "Validade", "pass", 1, `100% em [${range[0]}, ${range[1]}]`)
        : pct <= 0.01
          ? mk("validity", "Validade", "warn", 0.5, `${out} valor(es) fora de [${range[0]}, ${range[1]}]`)
          : mk("validity", "Validade", "fail", 0, `${(100 * pct).toFixed(1)}% fora de [${range[0]}, ${range[1]}]`),
    );
  }

  // outliers (Hampel) — informativo: picos reais de preço existem
  if (vals.length >= 48) {
    const o = hampelOutliers(vals, 12, 5).length;
    const pct = o / vals.length;
    checks.push(pct <= 0.02 ? mk("outliers", "Outliers (Hampel)", "pass", 1, `${o} ponto(s) atípico(s)`) : mk("outliers", "Outliers (Hampel)", "warn", 0.5, `${o} pontos atípicos (${(100 * pct).toFixed(1)}%) — verificar picos`));
  } else checks.push(mk("outliers", "Outliers (Hampel)", "skip", 1, "amostra curta"));

  const score = Math.round((100 * checks.reduce((s, c) => s + c.weight * c.score, 0)) / checks.reduce((s, c) => s + c.weight, 0));
  const anyFail = checks.some((c) => c.status === "fail");
  return { ...base, status: score >= 85 && !anyFail ? "ok" : "degraded", score, checks };
}

/** Integridade cruzada: PLD (CCEE) deve ser o CMO do DESSEM (ONS) limitado ao piso/teto. */
export function crossPldCmo(pld: SubPanel | null, cmo: SubPanel | null): CrossCheck {
  if (!pld || !cmo) {
    return { id: "pld_vs_cmo", label: "PLD (CCEE) × CMO limitado (ONS)", status: "skip", detail: "uma das fontes indisponível", metrics: {} };
  }
  const cmoMap = new Map(cmo.ts.map((t, i) => [t, i]));
  const diffs: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const cut = Date.now() - 7 * 86400_000;
  pld.ts.forEach((t, i) => {
    const j = cmoMap.get(t);
    if (j === undefined || t < cut) return;
    for (const s of SUBS) {
      const p = pld.values[s][i];
      const c = cmo.values[s][j];
      if (p === null || c === null) continue;
      const cc = clampPld(c);
      diffs.push(Math.abs(p - cc));
      a.push(p);
      b.push(cc);
    }
  });
  if (diffs.length < 24) return { id: "pld_vs_cmo", label: "PLD (CCEE) × CMO limitado (ONS)", status: "skip", detail: "sobreposição insuficiente", metrics: { n: diffs.length } };
  const maeV = mean(diffs);
  const within = diffs.filter((d) => d <= 1).length / diffs.length;
  const corr = pearson(a, b);
  const status: CheckStatus = maeV < 5 && within > 0.9 ? "pass" : maeV < 25 ? "warn" : "fail";
  return {
    id: "pld_vs_cmo",
    label: "PLD (CCEE) × CMO limitado (ONS)",
    status,
    detail: `MAE R$ ${maeV.toFixed(2)}/MWh · ${(100 * within).toFixed(1)}% das horas com |Δ| ≤ R$1 · ρ=${corr.toFixed(3)} (n=${diffs.length})`,
    metrics: { mae: maeV, within1: within, corr, n: diffs.length },
  };
}

export function crossFx(fx: FxData | null): CrossCheck {
  if (!fx) return { id: "fx_triangle", label: "Triangulação cambial EUR/USD", status: "skip", detail: "BCB indisponível", metrics: {} };
  const eurusd = fx.EUR.rate / fx.USD.rate;
  const gbpusd = fx.GBP.rate / fx.USD.rate;
  const ok = eurusd > 0.85 && eurusd < 1.45 && gbpusd > 1 && gbpusd < 1.7;
  return {
    id: "fx_triangle",
    label: "Triangulação cambial EUR/USD",
    status: ok ? "pass" : "fail",
    detail: `EUR/USD implícito ${eurusd.toFixed(4)} · GBP/USD ${gbpusd.toFixed(4)}`,
    metrics: { eurusd, gbpusd },
  };
}
