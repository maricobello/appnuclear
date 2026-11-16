import { describe, expect, it } from "vitest";
import { aliquotasDoAno, simularReforma, PREMISSAS_PADRAO } from "../src/lib/tarifa/calc";
import { aliquotasOficiais, arredondar, baseCibs, calcularCibs, classificarEnergia, exclusaoCompensada } from "../src/lib/tarifa/rtc";
import { executeTarifaTool } from "../src/lib/assistant/tarifa-tools";

describe("tabelas oficiais da Calculadora RTC (energia elétrica)", () => {
  it("só 2026 tem alíquota oficial publicada: CBS 0,9%, IBS UF 0,1%, IBS municipal 0%", () => {
    expect(aliquotasOficiais(2026)).toEqual({ cbs: 0.009, ibsUf: 0.001, ibsMun: 0 });
    expect(aliquotasOficiais(2027)).toBeNull();
    expect(aliquotasDoAno(2026).oficial).toBe(true);
    const a27 = aliquotasDoAno(2027);
    expect(a27.oficial).toBe(false);
    expect(a27.ibsUf).toBeCloseTo(0.0005, 10);
    expect(a27.ibsMun).toBeCloseTo(0.0005, 10);
    expect(a27.cbs).toBeCloseTo(PREMISSAS_PADRAO.cbsRef - 0.001, 10);
    expect(aliquotasDoAno(2030).dividido).toBe(false);
  });

  it("enquadramento: consumo 000001, cadeia 510001 (diferimento), compensada 830001 até 1 MW", () => {
    expect(classificarEnergia("consumo").cClassTrib).toBe("000001");
    expect(classificarEnergia("cadeia")).toMatchObject({ cst: "510", cClassTrib: "510001" });
    expect(classificarEnergia("compensada", 1000).cClassTrib).toBe("830001");
    const grande = classificarEnergia("compensada", 2500);
    expect(grande.cClassTrib).toBe("000001");
    expect(grande.alerta).toMatch(/1 MW/);
  });

  it("arredondamento HALF_EVEN, como o ArredondamentoUtils oficial", () => {
    expect(arredondar(2.675)).toBe(2.68);
    expect(arredondar(2.665)).toBe(2.66);
    expect(arredondar(0.125)).toBe(0.12);
    expect(arredondar(1.006)).toBe(1.01);
  });
});

describe("base de cálculo oficial (BaseCalculoService.calcularCibs)", () => {
  it("tira ICMS, PIS, Cofins e COSIP da base", () => {
    const b = baseCibs({ ano: 2026, valor: 1000 + 20, cosip: 20, icms: 180, pis: 10.5, cofins: 48.4 });
    expect(b.base).toBe(761.1);
    expect(b.erros).toEqual([]);
  });

  it("valida a vigência: PIS/Cofins só até 2026, ICMS só até 2032, CBS/IBS a partir de 2026", () => {
    expect(baseCibs({ ano: 2027, valor: 100, pis: 1 }).erros.join()).toMatch(/PIS e Cofins/);
    expect(baseCibs({ ano: 2033, valor: 100, icms: 1 }).erros.join()).toMatch(/ICMS/);
    expect(baseCibs({ ano: 2025, valor: 100 }).erros.join()).toMatch(/2026/);
  });

  it("fatura de 2026: base sem tributos × 0,9% e 0,1%, destacado e sem custo", () => {
    // R$ 761,10 de base → CBS 6,85 (6,8499), IBS UF 0,76 (0,7611), IBS mun 0
    const c = calcularCibs("consumo", 2026, 761.1);
    expect(c.tributos.map((t) => t.valor)).toEqual([6.85, 0.76, 0]);
    expect(c.totalDestacado).toBe(7.61);
    expect(c.teste).toBe(true);
    expect(c.oficial).toBe(true);
    expect(c.memoria).toMatch(/761,10/);
  });

  it("venda na cadeia: calculado e 100% diferido", () => {
    const c = calcularCibs("cadeia", 2026, 10000);
    expect(c.totalDestacado).toBe(100);
    expect(c.totalDevido).toBe(0);
  });

  it("de 2027 em diante usa a estimativa recebida e marca como não oficial", () => {
    const c = calcularCibs("consumo", 2027, 1000, { estimativa: aliquotasDoAno(2027) });
    expect(c.oficial).toBe(false);
    expect(c.tributos[0].valor).toBe(87);
    expect(c.tributos[1].valor).toBe(0.5);
  });
});

describe("energia compensada na GD (art. 28, §§ 3º e 4º)", () => {
  it("exclui só kWh compensado × TE, até 1 MW", () => {
    const e = exclusaoCompensada(500, 0.3, 75);
    expect(e).toMatchObject({ exclusao: 150, elegivel: true });
    expect(exclusaoCompensada(500, 0.3, 1500)).toMatchObject({ exclusao: 0, elegivel: false });
    expect(calcularCibs("compensada", 2026, 150, { potenciaKw: 75 }).base).toBe(0);
  });
});

describe("integração com a simulação e a Iara", () => {
  it("2026 da simulação usa a tabela oficial e marca o ano", () => {
    const [a26, a27] = simularReforma(500, PREMISSAS_PADRAO, [2026, 2027]);
    expect(a26.aliquotaOficial).toBe(true);
    expect(a27.aliquotaOficial).toBe(false);
    expect(a26.destaqueTesteKwh).toBeCloseTo(0.5 * 0.01, 4);
  });

  it("reforma_tributaria devolve o enquadramento oficial", async () => {
    const r = (await executeTarifaTool("reforma_tributaria", { tarifa_mwh: 600 })) as { oficial_receita: { enquadramentos: { cclasstrib: string }[] } };
    expect(r.oficial_receita.enquadramentos.map((e) => e.cclasstrib)).toEqual(["000001", "510001", "830001"]);
  });
});
