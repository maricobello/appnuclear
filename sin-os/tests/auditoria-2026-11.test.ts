import { describe, expect, it } from "vitest";
import { conferirFatura, faturaEsperadaB } from "../src/lib/gd/bill";
import { cativoSimulado } from "../src/lib/gd/gestao";
import { parseFatura } from "../src/lib/gd/parse";
import { parcelaNaoCompensada } from "../src/lib/gd/rules";
import { executeGdTool } from "../src/lib/assistant/gd-tools";
import type { FaturaGD } from "../src/lib/gd/types";

const fat = (o: Partial<FaturaGD>): FaturaGD => ({ id: Math.random().toString(36).slice(2), confianca: 1, faltando: [], ...o });

describe("auditoria nov/2026 — leitura de faturas", () => {
  it("GD-01: o artigo 'as' não vira subgrupo AS", () => {
    const { fatura } = parseFatura("Confira as informações da sua conta\nClasse residencial B1 monofásico\nConsumo kWh 300");
    expect(fatura.subgrupo).toBe("B1");
    expect(fatura.grupo).toBe("B");
  });
  it("GD-03: 'valor total dos tributos' não é o total da fatura", () => {
    const { fatura } = parseFatura("Valor total dos tributos R$ 45,00\nTotal a pagar R$ 312,40");
    expect(fatura.totalRs).toBe(312.4);
  });
  it("GD-05: o fallback de compensação ignora datas e exige kWh", () => {
    const { fatura } = parseFatura("Compensação de créditos referente a 09/2026: 350 kWh");
    expect(fatura.compensadaKwh).toBe(350);
  });
});

describe("auditoria nov/2026 — conferência e fatura esperada", () => {
  it("GD-06: faturado no mínimo sem crédito sobrando não é duplicidade", () => {
    const a = conferirFatura(fat({ uc: "1", ref: "2026-06", enquadramento: "GD II", ligacao: "tri", consumoKwh: 400, compensadaKwh: 300, saldoKwh: 0, fioBRs: 30, injetadaKwh: 300 }));
    expect(a.map((x) => x.codigo)).not.toContain("disponibilidade_duplicada");
  });
  it("GD-08: ICMS sobre a compensada não tributa de novo o Fio B", () => {
    const base = { enquadramento: "GD II" as const, ano: 2026, consumoKwh: 500, creditosMesKwh: 400, saldoAnteriorKwh: 0, ligacao: "bi" as const, tarifas: { te: 0.4, tusd: 0.4, fioB: 0.2, icms: 0.18 } };
    const isento = faturaEsperadaB({ ...base, icmsCompensada: "isento" }).tributos.icms;
    const tusd = faturaEsperadaB({ ...base, icmsCompensada: "tusd" }).tributos.icms;
    // a TUSD menos a parcela de Fio B já tributada: 400 × (0,40 − 0,12) × 0,18/0,82
    expect(tusd - isento).toBeCloseTo((400 * (0.4 - 0.12) * 0.18) / 0.82, 1);
  });
  it("alíquotas absurdas não zeram tributos em silêncio: viram premissa", () => {
    const r = faturaEsperadaB({ enquadramento: "GD II", ano: 2026, consumoKwh: 500, creditosMesKwh: 400, saldoAnteriorKwh: 0, ligacao: "bi", tarifas: { te: 0.35, tusd: 0.45, icms: 0.18, pis: 0.79, cofins: 0.0364 } });
    expect(r.premissas.some((p) => p.includes("tributos não calculados"))).toBe(true);
  });
});

describe("auditoria nov/2026 — Iara (GD)", () => {
  const c = { ucs: [], faturas: [], usinas: [] };
  const args = { te: 0.35, tusd: 0.45, fio_b: 0.2, consumo_kwh: 500, creditos_kwh: 400, ligacao: "bi", icms_pct: 18, cofins_pct: 3.64 };
  it("GD-02/IA-01: PIS abaixo de 1% é lido em % (0,79%), não como 79%", () => {
    const r = executeGdTool("gd_fatura_esperada", { ...args, pis_pct: 0.79 }, c)!.result as { tributos: { icms: number; pis: number } };
    expect(r.tributos.icms).toBeGreaterThan(20);
    expect(r.tributos.pis).toBeLessThan(2);
  });
  it("IA-02: ligação e enquadramento inválidos viram erro; 'trifásico' é aceito", () => {
    expect(() => executeGdTool("gd_fatura_esperada", { ...args, ligacao: "quadrifasico" }, c)).toThrow(/ligacao/);
    expect(() => executeGdTool("gd_fatura_esperada", { ...args, enquadramento: "GD IV" }, c)).toThrow(/enquadramento/);
    const ok = executeGdTool("gd_fatura_esperada", { ...args, ligacao: "trifásico", enquadramento: "GDII" }, c)!.result as { compensadaKwh: number };
    expect(ok.compensadaKwh).toBeGreaterThan(0);
  });
});

describe("auditoria nov/2026 — cativo e regras", () => {
  it("GD-09/10: cativo 'fatura + créditos' sem o Fio B e com a bandeira cheia", () => {
    const r = cativoSimulado(fat({ grupo: "A", demandaKw: 50, consumoKwh: 1000, compensadaKwh: 900, totalRs: 208, compensacaoRs: -900, fioBRs: 108, bandeiraRs: 2.51 }))!;
    expect(r.rs).toBeCloseTo(208 + 900 - 108 + (25.1 - 2.51), 1);
  });
  it("GD-13: GD I após 2045 cai na mesma hipótese do art. 17 (100% do Fio B)", () => {
    expect(parcelaNaoCompensada("GD I", 2046).fioB).toBe(1);
    expect(parcelaNaoCompensada("GD I", 2045).fioB).toBe(0);
  });
});

describe("auditoria nov/2026 — BESS", () => {
  it("BES-01: com o CAPEX fixo, mais degradação nunca melhora o VPL", async () => {
    const { bessFinance } = await import("../src/lib/market/bess-finance");
    const inp = { powerMW: 100, capacityMWh: 400, lcos: 312.45, waccPct: 10, lifeYears: 20, degPctYear: 0.5, opexPctCapex: 1.5, rte: 0.88, refCyclesPerDay: 1 } as Parameters<typeof bessFinance>[0];
    const base = bessFinance(inp, 20e6, 100000);
    const pior = bessFinance({ ...inp, degPctYear: 5 }, 20e6, 100000, base.capex);
    expect(pior.npv).toBeLessThan(base.npv);
  });
});

describe("auditoria nov/2026 — roteamento da Iara (IA-03)", () => {
  it("frases reais vão para o assunto certo", async () => {
    const { routeDomains } = await import("../src/lib/assistant/harness");
    const r = (t: string) => routeDomains([t]);
    expect(r("o PLD está no piso hoje?")).not.toContain("gd");
    expect(r("o PLD está no piso hoje?")).not.toContain("tarifas");
    expect(r("previsão de chuva nas bacias")).not.toContain("dados");
    expect(r("PLD de curto prazo no sudeste?")).not.toContain("rede");
    expect(r("como está a barragem de Furnas?")).toContain("hidro");
    expect(r("esse dado é simulado?")).not.toContain("bess");
    expect(r("quanto vai ser o PLD em março?")).toContain("planejamento");
    expect(r("qual o nível de curto-circuito em Ibiúna?")).toContain("rede");
    expect(r("quanto de pis e cofins tem na conta?")).toContain("tarifas");
  });
});
