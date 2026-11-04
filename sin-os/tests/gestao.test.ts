import { describe, expect, it } from "vitest";
import { executeGdTool } from "../src/lib/assistant/gd-tools";
import { cativoSimulado, resultadosCarteira, resultadosUc } from "../src/lib/gd/gestao";
import type { CarteiraGD, FaturaGD, UcGD, UsinaGD } from "../src/lib/gd/types";

// números fictícios: usina de locação com custos fixos rateados entre as UCs
const USINA: UsinaGD = { id: "u1", nome: "Usina Teste", locacaoRsMes: 100_000, terrenoRsMes: 10_000, omRsMes: 15_000, variavelRsMes: 1_000, economiaAssegPct: 12 };
const fat = (o: Partial<FaturaGD>): FaturaGD => ({ id: Math.random().toString(36).slice(2), confianca: 1, faltando: [], tarifasComTributos: true, ...o });
const mes = (ref: string, total: number, extra: Partial<FaturaGD> = {}) => fat({ uc: "11", ref, consumoKwh: 10_000, compensadaKwh: 8_000, teRsKwh: 0.3, tusdRsKwh: 0.4, cipRs: 20, totalRs: total, ...extra });

describe("cativo simulado", () => {
  it("grupo B pela tarifa da fatura; grupo A pelo pago + créditos; sem preço pelos itens", () => {
    expect(cativoSimulado(mes("2026-01", 1500))).toEqual({ rs: 7020, origem: "tarifa da fatura" });
    expect(cativoSimulado(fat({ grupo: "A", demandaKw: 300, totalRs: 40_000, compensacaoRs: -9_000, compensadaKwh: 12_000 }))).toEqual({ rs: 49_000, origem: "fatura + créditos" });
    expect(cativoSimulado(fat({ consumoKwh: 500, energiaRs: 410, cipRs: 15, tarifasComTributos: false }))).toEqual({ rs: 425, origem: "itens de energia" });
    expect(cativoSimulado(fat({ consumoKwh: 500 }))).toBeNull();
    const uc: UcGD = { uc: "1", teRsKwh: 0.3, tusdRsKwh: 0.4, ligacao: "tri", icms: 0.18 };
    expect(cativoSimulado(fat({ consumoKwh: 500, ref: "2026-03" }), uc)?.origem).toBe("tarifas da UC");
  });
});

describe("resultados por UC", () => {
  it("rateia os custos da usina pelo percentual da UC e compara com o cativo e com a economia assegurada", () => {
    const uc: UcGD = { uc: "11", usinaId: "u1", rateioPct: 3 };
    const r = resultadosUc("11", [mes("2026-01", 1500)], uc, USINA);
    const l = r.linhas[0];
    expect(l.custos).toEqual({ geracaoRs: 0, locacaoRs: 3000, terrenoRs: 300, omRs: 450, variavelRs: 30, contratoRs: 0 });
    expect(l.custosGdRs).toBe(3780);
    expect(l.despesaRs).toBe(5280);
    expect(l.cativoRs).toBe(7020);
    expect(l.economiaRs).toBe(1740);
    expect(l.economiaPct).toBe(24.8);
    expect(l.assegRs).toBe(6177.6);
    expect(l.faltaAssegRs).toBe(-897.6);
    expect(r.alertas).toEqual([]);
  });

  it("custo da usina inteira numa UC só vira alerta de rateio (o erro que gera economia de −2.000%)", () => {
    const r = resultadosUc("11", [mes("2026-01", 1500)], { uc: "11", usinaId: "u1", rateioPct: 100 }, USINA);
    expect(r.linhas[0].economiaPct).toBeLessThan(-1000);
    expect(r.alertas.map((a) => a.codigo)).toContain("rateio_suspeito");
    const semRateio = resultadosUc("11", [mes("2026-01", 1500)], { uc: "11", usinaId: "u1" }, USINA);
    expect(semRateio.linhas[0].custosGdRs).toBe(0);
    expect(semRateio.alertas[0].codigo).toBe("rateio_ausente");
  });

  it("garantia não cumprida: soma o que faltou para a economia assegurada", () => {
    const r = resultadosUc("22", [mes("2026-01", 4000, { uc: "22" }), mes("2026-02", 1000, { uc: "22" })], { uc: "22", usinaId: "u1", rateioPct: 5 }, USINA);
    // despesa = fatura + 5% de R$ 126 mil; teto = cativo × (1 − 12%) = R$ 6.177,60
    expect(r.linhas[0].faltaAssegRs).toBe(4122.4);
    expect(r.linhas[1].faltaAssegRs).toBe(1122.4);
    const g = r.alertas.find((a) => a.codigo === "garantia")!;
    expect(g.impactoRs).toBe(5244.8);
    expect(g.msg).toContain("2 de 2");
    const ok = resultadosUc("22", [mes("2026-01", 500, { uc: "22" })], { uc: "22", usinaId: "u1", rateioPct: 3 }, USINA);
    expect(ok.linhas[0].faltaAssegRs).toBeLessThan(0);
    expect(ok.alertas.find((a) => a.codigo === "garantia")).toBeUndefined();
  });

  it("lançamento do mês sobrescreve o padrão (ex.: remuneração variável negativa)", () => {
    const usina: UsinaGD = { ...USINA, meses: { "2026-02": { variavelRsMes: -500, faturaGeracaoRs: 900 } } };
    const r = resultadosUc("11", [mes("2026-01", 1500), mes("2026-02", 1500)], { uc: "11", usinaId: "u1", rateioPct: 10 }, usina);
    expect(r.linhas[0].custos.variavelRs).toBe(100);
    expect(r.linhas[1].custos.variavelRs).toBe(-50);
    expect(r.linhas[1].custos.geracaoRs).toBe(90);
  });

  it("assinatura: paga ao gerador os créditos com desconto sobre a tarifa da fatura", () => {
    const uc: UcGD = { uc: "33", contrato: { tipo: "assinatura", descontoPct: 15 } };
    const r = resultadosUc("33", [fat({ uc: "33", ref: "2026-01", consumoKwh: 1000, compensadaKwh: 800, teRsKwh: 0.35, tusdRsKwh: 0.45, totalRs: 150 })], uc);
    expect(r.linhas[0].custos.contratoRs).toBe(544);
    expect(r.linhas[0].despesaRs).toBe(694);
    expect(r.linhas[0].economiaRs).toBe(106);
    expect(r.linhas[0].assegRs).toBeNull(); // na assinatura o desconto já está no preço
  });
});

describe("carteira e usina consolidada", () => {
  it("consolida por usina e avisa quando o rateio não fecha 100%", () => {
    const c: CarteiraGD = {
      usinas: [USINA],
      ucs: [
        { uc: "11", usinaId: "u1", rateioPct: 3 },
        { uc: "22", usinaId: "u1", rateioPct: 5 },
      ],
      faturas: [mes("2026-01", 1500), mes("2026-01", 4000, { uc: "22" })],
    };
    const { ucs, usinas } = resultadosCarteira(c);
    expect(ucs.map((u) => u.uc)).toEqual(["11", "22"]);
    expect(usinas[0].rateioSomaPct).toBe(8);
    expect(usinas[0].alertas[0].codigo).toBe("rateio_soma");
    expect(usinas[0].linhas[0].cativoRs).toBe(14040);
    expect(usinas[0].total.custosGdRs).toBe(3780 + 6300);
  });
});

describe("ferramenta da Iara", () => {
  it("gd_resultados resume por UC e por usina, com alertas", () => {
    const c: CarteiraGD = { usinas: [USINA], ucs: [{ uc: "11", usinaId: "u1", rateioPct: 3 }], faturas: [mes("2026-01", 1500)] };
    const geral = executeGdTool("gd_resultados", {}, c)!.result as { ucs: { uc: string; economiaRs: number }[]; usinas: { alertas: string[] }[] };
    expect(geral.ucs[0]).toMatchObject({ uc: "11", economiaRs: 1740 });
    expect(geral.usinas[0].alertas[0]).toMatch(/soma 3%/);
    const uc = executeGdTool("gd_resultados", { uc: "11" }, c)!.result as { meses: { econ: number }[] };
    expect(uc.meses[0].econ).toBe(1740);
    expect((executeGdTool("gd_resultados", {}, { ucs: [], faturas: [], usinas: [] })!.result as { erro: string }).erro).toMatch(/vazia/);
  });
});
