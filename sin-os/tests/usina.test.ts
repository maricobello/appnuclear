import { describe, expect, it } from "vitest";
import tarifas from "./fixtures/aneel-tarifas-a4-geracao-cemig.json";
import comps from "./fixtures/aneel-componentes-cemig-a4-verde.json";
import { num } from "../src/lib/tarifa/calc";
import { compensar, conferirUsina, faturaUsina, fioDe, tarifaUsinaDe, type EntradaUsina, type LinhaTarifa } from "../src/lib/tarifa/usina";

type R = Record<string, string>;
const linhas: LinhaTarifa[] = (tarifas as R[]).map((x) => ({ modalidade: x.DscModalidadeTarifaria, detalhe: x.DscDetalhe, posto: x.NomPostoTarifario, unidade: x.DscUnidadeTerciaria, tusd: num(x.VlrTUSD), te: num(x.VlrTE), acessante: x.SigAgenteAcessante }));
const energia = (posto: string) => (comps as R[]).filter((c) => c.DscPostoTarifario === posto && c.DscUnidade === "R$/MWh" && c.DscDetalheConsumidor === "Não se aplica") as unknown as { DscComponenteTarifario: string; VlrComponenteTarifario: string }[];
const fio = { ponta: fioDe(energia("Ponta")), fora: fioDe(energia("Fora ponta")) };
const verde = tarifaUsinaDe(linhas, "Verde", fio)!;

const base: EntradaUsina = {
  regime: "SCEE",
  enquadramento: "GD II",
  ano: 2026,
  consumo: { ponta: 1000, fora: 20000 },
  injecao: { ponta: 0, fora: 150000 },
  creditoAnteriorKwh: 0,
  alocadoOutrasKwh: 100000,
  demandaContratada: { unica: 300 },
  demandaMedida: { unica: 280 },
  demandaGerContratada: 1000,
  demandaInjMedida: 1020,
  modoDemandaGeracao: "excedente",
  bandeiraMwh: 0,
  tributos: { icms: 0.18, pis: 0.0105, cofins: 0.0484 },
  icmsIsentaCompensada: true,
  icmsSobreNaoCompensada: true,
  reativoRs: 0,
  cipRs: 0,
  outrosRs: 0,
};

describe("tarifa da usina a partir dos dados da ANEEL (CEMIG A4)", () => {
  it("monta Verde e Azul com TUSDg e componentes", () => {
    expect(verde.energia.ponta).toEqual({ te: 474.22, tusd: 1912.96 });
    expect(verde.energia.fora).toEqual({ te: 294.98, tusd: 185.79 });
    expect(verde.demanda.unica).toBe(23.77);
    expect(verde.tusdg).toBe(13.57);
    const azul = tarifaUsinaDe(linhas, "Azul", null)!;
    expect(azul.demanda).toEqual({ ponta: 71.13, fora: 23.77 });
  });
  it("Fio B da energia: só a ponta da Verde carrega (fora ponta = 0)", () => {
    expect(fio.ponta.fioB).toBeCloseTo(1370.308, 2);
    expect(fio.fora.fioB).toBe(0);
    expect(fio.ponta.fioA).toBeCloseTo(340.467, 2);
  });
});

describe("compensação por posto", () => {
  it("sobra de fora ponta cobre a ponta pela razão das TE", () => {
    const c = compensar(verde, base);
    expect(c.compensado).toEqual({ ponta: 1000, fora: 20000 });
    expect(c.faturado).toEqual({ ponta: 0, fora: 0 });
    expect(c.fatorPontaFora).toBeCloseTo(294.98 / 474.22, 4);
    expect(c.transferencias.foraParaPonta).toBeCloseTo(1000 / (294.98 / 474.22), 1);
    expect(c.excedenteKwh).toBeCloseTo(130000 - 1000 / (294.98 / 474.22), 1);
    expect(c.novoSaldoKwh).toBeCloseTo(c.excedenteKwh - 100000, 1);
  });
  it("sem injeção suficiente, usa créditos anteriores (fora ponta primeiro)", () => {
    const c = compensar(verde, { ...base, injecao: { ponta: 0, fora: 5000 }, creditoAnteriorKwh: 10000 });
    expect(c.compensado.fora).toBe(15000);
    expect(c.creditoUsadoKwh).toBe(10000);
    expect(c.faturado.fora).toBe(5000);
  });
  it("central fora do SCEE não compensa nada", () => {
    expect(compensar(verde, { ...base, regime: "fora" }).faturado).toEqual({ ponta: 1000, fora: 20000 });
  });
});

describe("fatura esperada da usina", () => {
  const f = faturaUsina(verde, base);
  const linha = (id: string) => f.linhas.find((l) => l.id === id)!;
  it("GD II 2026: 60% do Fio B sobre a energia compensada na ponta", () => {
    expect(f.parcela.fioB).toBe(0.6);
    expect(linha("nc_ponta").liquido).toBeCloseTo(1000 * 0.6 * 1.370308, 1);
    expect(f.linhas.find((l) => l.id === "nc_fora")).toBeUndefined(); // fora ponta sem Fio B
  });
  it("demanda de consumo pelo maior valor e TUSDg sobre o excedente", () => {
    expect(linha("dem_unica").liquido).toBeCloseTo(300 * 23.77, 2);
    expect(linha("tusdg").quantidade).toBe(720);
    expect(linha("tusdg").liquido).toBeCloseTo(720 * 13.57, 2);
    expect(f.linhas.find((l) => l.id === "ult_ger")).toBeUndefined(); // 1020 ≤ 1050
  });
  it("tributos por dentro, linha a linha", () => {
    const d = linha("dem_unica");
    expect(d.total).toBeCloseTo(d.liquido / (1 - 0.18 - 0.0589), 1);
    expect(f.total).toBeCloseTo(f.totalLiquido + f.totalTributos, 2);
  });
  it("modo total cobra TUSDg sobre toda a injeção; ultrapassagem acima de 5%", () => {
    const g = faturaUsina(verde, { ...base, modoDemandaGeracao: "total", demandaInjMedida: 1100 });
    expect(g.linhas.find((l) => l.id === "tusdg")!.quantidade).toBe(1100);
    expect(g.linhas.find((l) => l.id === "ult_ger")!.liquido).toBeCloseTo(100 * 13.57 * 2, 2);
    expect(g.alertas.some((a) => a.nivel === "alta")).toBe(true);
  });
  it("GD I não paga parcela não compensada; GD III paga Fio A e encargos", () => {
    expect(faturaUsina(verde, { ...base, enquadramento: "GD I" }).linhas.some((l) => l.grupo === "Não compensado")).toBe(false);
    const g3 = faturaUsina(verde, { ...base, enquadramento: "GD III" }).linhas.find((l) => l.id === "nc_ponta")!;
    expect(g3.tarifa).toBeCloseTo((1370.308 + 0.4 * 340.467 + fio.ponta.ped + fio.ponta.tfsee) / 1000, 3);
  });
  it("conferência com a fatura real", () => {
    const real = { dem_unica: linha("dem_unica").total, tusdg: linha("tusdg").total * 1.1 };
    const c = conferirUsina(f, real, f.total * 1.02);
    expect(c.itens.find((i) => i.id === "dem_unica")!.status).toBe("conforme");
    expect(c.itens.find((i) => i.id === "tusdg")!.status).toBe("divergente");
    expect(c.total!.status).toBe("atenção");
  });
});

describe("laudo da usina em PDF", () => {
  it("gera o PDF com fatura esperada, conferência e premissas", async () => {
    const { jsPDF } = await import("jspdf");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { montarLaudoUsina, nomeArquivoUsina } = await import("../src/lib/tarifa/laudo");
    const f = faturaUsina(verde, base);
    const dados = {
      geradoEm: new Date("2026-11-05T15:00:00-03:00"),
      distribuidora: "CEMIG-D",
      uf: "MG",
      subgrupo: "A4",
      reh: "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.589, DE 26 DE MAIO DE 2026",
      vigencia: { inicio: "2026-05-28", fim: "2027-05-27" },
      geracaoAneel: "2026-11-05",
      bandeira: "Verde (+R$ 0,00/MWh)",
      tarifa: verde,
      entrada: base,
      fatura: f,
      conferencia: conferirUsina(f, { dem_unica: 8000 }, 30000),
      origemTributos: "ICMS 18% (referência MG) · PIS 1,05% · Cofins 4,84%",
    };
    const bytes = new Uint8Array(montarLaudoUsina(jsPDF, dados).output("arraybuffer"));
    if (process.env.LAUDO_USINA_OUT) (await import("node:fs")).writeFileSync(process.env.LAUDO_USINA_OUT, bytes.slice());
    const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    for (const s of ["FATURA DA USINA", "CEMIG-D", "TUSDg", "60% Fio B", "COMPENSAÇÃO DE ENERGIA", "CONFERÊNCIA COM A FATURA REAL", "DIVERGENTE", "Assinatura"]) expect(text).toContain(s);
    expect(nomeArquivoUsina(dados)).toBe("laudo-usina-CEMIG-D-A4-2026-11-05.pdf");
  });
});
