import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { conferirFatura, conferirLote, faturaEsperadaB, otimizarDemanda } from "../src/lib/gd/bill";
import { analisarAssinatura, irr, npv, viabilidade } from "../src/lib/gd/finance";
import { parseBR, parseFatura } from "../src/lib/gd/parse";
import { pdfText } from "../src/lib/gd/pdf";
import { cronogramaFioB, enquadrar, garantiaFielCumprimento, parcelaNaoCompensada } from "../src/lib/gd/rules";
import type { FaturaGD } from "../src/lib/gd/types";

const pdf = (n: string) => new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures/faturas", `${n}.pdf`)));
const fat = (o: Partial<FaturaGD>): FaturaGD => ({ id: Math.random().toString(36).slice(2), confianca: 1, faltando: [], ...o });

describe("regras da GD (Lei 14.300)", () => {
  it("enquadra GD I, GD II (com e sem a janela de 18 meses) e GD III", () => {
    expect(enquadrar({ dataProtocolo: "2022-12-01", potenciaKw: 10 }).enquadramento).toBe("GD I");
    expect(enquadrar({ dataProtocolo: "2023-01-07", potenciaKw: 10 })).toMatchObject({ enquadramento: "GD I", transicaoAte: 2046 });
    const janela = enquadrar({ dataProtocolo: "2023-03-10", potenciaKw: 10 });
    expect(janela).toMatchObject({ enquadramento: "GD II", transicaoAte: 2031 });
    expect(enquadrar({ dataProtocolo: "2024-05-01", potenciaKw: 10 })).toMatchObject({ enquadramento: "GD II", transicaoAte: 2029 });
    expect(enquadrar({ dataProtocolo: "2024-05-01", potenciaKw: 600, fonte: "solar", modalidade: "remoto" }).enquadramento).toBe("GD III");
    expect(enquadrar({ dataProtocolo: "2024-05-01", potenciaKw: 600, fonte: "solar", modalidade: "compartilhada", maiorTitularPct: 10 }).enquadramento).toBe("GD II");
    expect(enquadrar({ dataProtocolo: "2024-05-01", potenciaKw: 600, fonte: "biomassa", modalidade: "remoto" }).enquadramento).toBe("GD II");
    expect(enquadrar({ dataProtocolo: "2025-01-01", potenciaKw: 4000, fonte: "solar" }).porte).toBe("acima do limite");
  });

  it("Fio B por ano: 60% em 2026, 90% em 2028, art. 17 depois; GD I não paga; GD III paga Fio A", () => {
    expect(parcelaNaoCompensada("GD II", 2026).fioB).toBe(0.6);
    expect(parcelaNaoCompensada("GD II", 2028).fioB).toBe(0.9);
    expect(parcelaNaoCompensada("GD II", 2029)).toMatchObject({ fioB: 1, pendenteArt17: true });
    expect(parcelaNaoCompensada("GD II", 2030, 2031).fioB).toBe(0.9);
    expect(parcelaNaoCompensada("GD I", 2040).fioB).toBe(0);
    expect(parcelaNaoCompensada("GD III", 2026)).toMatchObject({ fioB: 1, fioA: 0.4, encargos: true });
    expect(cronogramaFioB("GD II", 2025, 2029).map((c) => c.fioBPct)).toEqual([45, 60, 75, 90, 100]);
  });

  it("garantia de fiel cumprimento: 2,5% até 1 MW, 5% acima, dispensada na compartilhada", () => {
    expect(garantiaFielCumprimento(400).pct).toBe(0);
    expect(garantiaFielCumprimento(800).pct).toBe(2.5);
    expect(garantiaFielCumprimento(1500).pct).toBe(5);
    expect(garantiaFielCumprimento(1500, "compartilhada").pct).toBe(0);
  });
});

describe("fatura esperada (grupo B)", () => {
  const tar = { te: 0.3, tusd: 0.42, fioB: 0.2 };
  it("GD II compensa tudo quando o Fio B já paga o mínimo; guarda o saldo", () => {
    const f = faturaEsperadaB({ enquadramento: "GD II", ano: 2026, consumoKwh: 420, creditosMesKwh: 380, saldoAnteriorKwh: 120, ligacao: "bi", tarifas: tar });
    expect(f.compensadaKwh).toBe(420);
    expect(f.saldoFinalKwh).toBe(80);
    expect(f.linhas.find((l) => l.item.startsWith("Fio B"))?.valorRs).toBe(50.4);
    expect(f.minimoAplicado).toBe(false);
  });

  it("GD II para a compensação no custo de disponibilidade, sem cobrar os dois", () => {
    const f = faturaEsperadaB({ enquadramento: "GD II", ano: 2026, consumoKwh: 60, creditosMesKwh: 500, saldoAnteriorKwh: 0, ligacao: "bi", tarifas: tar });
    expect(f.compensadaKwh).toBe(12); // (60−50)·0,72/(0,72−0,12)
    const base = f.linhas.reduce((s, l) => s + l.valorRs, 0);
    expect(base).toBeCloseTo(50 * 0.72, 2);
    expect(f.minimoAplicado).toBe(true);
    expect(f.saldoFinalKwh).toBe(488);
  });

  it("GD I sempre paga o mínimo e compensa o resto; sem GD paga o mínimo se consumir pouco", () => {
    const g1 = faturaEsperadaB({ enquadramento: "GD I", ano: 2026, consumoKwh: 420, creditosMesKwh: 500, saldoAnteriorKwh: 0, ligacao: "tri", tarifas: tar });
    expect(g1.compensadaKwh).toBe(320);
    expect(g1.faturadaKwh).toBe(100);
    const sem = faturaEsperadaB({ enquadramento: "sem GD", ano: 2026, consumoKwh: 20, creditosMesKwh: 0, saldoAnteriorKwh: 0, ligacao: "mono", tarifas: tar });
    expect(sem.linhas.find((l) => l.item.startsWith("Complemento"))?.valorRs).toBeCloseTo(10 * 0.72, 2);
  });

  it("tributos por dentro: ICMS e PIS/Cofins sobre a base dividida por (1 − alíquotas)", () => {
    const f = faturaEsperadaB({ enquadramento: "sem GD", ano: 2026, consumoKwh: 100, creditosMesKwh: 0, saldoAnteriorKwh: 0, ligacao: "mono", tarifas: { te: 0.4, tusd: 0.4, icms: 0.18, pis: 0.01, cofins: 0.05 } });
    const gross = 80 / (1 - 0.24);
    expect(f.tributos.icms).toBeCloseTo(gross * 0.18, 1);
    expect(f.totalRs).toBeCloseTo(gross, 1);
    expect(f.semGdRs).toBeCloseTo(gross, 1);
  });
});

describe("leitura de faturas", () => {
  it("números no formato brasileiro, inclusive negativo com sinal no fim", () => {
    expect(parseBR("1.234,56")).toBe(1234.56);
    expect(parseBR("143,85-")).toBe(-143.85);
    expect(parseBR("1.234")).toBe(1234);
    expect(parseBR("R$ 45.095,50")).toBe(45095.5);
    expect(parseBR("12.5")).toBeNull();
  });

  it("CPFL GD II: itens TE/TUSD, crédito, Fio B implícito, quadro SCEE e tributos", async () => {
    const { fatura: f } = parseFatura((await pdfText(pdf("cpfl-gd2"))).text);
    expect(f).toMatchObject({ uc: "4002881234", ref: "2026-09", vencimento: "15/10/2026", totalRs: 168.12, consumoKwh: 420, compensadaKwh: 350, injetadaKwh: 380, saldoAnteriorKwh: 120, saldoKwh: 150, ligacao: "bi", enquadramento: "GD II", distribuidora: "CPFL", icmsPct: 0.18, confianca: 1 });
    expect(f.fioBRs).toBeCloseTo((0.51832 - 0.411) * 350, 1);
    expect(f.bandeira).toBe("amarela");
  });

  it("Cemig GD I: consumo = energia elétrica + SCEE isenta; crédito separado; total sem rótulo longo", async () => {
    const { fatura: f } = parseFatura((await pdfText(pdf("cemig-gd1"))).text);
    expect(f).toMatchObject({ uc: "3012345678", ref: "2026-10", consumoKwh: 610, compensadaKwh: 480, injetadaKwh: 500, saldoKwh: 1250, totalRs: 160.5, ligacao: "tri", enquadramento: "GD I" });
  });

  it("Enel grupo A: demanda, ultrapassagem, reativo, ponta e fora ponta", async () => {
    const { fatura: f } = parseFatura((await pdfText(pdf("enel-a4"))).text);
    expect(f).toMatchObject({ uc: "0012345678", ref: "2026-09", grupo: "A", subgrupo: "A4", modalidadeTarifaria: "verde", demandaKw: 310, demandaContratadaKw: 280, ultrapassagemRs: 1887, reativoRs: 384, consumoPontaKwh: 4500, consumoForaPontaKwh: 52000, totalRs: 45095.5 });
  });

  it("texto sem campos vira leitura incompleta, não exceção", () => {
    const { fatura } = parseFatura("documento qualquer sem números de energia");
    expect(fatura.confianca).toBeLessThan(0.5);
    expect(fatura.faltando).toContain("consumoKwh");
  });
});

describe("conferência", () => {
  it("aponta créditos parados, Fio B em GD I, ultrapassagem e reativo", async () => {
    const cpfl = parseFatura((await pdfText(pdf("cpfl-gd2"))).text).fatura;
    expect(conferirFatura(cpfl).map((a) => a.codigo)).toContain("creditos_nao_usados");
    const enel = parseFatura((await pdfText(pdf("enel-a4"))).text).fatura;
    expect(conferirFatura(enel).map((a) => a.codigo)).toEqual(expect.arrayContaining(["ultrapassagem", "reativo"]));
    const g1 = conferirFatura(fat({ uc: "1", ref: "2026-05", enquadramento: "GD I", consumoKwh: 300, compensadaKwh: 250, fioBRs: 30 }));
    expect(g1.find((a) => a.codigo === "fio_b_gd1")?.impactoRs).toBe(30);
  });

  it("GD II com custo de disponibilidade e Fio B juntos é indício de duplicidade", () => {
    const a = conferirFatura(fat({ uc: "1", ref: "2026-05", enquadramento: "GD II", ligacao: "bi", consumoKwh: 300, compensadaKwh: 250, fioBRs: 25, disponibilidadeRs: 38 }));
    expect(a.find((x) => x.codigo === "disponibilidade_duplicada")?.impactoRs).toBe(25);
  });

  it("lote: deduplica o mesmo mês, encadeia o saldo e acha queda de injeção", () => {
    const base = { uc: "77", enquadramento: "GD II" as const, ligacao: "bi" as const, consumoKwh: 400, compensadaKwh: 350 };
    const fs = [
      fat({ ...base, ref: "2026-01", injetadaKwh: 500, saldoKwh: 200 }),
      fat({ ...base, ref: "2026-02", injetadaKwh: 510, saldoAnteriorKwh: 200, saldoKwh: 360 }),
      fat({ ...base, ref: "2026-03", injetadaKwh: 490, saldoAnteriorKwh: 360, saldoKwh: 500 }),
      fat({ ...base, ref: "2026-04", injetadaKwh: 200, saldoAnteriorKwh: 420, saldoKwh: 270 }),
      fat({ ...base, ref: "2026-04", injetadaKwh: 200, saldoAnteriorKwh: 420, saldoKwh: 270, confianca: 0.5 }),
    ];
    const lote = conferirLote(fs);
    expect(lote.ucs[0].meses).toBe(4);
    const cod = lote.alertas.map((a) => a.codigo);
    expect(cod).toEqual(expect.arrayContaining(["saldo_inconsistente", "injecao_queda"]));
    const w = { alta: 3, media: 2, baixa: 1 } as const;
    const sevs = lote.alertas.map((a) => w[a.sev]);
    expect(sevs).toEqual([...sevs].sort((a, b) => b - a)); // mais graves primeiro
  });

  it("demanda contratada ótima com a regra dos 105%", () => {
    const r = otimizarDemanda([300, 310, 290, 305, 295, 320], 30, 280)!;
    expect(r.otimaKw).toBe(305);
    expect(r.custoAnualRs).toBe(111000);
    expect(r.economiaAnoRs).toBe(13800);
    expect(otimizarDemanda([300], 30)).toBeNull();
  });
});

describe("finanças da GD", () => {
  it("VPL e TIR consistentes", () => {
    const flows = [-1000, 300, 300, 300, 300, 300];
    const t = irr(flows)!;
    expect(npv(t, flows)).toBeCloseTo(0, 4);
    expect(irr([100, 100])).toBeNull();
  });

  it("viabilidade com premissas declaradas e Fio B subindo", () => {
    const v = viabilidade({ potenciaKwp: 10, tarifaRsKwh: 0.95, anoInicio: 2026, dataProtocolo: "2026-01-10" });
    expect(v.enquadramento).toBe("GD II");
    expect(v.tirPct).toBeGreaterThan(10);
    expect(v.paybackAnos).toBeLessThan(8);
    expect(v.premissas.join(" ")).toContain("R$ 3.200/kWp");
    const fio = v.marcos.map((m) => m.fioBPct);
    expect(fio[0]).toBe(60);
    expect(Math.max(...fio)).toBe(100);
  });

  it("assinatura: o desconto efetivo cai quando o assinante paga o Fio B", () => {
    const a = analisarAssinatura({ tarifaRsKwh: 1, descontoPct: 15, creditosKwhMes: 1000, anoInicio: 2026, anos: 4, fioBRsKwh: 0.25, tributosPct: 25 });
    const d = a.porMes.map((x) => x.descontoEfetivoPct);
    expect(d[0]).toBeGreaterThan(d[2]);
    expect(a.alerta).toMatch(/cai para/);
    const gerador = analisarAssinatura({ tarifaRsKwh: 1, descontoPct: 15, creditosKwhMes: 1000, anoInicio: 2026, anos: 3, fioBPorConta: "gerador" });
    expect(gerador.porMes.every((x) => x.descontoEfetivoPct === 15)).toBe(true);
  });
});
