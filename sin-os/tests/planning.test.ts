import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { auditModels, PLAN_CHECKS } from "@/lib/audit/models";
import { headline12, headlineBand, headlinePld, HISTORY_RUNS, mergePlanHistory, planAgeDays, PlanReportSchema, sddpPld, summarizePlan, type PlanReport } from "@/lib/planning/report";

const fixture = () => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/planejamento.json"), "utf8"));
const SUBS = ["SE", "S", "NE", "N"] as const;

/** Retroanálise sintética para exercitar os critérios (o relatório real traz a de planning/validacao.json). */
function withValidation(r: PlanReport, mae: number, pers: number, cov: number): PlanReport {
  const metricas = Object.fromEntries(
    SUBS.map((s) => [s, { meses: 21, pld_mae_modelo: mae, pld_mae_persistencia: pers, pld_mae_decomp: 40, pld_vies_modelo: -5, pld_cobertura_p10_p90: cov, ear_mae_pp: 3.2, ear_vies_pp: 0.4, ear_cobertura_p10_p90: 0.81 }]),
  );
  return { ...r, validacao: { metricas, meses: [] } };
}

describe("relatório do planejamento (worker do NovoModelo)", () => {
  it("o relatório real passa no esquema; campo desconhecido é descartado", () => {
    const raw = fixture();
    raw.extra = "x";
    const r = PlanReportSchema.parse(raw);
    expect((r as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(r.resultado.meses.length).toBeGreaterThanOrEqual(12);
    expect(r.caso.estagios).toBe(60);
    // PLD dentro dos limites da ANEEL em todos os meses, subsistemas e quantis
    const lim = r.params.pld_limites["2026"];
    for (const m of r.resultado.meses)
      for (const s of SUBS) {
        const q = m.pld[s];
        expect(q.p10!).toBeGreaterThanOrEqual(lim.min - 1e-6);
        expect(q.p90!).toBeLessThanOrEqual(lim.max_h + 1e-6);
        expect(q.p10!).toBeLessThanOrEqual(q.p50!);
        expect(q.p50!).toBeLessThanOrEqual(q.p90!);
      }
    // retroanálise: o publicado de cada mês, refeito sem ele, dentro da própria faixa
    for (const v of r.validacao!.meses)
      for (const s of SUBS) {
        const q = v.sub[s].publicado!;
        expect(q.p10!).toBeLessThanOrEqual(q.p50!);
        expect(q.p50!).toBeLessThanOrEqual(q.p90!);
      }
    // armazenamento simulado nunca passa do teto operativo do mês
    for (const e of r.resultado.estagios) {
      const cal = String(new Date(Date.parse(e.fim) - 86400_000).getUTCMonth() + 1);
      for (const s of SUBS) expect(e.ear_fim_pct[s].p90!).toBeLessThanOrEqual(r.caso.envelope[s][cal].max + 0.05);
    }
  });

  it("faixa publicada: a da combinação; sem ela, a do SDDP calibrada pela retroanálise; senão a dos cenários", () => {
    const r = PlanReportSchema.parse(fixture());
    const m = r.resultado.meses[1];
    expect(headlineBand(m, "SE")).toEqual({ p10: m.pld_previsto!.SE.p10, p90: m.pld_previsto!.SE.p90, calibrada: true });
    const sddp = { ...m, pld_previsto: undefined };
    expect(headlineBand(sddp, "SE")).toEqual(m.pld_faixa!.SE);
    const plain = { ...sddp, pld_faixa: undefined };
    expect(headlineBand(plain, "SE")).toEqual({ p10: sddpPld(m).SE.p10, p90: sddpPld(m).SE.p90, calibrada: false });
  });

  it("o publicado é a combinação quando o relatório traz: P50, faixa, 12 meses e o resumo do histórico", () => {
    const raw = fixture();
    const q = (p50: number) => ({ p10: p50 - 10, p50, p90: p50 + 30 });
    raw.resultado.meses = raw.resultado.meses.map((m: Record<string, unknown>) => ({ ...m, pld_previsto: { SE: q(150), S: q(149), NE: q(120), N: q(130) }, peso_sddp: 0.3 }));
    raw.combinacao = {
      pesos: [{ h: 0, peso: 0.3, n: 84 }, { h: 1, peso: 0.2, n: 84 }],
      residuo: { SE: [{ h: 0, p10: -50, p90: 45, n: 21 }] },
      ancora: { SE: 140, S: 139, NE: 110, N: 120 },
      pld_12m: { SE: q(155), S: q(154), NE: q(125), N: q(135) },
      fonte: "teste",
    };
    const r = PlanReportSchema.parse(raw);
    const m = r.resultado.meses[1];
    expect(headlinePld(m).SE).toEqual({ mean: null, p10: 140, p50: 150, p90: 180 });
    expect(headlineBand(m, "NE")).toEqual({ p10: 110, p90: 150, calibrada: true });
    expect(sddpPld(m).SE.p50).toBe(r.resultado.meses[1].pld_ponta!.SE.p50);
    expect(headline12(r)?.SE).toEqual({ mean: 155, p10: 145, p50: 155, p90: 185 });
    expect(summarizePlan(r).m1.SE).toBe(150);
    expect(() => PlanReportSchema.parse({ ...raw, combinacao: { ...raw.combinacao, pesos: [{ h: 0, peso: 1.5, n: 1 }] } })).toThrow();
  });

  it("reprova relatório fora de faixa ou com fonte fora do bucket do ONS", () => {
    const a = fixture();
    a.params.cvar_alpha = 1.5;
    expect(PlanReportSchema.safeParse(a).success).toBe(false);
    const b = fixture();
    b.fontes[0].url = "javascript:alert(1)";
    expect(PlanReportSchema.safeParse(b).success).toBe(false);
    const c = fixture();
    c.resultado.estagios[0].risco_deficit.SE = 2;
    expect(PlanReportSchema.safeParse(c).success).toBe(false);
  });

  it("resumo e histórico: um por data de referência, mais recente por último, até 90 rodadas", () => {
    const r = PlanReportSchema.parse(fixture());
    const s = summarizePlan(r);
    expect(s.mes > r.start.slice(0, 7)).toBe(true);
    // a manchete é o publicado (a combinação, que já leva a ponta)
    const m = r.resultado.meses.find((x) => x.mes === s.mes)!;
    expect(m.pld_ponta).toBeDefined();
    expect(s.m1.SE).toBe(headlinePld(m).SE.p50);
    expect(s.m1.SE).toBeGreaterThan(m.pld.SE.p50!);
    const h = mergePlanHistory([{ ...s, asof: "2026-10-01" }, { ...s, asof: "2026-10-14", mes: "x" }], s);
    expect(h.map((x) => x.asof)).toEqual(["2026-10-01", "2026-10-14", r.asof]);
    expect(mergePlanHistory(h, { ...s, mes: "novo" }).find((x) => x.asof === r.asof)!.mes).toBe("novo");
    const many = Array.from({ length: HISTORY_RUNS + 5 }, (_, i) => ({ ...s, asof: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}` }));
    expect(many.reduce((acc, x) => mergePlanHistory(acc, x), [] as typeof many)).toHaveLength(HISTORY_RUNS);
    expect(planAgeDays({ generatedAt: "2026-10-17T00:00:00Z" }, Date.parse("2026-10-18T12:00:00Z"))).toBeCloseTo(1.5);
  });

  it("auditoria dos modelos: frescor, convergência, balanço hídrico e retroanálise", () => {
    const r = PlanReportSchema.parse(fixture());
    const base = { now: Date.parse("2026-10-17T15:00:00Z"), forecasts: {}, regimes: {}, bess: null, arbitrage: null, selfEval: null, pld: null, limits: { min: 57.31, maxHourly: 1611 }, pldSource: "teste" };
    const by = (a: ReturnType<typeof auditModels>, id: string) => a.checks.find((c) => c.id === id)!;
    const a = auditModels({ ...base, plan: { report: withValidation(r, 8, 20, 0.8), ageDays: 1 } });
    expect(by(a, "planejamento.frescor").status).toBe("pass");
    expect(by(a, "planejamento.convergencia").status).toBe("pass");
    expect(by(a, "planejamento.balanco_hidrico").status).toBe("pass");
    expect(by(a, "planejamento.pld.SE").status).toBe("pass");
    expect(by(a, "planejamento.faixa.N").status).toBe("pass");
    // modelo pior que a persistência e faixa estreita demais
    const b = auditModels({ ...base, plan: { report: withValidation(r, 30, 20, 0.3), ageDays: PLAN_CHECKS.ageDays.warn + 1 } });
    expect(by(b, "planejamento.frescor").status).toBe("fail");
    expect(by(b, "planejamento.pld.SE").status).toBe("fail");
    expect(by(b, "planejamento.faixa.SE").status).toBe("fail");
    // λ implícito: dentro da tolerância passa; no extremo do intervalo é atenção
    const cal = {
      lambda: 0.71, cmo: 214, alvo: 210, tolerancia: 16.8, limite: null, tentativas: [{ lambda: 0.4, cmo: 28 }, { lambda: 0.71, cmo: 214 }], lambda_padrao: 0.4, sub: "SE" as const,
      alvo_por_sub: { SE: 210, S: 211, NE: 190, N: 205 }, alvo_fonte: "CMO médio do DESSEM nos 14 dias antes do início do estudo (ONS)", puro: [], puro_pld_12m: { SE: 70, S: 70, NE: 66, N: 66 },
    };
    expect(PlanReportSchema.parse({ ...fixture(), calibracao_risco: cal }).calibracao_risco?.lambda).toBe(0.71);
    expect(by(auditModels({ ...base, plan: { report: { ...r, calibracao_risco: cal }, ageDays: 1 } }), "planejamento.calibracao_risco").status).toBe("pass");
    const capped = { ...cal, lambda: 1, cmo: 150, limite: "teto" as const };
    const k = by(auditModels({ ...base, plan: { report: { ...r, calibracao_risco: capped }, ageDays: 1 } }), "planejamento.calibracao_risco");
    expect(k.status).toBe("warn");
    expect(k.detail).toContain("abaixo");
    expect(() => PlanReportSchema.parse({ ...fixture(), calibracao_risco: { ...cal, lambda: 1.4 } })).toThrow();
    // sem retroanálise: atenção com o caminho
    const c = auditModels({ ...base, plan: { report: { ...r, validacao: null }, ageDays: 1 } });
    expect(by(c, "planejamento.retroanalise").status).toBe("warn");
    // sem relatório: só o aviso do worker
    const none = auditModels({ ...base, plan: { report: null, ageDays: null } }).checks.filter((x) => x.model === "Planejamento (SDDP)");
    expect(none.map((x) => [x.id, x.status])).toEqual([["planejamento.frescor", "warn"]]);
    expect(none[0].detail).toContain("planejamento.yml");
    expect(auditModels(base).checks.some((x) => x.model === "Planejamento (SDDP)")).toBe(false);
  });
});

describe("POST /api/planejamento/ingest", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ADMIN_KEY;
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const post = async (body: Buffer | string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/planejamento/ingest/route");
    return POST(new Request("http://x/api/planejamento/ingest", { method: "POST", body: typeof body === "string" ? body : new Uint8Array(body), headers }));
  };

  it("desligada sem segredo, recusa token errado, aceita gzip válido e guarda o histórico", async () => {
    expect((await post("{}")).status).toBe(503);
    process.env.ADMIN_KEY = "chave-de-teste";
    expect((await post("{}", { authorization: "Bearer outra" })).status).toBe(401);
    const ok = await post(gzipSync(JSON.stringify(fixture())), { authorization: "Bearer chave-de-teste", "content-encoding": "gzip" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ referencia: fixture().asof, iteracoes: 60, armazenamento: "memory" });
    const { loadPlanReport } = await import("@/lib/planning/store");
    const p = await loadPlanReport();
    expect(p.report?.asof).toBe(fixture().asof);
    expect(p.history).toHaveLength(1);
    expect((await post(JSON.stringify(fixture()), { authorization: "Bearer chave-de-teste" })).status).toBe(429);
  });

  it("corpo fora do esquema volta 422 com o caminho do problema", async () => {
    process.env.ADMIN_KEY = "chave-de-teste";
    const x = fixture();
    x.solver.iterations = "60";
    const r = await post(JSON.stringify(x), { authorization: "Bearer chave-de-teste" });
    expect(r.status).toBe(422);
    expect((await r.json()).issues[0]).toContain("solver.iterations");
  });
});
