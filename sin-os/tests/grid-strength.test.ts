import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GridSnapshotSchema } from "@/lib/grid/snapshot";
import {
  borderNote,
  busRows,
  chipLabels,
  classify,
  ikA,
  isBorder,
  maxPlantMw,
  parseMw,
  scr,
  scrComposite,
  searchBuses,
  weakest,
  type BusStrength,
  type ShortCircuit,
} from "@/lib/grid/strength";
import { sci } from "@/lib/fmt";

// curto-circuito de verdade (worker da rede, 29/10/2026) em 23 barras
const CURTO = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/curto-amostra.json"), "utf8")) as ShortCircuit;
const rows = busRows(CURTO);
const names = (q: string) => searchBuses(rows, q).items.map((b) => b.nome);
const bus = (anarede: number) => rows.find((b) => b.anarede === anarede)!;

describe("força da rede (curto-circuito e SCR)", () => {
  it("linhas da tabela, com os campos novos e os antigos", () => {
    expect(rows.length).toBe(CURTO.barras.length);
    const [a, nome, kv, , , , , skMin, hMin, skMax, hMax] = CURTO.barras[0];
    expect(rows[0]).toMatchObject({ anarede: a, nome, kv, skMin, hMin, skMax, hMax });
    for (const b of rows) {
      expect(b.skMax).toBeGreaterThanOrEqual(b.skMin);
      expect(b.skMinAll).toBeGreaterThanOrEqual(b.skMin);
      expect(b.ibrMw).toBeGreaterThanOrEqual(0);
    }
    // relatório anterior (11 campos por barra): sem eólica/solar e com o mínimo igual ao de todos os compensadores
    const old = busRows({ ...CURTO, barras: CURTO.barras.map((r) => r.slice(0, 11) as typeof r) });
    expect(old[0].ibrMw).toBe(0);
    expect(old[0].skMinAll).toBe(old[0].skMin);
  });

  it("busca: sem acento, abreviações do ONS, tensão, número de barra e romanos", () => {
    expect(names("ibiúna")[0]).toBe("IBIUNA");
    expect(names("SE Ibiúna")[0]).toBe("IBIUNA");
    expect(searchBuses(rows, "Ibiúna 345 kV").items.map((b) => b.anarede)).toEqual([86]);
    expect(names("paulino  neves")[0]).toBe("PAULINO NEVES");
    expect(searchBuses(rows, "barra 5695").items.map((b) => b.anarede)).toEqual([5695]);
    expect(searchBuses(rows, "5695").items[0].anarede).toBe(5695);
    expect(names("Paulo Afonso")).toEqual(expect.arrayContaining(["P. AFONSO IV_SE", "P.AFONSO III"]));
    expect(names("Paulo Afonso 3")).toEqual(["P.AFONSO III"]);
    expect(names("Paulo Afonso IV")).not.toContain("P.AFONSO III");
    expect(names("Serra da Mesa")).toEqual(["S.DA MESA"]);
    expect(names("Foz do Iguaçu")).toEqual(["F.IGUACUNORTE"]);
    expect(names("Ribeirão Preto")).toEqual(["RIBEIRAOPRETO"]);
    expect(names("Mossoró 2")).toEqual(["MOSSORO II"]);
    expect(names("Açu")[0]).toBe("ACU III");
    // a inicial sozinha não casa; busca vazia não lista nada
    expect(names("Paulo")).toEqual([]);
    expect(searchBuses(rows, "")).toEqual({ items: [], total: 0 });
    expect(searchBuses(rows, "  kV ")).toEqual({ items: [], total: 0 });
    // total separado do que cabe na tela
    const few = searchBuses(rows, "Afonso", 2);
    expect(few.items.length).toBe(2);
    expect(few.total).toBeGreaterThan(2);
  });

  it("chips de mesmo nome e tensão ganham o número da barra", () => {
    const pa = searchBuses(rows, "Paulo Afonso IV 230").items;
    const labels = chipLabels(pa, (b: BusStrength) => `${b.nome} ${b.kv} kV`);
    expect(labels).toEqual(expect.arrayContaining(["P. AFONSO IV_SE 230 kV · barra 44098", "P. AFONSO IV_SE 230 kV · barra 44099"]));
    expect(chipLabels([bus(86)], (b) => b.nome)).toEqual(["IBIUNA"]);
  });

  it("fronteira por país: Uruguai por conversora (vale como está), Venezuela em CA", () => {
    const melo = bus(9787);
    const elena = bus(95457);
    expect(isBorder(melo) && isBorder(elena)).toBe(true);
    expect(isBorder(bus(6990))).toBe(false); // Cruzeiro do Sul (AC, subsistema SE)
    expect(isBorder({ ...melo, sub: null })).toBe(false); // sem subsistema não é fronteira
    expect(borderNote(CURTO, melo)).toMatch(/Uruguai.*vale como está/);
    expect(borderNote(CURTO, elena)).toMatch(/Venezuela.*corrente alternada/);
    expect(borderNote(CURTO, bus(86))).toBeNull();
    expect(weakest(rows, 230).some((b) => isBorder(b))).toBe(false);
    const w = weakest(rows, 230);
    for (let i = 1; i < w.length; i++) expect(w[i].skMin).toBeGreaterThanOrEqual(w[i - 1].skMin);
  });

  it("SCR simples e composto, classe, maior parque e corrente de curto", () => {
    expect(scr(3000, 1000)).toBe(3);
    expect(classify(3)).toBe("forte");
    expect(classify(2.99)).toBe("fraca");
    expect(classify(2)).toBe("fraca");
    expect(classify(1.99)).toBe("muito fraca");
    expect(maxPlantMw(3000)).toBe(1000);
    expect(maxPlantMw(3000, 400)).toBe(600);
    expect(maxPlantMw(3000, 5000)).toBe(0);
    expect(maxPlantMw(3000, 0, 2)).toBe(1500);
    expect(ikA(Math.sqrt(3) * 500 * 10, 500)).toBeCloseTo(10, 9); // 10 kA em 500 kV
    expect(scr(1000, 0)).toBe(Infinity);
    // Paulino Neves 500 kV, sem eólica/solar na subestação: 500 MW dá rede forte
    const pn = bus(5695);
    expect(pn.ibrMw).toBe(0);
    expect(classify(scrComposite(pn.skMin, 500, pn.ibrMw))).toBe("forte");
    expect(Math.round(maxPlantMw(pn.skMin, pn.ibrMw))).toBe(Math.round(pn.skMin / 3));
    // Açu III 500 kV: barra forte para um parque sozinho, mas a subestação já tem 3,6 GW eólicos
    const acu = bus(5350);
    expect(acu.ibrMw).toBeGreaterThan(3000);
    expect(classify(scr(acu.skMin, 100))).toBe("forte");
    expect(classify(scrComposite(acu.skMin, 100, acu.ibrMw))).toBe("muito fraca");
    expect(maxPlantMw(acu.skMin, acu.ibrMw)).toBe(0);
    // Tapajós II 230 kV: o mínimo tira o único compensador; com ele, o curto mais que dobra
    const tp = bus(6551);
    expect(tp.skMinAll / tp.skMin).toBeGreaterThan(2);
  });

  it("potência digitada: milhar com ponto, vírgula decimal, sufixo MW e lixo", () => {
    expect(parseMw("100")).toBe(100);
    expect(parseMw("1.000")).toBe(1000);
    expect(parseMw("2.500,5")).toBe(2500.5);
    expect(parseMw("1,5")).toBe(1.5);
    expect(parseMw("1.5")).toBe(1.5);
    expect(parseMw(" 300 MW ")).toBe(300);
    expect(parseMw(250)).toBe(250);
    for (const bad of ["", "0", "-5", "abc", "1e3", "100000", "12,3,4"]) expect(parseMw(bad)).toBeNull();
    expect(parseMw(Number.NaN)).toBeNull();
    expect(parseMw(null)).toBeNull();
  });

  it("notação científica com vírgula", () => {
    expect(sci(1.9546e-13)).toBe("2,0·10⁻¹³");
    expect(sci(1e-6, 0)).toBe("1·10⁻⁶");
    expect(sci(0)).toBe("0");
    expect(sci(null)).toBe("—");
    expect(sci(9.96e-7)).toBe("1,0·10⁻⁶");
  });

  it("esquema aceita o curto (novo e antigo) e recusa valor fora de faixa ou barra repetida", () => {
    const sec = GridSnapshotSchema.shape.curto;
    expect(sec.safeParse(CURTO).success).toBe(true);
    expect(sec.safeParse(undefined).success).toBe(true); // retratos antigos
    const old = { ...structuredClone(CURTO), barras: CURTO.barras.map((r) => r.slice(0, 11)) };
    delete (old as Partial<ShortCircuit>).fronteira;
    expect(sec.safeParse(old).success).toBe(true);
    const extra = structuredClone(CURTO);
    (extra.barras[0] as unknown[]).push(1, "campo futuro");
    expect(sec.safeParse(extra).success).toBe(true); // campo novo no fim não reprova
    const bad = structuredClone(CURTO);
    bad.barras[0][8] = 24; // hora inexistente
    expect(sec.safeParse(bad).success).toBe(false);
    const neg = structuredClone(CURTO);
    neg.barras[0][7] = -5;
    expect(sec.safeParse(neg).success).toBe(false);
    const dup = structuredClone(CURTO);
    dup.barras.push(structuredClone(dup.barras[0]));
    expect(sec.safeParse(dup).success).toBe(false);
  });
});
