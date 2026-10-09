import { describe, expect, it } from "vitest";
import { buildPlant, headerId, parseRow, slugify } from "../scripts/usinas/lib.mjs";
import { simulateGeneration } from "@/lib/solar";
import { analyzeFinance } from "@/lib/finance";
import type { MarketRates, Plant, SolarResource } from "@/lib/types";

const linha = {
  Nome: "Usina São José",
  Status: "Operação".replace("Operação", "operacao"),
  Município: "Unaí",
  UF: "mg",
  "Código IBGE": 3170404,
  Latitude: "-16,357",
  Longitude: "-46,906",
  Distribuidora: "CEMIG",
  "Potência kWp": "1.801,8",
  "Potência kW CA": 1500,
  "PPA ativo": "Sim",
  "PPA contraparte": "Cooperativa X",
  "PPA fim": "30/06/2034",
  "Preço venda R$": "R$ 7.200.000",
  Estrutura: "Seguidor",
};

describe("importador da planilha de usinas", () => {
  it("normaliza cabeçalhos, números BR, datas e sim/não", () => {
    expect(headerId("Potência kW CA")).toBe("potencia_kw_ca");
    const { valores, erros } = parseRow(linha, 2);
    expect(erros).toEqual([]);
    expect(valores.potencia_kwp).toBeCloseTo(1801.8);
    expect(valores.latitude).toBeCloseTo(-16.357);
    expect(valores.ppa_ativo).toBe(true);
    expect(valores.ppa_fim).toBe("2034-06-30");
    expect(valores.preco_venda_rs).toBe(7_200_000);
    expect(valores.uf).toBe("MG");
    expect(slugify("Usina São José")).toBe("usina-sao-jose");
  });

  it("aponta colunas obrigatórias, listas e potências inconsistentes", () => {
    const { erros } = parseRow({ Nome: "X", Status: "ativa", UF: "MG", "Potência kWp": 5000, "Potência kW CA": 2000, "PPA ativo": "talvez" }, 3);
    expect(erros.join(" ")).toMatch(/status/);
    expect(erros.join(" ")).toMatch(/ppa_ativo/);
    expect(erros.join(" ")).toMatch(/municipio/);
    expect(erros.join(" ")).toMatch(/CC\/CA/);
  });

  it("gera uma usina que o modelo de geração e o financeiro aceitam", () => {
    const { valores } = parseRow(linha, 2);
    const p = buildPlant(valores, { ibgeCode: 3170404, fotos: ["/images/usinas/usina-sao-jose/a.jpg"] }) as Plant;
    expect(p.slug).toBe("usina-sao-jose");
    expect(p.illustrative).toBe(false);
    expect(p.commercial?.ppaActive).toBe(true);
    expect(p.commercial?.askingPriceBRL).toBe(7_200_000);
    expect(p.token.totalCotas * p.token.cotaPriceBRL).toBe(7_200_000);
    expect(p.tech.mounting).toBe("single-axis");
    expect(p.cover).toBe("/images/usinas/usina-sao-jose/a.jpg");
    const fb = p.fallbackClimate;
    const resource: SolarResource = { monthly: fb, annualGhiKWhM2: fb.ghiKWhM2Day.reduce((s, x) => s + x * 30.4, 0), interannualCvPct: fb.interannualCvPct, provenance: [] };
    const g = simulateGeneration(p, resource, null);
    expect(g.specificYieldKWhPerKWp).toBeGreaterThan(1300);
    const market = { selicPct: 15, cdiPct: 14.9, ipcaPct: 5, ipcaLongTermPct: 3.8, realRatePct: 7, tesouroIpcaRealPct: 7, poupancaPct: 6.17, usdtBrl: 5.5, bnbBrl: 3000, provenance: [] } as unknown as MarketRates;
    const f = analyzeFinance(p, g, market, { monteCarloRuns: 50, seed: 1 });
    expect(Number.isFinite(f.irrNominalPct)).toBe(true);
    expect(f.investmentBRL).toBe(7_200_000);
  });
});
