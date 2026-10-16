import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { auditModels, GRID_CHECKS } from "@/lib/audit/models";
import { GridSnapshotSchema, HISTORY_DAYS, mergeHistory, snapshotAgeDays, summarize } from "@/lib/grid/snapshot";
import { DECOUPLE_BRL, identityChecks, interchangeRowFrom, interchangeView, type InterchangeRow } from "@/lib/market/interchange";
import type { BalanceRow } from "@/lib/market/renewables";
import { brtToUtc } from "@/lib/sources/time";
import type { SubPanel } from "@/lib/sources/types";

const fixture = () => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/rede-snapshot.json"), "utf8"));
const H = (h: number) => brtToUtc(2026, 10, 14, h);

describe("intercâmbio entre subsistemas (ONS)", () => {
  it("dá o sinal pelo sentido do arquivo, no sentido de referência do par", () => {
    // linha real do arquivo de 2026: 14/10 23h, SE → N, medido 36 MW e programado 1.972 MW
    const r = interchangeRowFrom({ din_instante: new Date(Date.UTC(2026, 9, 14, 23)), id_subsistema_origem: "SE", id_subsistema_destino: "N", val_intercambiomwmed: "36.027", val_intercambioprogmwmed: "1972.250" });
    expect(r).toEqual({ ts: H(23), pair: "N-SE", real: -36.027, prog: -1972.25 });
    const f = interchangeRowFrom({ din_instante: "2026-10-14 21:00:00", id_subsistema_origem: "NE ", id_subsistema_destino: "SE", val_intercambiomwmed: 5743.449, val_intercambioprogmwmed: 5452.35 });
    expect(f).toEqual({ ts: H(21), pair: "NE-SE", real: 5743.449, prog: 5452.35 });
    // programado no sentido contrário vem negativo no arquivo e continua coerente
    expect(interchangeRowFrom({ din_instante: "2026-10-14 22:00:00", id_subsistema_origem: "N", id_subsistema_destino: "SE", val_intercambiomwmed: "1233.045", val_intercambioprogmwmed: "-473.700" })?.prog).toBe(-473.7);
    // sem interligação direta (Norte–Sul) ou subsistema desconhecido: inválida
    expect(interchangeRowFrom({ din_instante: "2026-10-14 21:00:00", id_subsistema_origem: "N", id_subsistema_destino: "S", val_intercambiomwmed: 1 })).toBeNull();
    expect(interchangeRowFrom({ din_instante: "2026-10-14 21:00:00", id_subsistema_origem: "SIN", id_subsistema_destino: "SE", val_intercambiomwmed: 1 })).toBeNull();
  });

  it("marca descolamento quando o PLD dos dois lados difere e confere o sentido do fluxo", () => {
    const rows: InterchangeRow[] = [0, 1, 2, 3].map((h) => ({ ts: H(h), pair: "NE-SE", real: [3000, 4000, 5000, -200][h], prog: 3100 }));
    const pld: SubPanel = {
      ts: [0, 1, 2, 3].map(H),
      unit: "R$/MWh",
      values: { NE: [100, 100, 57.31, 300], SE: [100, 100.5, 250, 120], S: [100, 100, 100, 100], N: [100, 100, 100, 100] },
    };
    const v = interchangeView(rows, pld);
    expect(v.spread["NE-SE"]).toEqual([0, 0.5, 192.69, -180]);
    const s = v.pairs.find((p) => p.pair === "NE-SE")!;
    // 0,5 R$ está abaixo da tolerância: só as horas 2 e 3 descolaram
    expect(DECOUPLE_BRL).toBe(1);
    expect(s.decoupledHours).toBe(2);
    expect(s.pricedHours).toBe(4);
    expect(s.meanSpreadDecoupled).toBeCloseTo((192.69 - 180) / 2, 6);
    // hora 2: SE mais caro, energia NE→SE (coerente); hora 3: NE mais caro, energia SE→NE (coerente)
    expect(s.towardExpensive).toBe(1);
    expect(s.meanRealCoupled).toBe(3500);
    expect(s.latest).toEqual({ ts: H(3), real: -200, prog: 3100 });
    expect(s.maeProg).toBeCloseTo((100 + 900 + 1900 + 3300) / 4, 6);
    // sem PLD: séries e estatísticas de fluxo continuam, sem descolamento
    const noPld = interchangeView(rows, null).pairs.find((p) => p.pair === "NE-SE")!;
    expect(noPld.pricedHours).toBe(0);
    expect(noPld.decoupledShare).toBeNull();
    expect(noPld.hours).toBe(4);
  });

  it("confere com o intercâmbio do balanço de energia (no Sul sobra o internacional)", () => {
    const t = H(10);
    const rows: InterchangeRow[] = [
      { ts: t, pair: "N-NE", real: -2000, prog: null },
      { ts: t, pair: "N-SE", real: 1500, prog: null },
      { ts: t, pair: "NE-SE", real: 4000, prog: null },
      { ts: t, pair: "S-SE", real: -1000, prog: null },
    ];
    const bal = (sub: BalanceRow["sub"], intercambio: number): BalanceRow => ({ sub, ts: t, hidro: 0, termica: 0, eolica: 0, solar: 0, carga: 0, intercambio });
    // N exporta 1.500 para SE e importa 2.000 do NE; o Sul exporta 400 para fora do país
    const c = identityChecks(rows, [bal("N", -500), bal("NE", 6000), bal("SE", -4500), bal("S", -600)]);
    expect(c.find((x) => x.sub === "N")!.maxAbsDiff).toBe(0);
    expect(c.find((x) => x.sub === "NE")!.maxAbsDiff).toBe(0);
    expect(c.find((x) => x.sub === "SE")!.maxAbsDiff).toBe(0);
    expect(c.find((x) => x.sub === "S")!.meanDiff).toBe(-400);
  });
});

describe("retrato do fluxo de potência (worker)", () => {
  it("o relatório real passa no esquema e campos desconhecidos são descartados", () => {
    const raw = { ...fixture(), extra: "x" };
    const r = GridSnapshotSchema.safeParse(raw);
    expect(r.success, JSON.stringify(r.error?.issues.slice(0, 3))).toBe(true);
    expect((r.data as Record<string, unknown>).extra).toBeUndefined();
    expect(r.data!.validation.intercambio.map((x) => x.par)).toEqual(["N-NE", "N-SE", "NE-SE", "S-SE"]);
  });

  it("reprova relatório incompleto ou fora de faixa", () => {
    const bad = (f: (x: ReturnType<typeof fixture>) => void) => {
      const x = fixture();
      f(x);
      return GridSnapshotSchema.safeParse(x).success;
    };
    expect(bad((x) => x.hours.pop())).toBe(false);
    expect(bad((x) => (x.validation.converged = 25))).toBe(false);
    expect(bad((x) => (x.lines[0].a = [48.8, 2.3]))).toBe(false); // coordenada fora do Brasil
    expect(bad((x) => (x.validation.intercambio[0].par = "N-S"))).toBe(false);
    expect(bad((x) => (x.sources[0].url = "javascript:alert(1)"))).toBe(false);
    expect(bad((x) => (x.v = 2))).toBe(false);
  });

  it("histórico: um resumo por dia, o reprocessamento substitui, guarda 30 dias", () => {
    const s = GridSnapshotSchema.parse(fixture());
    const one = summarize(s);
    expect(one).toMatchObject({ date: "2026-10-14", converged: 24, hours: 24, pandapowerOk: true, n1: { contingencias: 607, com_sobrecarga: 0, nao_convergiram: 1 } });
    let h = mergeHistory([], one);
    h = mergeHistory(h, { ...one, converged: 23 });
    expect(h).toHaveLength(1);
    expect(h[0].converged).toBe(23);
    for (let d = 1; d <= 40; d++) h = mergeHistory(h, { ...one, date: `2026-08-${String(d).padStart(2, "0")}` });
    expect(h).toHaveLength(HISTORY_DAYS);
    expect(h[h.length - 1].date).toBe("2026-10-14");
    expect(snapshotAgeDays("2026-10-14", "2026-10-16")).toBe(2);
  });

  it("auditoria dos modelos: critérios da rede saem do retrato", () => {
    const s = GridSnapshotSchema.parse(fixture());
    const base = { now: Date.parse("2026-10-16T15:00:00Z"), forecasts: {}, regimes: {}, bess: null, arbitrage: null, selfEval: null, pld: null, limits: { min: 57.31, maxHourly: 1611 }, pldSource: "teste" };
    const a = auditModels({ ...base, grid: { snapshot: s, ageDays: 2 } });
    const by = (id: string) => a.checks.find((c) => c.id === id)!;
    expect(by("rede.frescor").status).toBe("pass");
    expect(by("rede.convergencia").status).toBe("pass");
    expect(by("rede.pandapower").status).toBe("pass");
    expect(by("rede.cobertura").status).toBe("pass");
    expect(by("rede.balanco").status).toBe("pass");
    expect(by("rede.n1").status).toBe("pass");
    // status do worker → aprovado/atenção/reprovado
    expect(by("rede.intercambio.S-SE").status).toBe("pass");
    expect(by("rede.intercambio.NE-SE").status).toBe("warn");
    expect(by("rede.intercambio.N-SE").status).toBe("fail");
    expect(by("rede.intercambio.N-SE").detail).toContain("compensação série");
    expect(auditModels({ ...base, grid: { snapshot: s, ageDays: GRID_CHECKS.ageDays.warn + 1 } }).checks.find((c) => c.id === "rede.frescor")!.status).toBe("fail");
    // sem retrato: atenção, com o caminho para resolver
    const none = auditModels({ ...base, grid: { snapshot: null, ageDays: null } }).checks.filter((c) => c.model === "Rede elétrica");
    expect(none.map((c) => [c.id, c.status])).toEqual([["rede.frescor", "warn"]]);
    expect(none[0].detail).toContain("ADMIN_KEY");
    // sem o campo, nada da rede entra (auditorias antigas)
    expect(auditModels(base).checks.some((c) => c.model === "Rede elétrica")).toBe(false);
  });
});

describe("POST /api/rede/ingest", () => {
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
    const { POST } = await import("@/app/api/rede/ingest/route");
    return POST(new Request("http://x/api/rede/ingest", { method: "POST", body: typeof body === "string" ? body : new Uint8Array(body), headers }));
  };

  it("desligada sem segredo, recusa token errado, aceita gzip válido e reprova esquema", async () => {
    expect((await post("{}")).status).toBe(503);
    process.env.ADMIN_KEY = "chave-de-teste";
    expect((await post("{}", { authorization: "Bearer outra" })).status).toBe(401);
    const ok = await post(gzipSync(JSON.stringify(fixture())), { authorization: "Bearer chave-de-teste", "content-encoding": "gzip" });
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j).toMatchObject({ dia: "2026-10-14", convergiu: "24/24", armazenamento: "memory" });
    const { loadGridSnapshot } = await import("@/lib/grid/store");
    const g = await loadGridSnapshot();
    expect(g.snapshot?.date).toBe("2026-10-14");
    expect(g.history).toHaveLength(1);
    // o mesmo slot de 30 s barra reenvio imediato
    expect((await post(JSON.stringify(fixture()), { authorization: "Bearer chave-de-teste" })).status).toBe(429);
  });

  it("corpo fora do esquema volta 422 com o caminho do problema", async () => {
    process.env.ADMIN_KEY = "chave-de-teste";
    const x = fixture();
    x.validation.converged = "24";
    const r = await post(JSON.stringify(x), { authorization: "Bearer chave-de-teste" });
    expect(r.status).toBe(422);
    expect((await r.json()).issues[0]).toContain("validation.converged");
  });
});

describe("formatação", () => {
  it("diferença minúscula em notação científica", async () => {
    const { tinyMw } = await import("@/lib/fmt");
    expect(tinyMw(4.71e-7)).toBe("4,7·10⁻⁷ MW");
    expect(tinyMw(0.25)).toBe("0,250 MW");
    expect(tinyMw(0)).toBe("0,000 MW");
    expect(tinyMw(null)).toBe("—");
  });
});
