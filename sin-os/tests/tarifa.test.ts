import { describe, expect, it } from "vitest";
import fixture from "./fixtures/aneel-componentes-copel-b1.json";
import { decompor, efetiva, num, simularReforma, PREMISSAS_PADRAO } from "../src/lib/tarifa/calc";
import { executeTarifaTool, resolverAgente, type TarifaDeps } from "../src/lib/assistant/tarifa-tools";
import { routeDomains } from "../src/lib/assistant/harness";

describe("componentes da tarifa (COPEL B1, dados reais da ANEEL)", () => {
  const d = decompor(fixture as { DscComponenteTarifario: string; VlrComponenteTarifario: string }[]);
  it("lê TE e TUSD publicadas", () => {
    expect(d.tusd).toBeCloseTo(457.17, 2);
    expect(d.te).toBeCloseTo(310.85, 2);
  });
  it("a soma dos componentes fecha com TE + TUSD", () => {
    expect(Math.abs(d.residuo ?? 99)).toBeLessThan(0.05);
  });
  it("agrupa energia, Fio B e encargos com participação coerente", () => {
    const g = Object.fromEntries(d.grupos.map((x) => [x.grupo, x]));
    expect(g["Energia"].te).toBeGreaterThan(150);
    expect(g["Fio B (distribuição)"].tusd).toBeGreaterThan(100);
    expect(g["Encargos setoriais"].total).toBeGreaterThan(0);
    expect(d.grupos.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 0);
  });
  it("número com vírgula decimal", () => {
    expect(num("457,17")).toBe(457.17);
    expect(num(",00")).toBe(0);
  });
});

describe("tarifa efetiva", () => {
  it("tributos por dentro: base ÷ (1 − ICMS − PIS − Cofins)", () => {
    const e = efetiva(300, 450, 0, { icms: 0.18, pis: 0.0105, cofins: 0.0484 });
    expect(e.semTributosKwh).toBe(0.75);
    expect(e.comTributosKwh).toBeCloseTo(0.75 / (1 - 0.2389), 4);
    expect(e.icmsKwh + e.pisKwh + e.cofinsKwh + e.semTributosKwh).toBeCloseTo(e.comTributosKwh, 3);
  });
  it("bandeira entra na base", () => {
    expect(efetiva(300, 450, 44.63, { icms: 0, pis: 0, cofins: 0 }).semTributosKwh).toBeCloseTo(0.79463, 4);
  });
});

describe("reforma tributária (CBS/IBS)", () => {
  const anos = simularReforma(750, PREMISSAS_PADRAO);
  const a = (n: number) => anos.find((x) => x.ano === n)!;
  it("2026 é teste: sem custo novo, só destaque", () => {
    expect(a(2026).cbsKwh).toBe(0);
    expect(a(2026).ibsKwh).toBe(0);
    expect(a(2026).destaqueTesteKwh).toBeCloseTo(0.75 * 0.01, 4);
    expect(a(2026).pisCofinsKwh).toBeGreaterThan(0);
  });
  it("2027: PIS/Cofins somem e entra a CBS", () => {
    expect(a(2027).pisCofinsKwh).toBe(0);
    expect(a(2027).cbsKwh).toBeCloseTo(0.75 * 0.087, 4);
    expect(a(2027).ibsKwh).toBeCloseTo(0.75 * 0.001, 3);
  });
  it("ICMS cai 10 p.p. por ano de 2029 a 2032 e some em 2033", () => {
    expect(a(2029).icmsKwh).toBeLessThan(a(2028).icmsKwh);
    expect(a(2033).icmsKwh).toBe(0);
    expect(a(2033).ibsKwh).toBeCloseTo(0.75 * 0.177, 4);
  });
  it("empresa no regime regular só arca com o ICMS remanescente", () => {
    expect(a(2033).liquidoEmpresaKwh).toBeCloseTo(0.75, 4);
    expect(a(2029).liquidoEmpresaKwh).toBeCloseTo(a(2029).semTributosKwh + a(2029).icmsKwh, 4);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- leitura livre do JSON da ferramenta
type Obj = Record<string, any>;

const deps: TarifaDeps = {
  agentes: async () => ["CEMIG-D", "COPEL-DIS", "CPFL-PAULISTA", "ELETROPAULO"],
  vigente: async (agente, subgrupo) => ({
    agente,
    subgrupo,
    reh: "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.592",
    inicio: "2026-06-24",
    fim: "2027-06-23",
    proxima: null,
    geracaoAneel: "2026-11-05",
    geradoEm: 0,
    linhas: [{ modalidade: "Convencional", classe: "Residencial", subclasse: "Residencial", detalhe: "Não se aplica", posto: "Não se aplica", unidade: "MWh", tusd: 457.17, te: 310.85 }],
  }),
  componentes: async () => fixture as never,
  bandeira: async () => ({ competencia: "2026-10", nome: "Verde", adicionalMwh: 0, tabela: [] }),
  uf: async () => ({ "COPEL-DIS": "PR", "CEMIG-D": "MG" }),
};

describe("ferramentas da Iara", () => {
  it("acha a distribuidora pelo apelido", async () => {
    expect(await resolverAgente("Copel", await deps.agentes())).toBe("COPEL-DIS");
    expect(await resolverAgente("enel sp", await deps.agentes())).toBe("ELETROPAULO");
    expect(await resolverAgente("cpfl paulista", await deps.agentes())).toBe("CPFL-PAULISTA");
  });
  it("tarifa_vigente devolve REH, componentes e tarifa efetiva", async () => {
    const r = (await executeTarifaTool("tarifa_vigente", { distribuidora: "copel" }, deps)) as Obj;
    expect(r.distribuidora).toBe("COPEL-DIS");
    expect(r.componentes.fecha_com_tarifa).toBe(true);
    expect(r.tarifa_efetiva.premissas.icms_pct).toBeCloseTo(19.5, 2); // UF da distribuidora, sem informar
    expect(r.tarifa_efetiva.premissas.icms_fonte).toContain("PR");
    expect(r.tarifa_efetiva.com_tributos_kwh).toBeGreaterThan(r.tarifa_efetiva.sem_tributos_kwh);
  });
  it("reforma_tributaria funciona sem rede quando recebe a tarifa", async () => {
    const r = (await executeTarifaTool("reforma_tributaria", { tarifa_mwh: 750, cbs_ref: 8.8 })) as Obj;
    expect(r.anos).toHaveLength(8);
    expect(r.premissas.cbs_ref_pct).toBe(8.8);
  });
  it("sem dependências, tarifa_vigente avisa indisponível", async () => {
    expect(await executeTarifaTool("tarifa_vigente", { distribuidora: "x" })).toMatchObject({ erro: expect.any(String) });
  });
  it("perguntas de tarifa e CBS/IBS abrem o domínio de tarifas", () => {
    expect(routeDomains(["a cbs e o ibs incidem na tarifa de energia?"])).toContain("tarifas");
    expect(routeDomains(["qual a tusd da cemig"])).toContain("tarifas");
    expect(routeDomains(["oi"], "/tarifas")).toContain("tarifas");
  });
});
