import { describe, expect, it } from "vitest";
import { mergeOfficialDays, officialDaysFromPanel } from "../src/lib/market/pld-official";
import { parsePldRecords } from "../src/lib/sources/ccee";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type Sub, type SubPanel } from "../src/lib/sources/types";

const NAMES: Record<Sub, string> = { SE: "SUDESTE", S: "SUL", NE: "NORDESTE", N: "NORTE" };
// registros no formato do datastore_search do conjunto PLD_HORARIO
function records(days: number[], price: (d: number, h: number, s: Sub) => number, hours = 24) {
  const out: Record<string, unknown>[] = [];
  for (const d of days) for (let h = 0; h < hours; h++) for (const s of SUBS) out.push({ _id: out.length + 1, MES_REFERENCIA: "202609", SUBMERCADO: NAMES[s], DIA: d, HORA: h, PLD_HORA: price(d, h, s) });
  return out;
}
const NOW = brtToUtc(2026, 9, 27, 10, 0);

describe("coletor do PLD oficial", () => {
  it("parser dos registros da CCEE (MES_REFERENCIA + DIA + HORA)", () => {
    const { panel, quality } = parsePldRecords(records([25, 26], (d, h) => (h === 18 ? 263.43 : 100 + d)), 90);
    expect(panel.ts).toHaveLength(48);
    expect(panel.ts[18]).toBe(brtToUtc(2026, 9, 25, 18));
    expect(panel.values.SE[18]).toBe(263.43);
    expect(panel.values.N[30]).toBe(126);
    expect(quality.duplicates).toBe(0);
    expect(() => parsePldRecords([{ foo: 1 }])).toThrow(/schema inesperado/);
  });

  it("aceita só dias completos, dentro do piso/teto e até amanhã", () => {
    const { panel } = parsePldRecords(
      [...records([25], () => 90), ...records([26], (_d, h) => (h === 3 ? 5000 : 90)), ...records([27], () => 80, 12), ...records([29], () => 90)],
      90,
    );
    const { accepted, rejected } = officialDaysFromPanel(panel, NOW);
    expect(accepted.map((d) => d.date)).toEqual(["2026-09-25"]);
    expect(accepted[0].source).toBe("ccee");
    expect(rejected).toEqual([
      { date: "2026-09-26", motivo: "valor fora do piso/teto de 2026 (5000)" },
      { date: "2026-09-27", motivo: "dia incompleto" },
      { date: "2026-09-29", motivo: "data futura além de amanhã" },
    ]);
  });

  it("dias oficiais substituem a estimativa e podem trazer amanhã", () => {
    const est: SubPanel = { ts: [], values: { SE: [], S: [], NE: [], N: [] }, unit: "R$/MWh" };
    for (const d of [25, 26, 27]) for (let h = 0; h < 24; h++) {
      est.ts.push(brtToUtc(2026, 9, d, h));
      for (const s of SUBS) est.values[s].push(57.31);
    }
    const { panel } = parsePldRecords(records([26, 27, 28], (d) => 70 + d), 90);
    const { accepted } = officialDaysFromPanel(panel, NOW);
    const m = mergeOfficialDays(est, accepted);
    expect(m.days).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(m.coversLatest).toBe(true);
    expect(m.data.ts).toHaveLength(96);
    expect(m.data.values.SE[0]).toBe(57.31); // 25/09 continua estimado
    expect(m.data.values.SE[24]).toBe(96); // 26/09 oficial
    expect(m.data.values.SE[95]).toBe(98); // 28/09 (amanhã) oficial
    expect(mergeOfficialDays(est, accepted.slice(0, 1)).coversLatest).toBe(false);
  });
});

describe("coletor — modo CSV (plano B: arquivo baixado do portal)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = async () => (await import("../scripts/coletor-ccee.mjs")) as any;
  const enc = (s: string) => new TextEncoder().encode(s);

  it("lê o CSV do portal (separador ;, vírgula decimal) e o parser do servidor aceita", async () => {
    const { parseCsvRecords } = await lib();
    const rows = ["MES_REFERENCIA;SUBMERCADO;PERIODO_COMERCIALIZACAO;DIA;HORA;PLD_HORA"];
    for (const d of [25, 26]) for (let h = 0; h < 24; h++) for (const s of Object.values(NAMES)) rows.push(`202609;${s};1;${d};${h};${d === 26 && h === 18 ? "263,43" : "90,50"}`);
    const recs = parseCsvRecords(enc("﻿" + rows.join("\r\n") + "\r\n"));
    expect(recs).toHaveLength(192);
    expect(recs[0]).toMatchObject({ SUBMERCADO: "SUDESTE", DIA: "25", HORA: "0", PLD_HORA: "90,50" });
    const { panel } = parsePldRecords(recs, 90);
    expect(panel.ts).toHaveLength(48);
    expect(panel.values.SE[24 + 18]).toBe(263.43);
    const { accepted } = officialDaysFromPanel(panel, NOW);
    expect(accepted.map((d) => d.date)).toEqual(["2026-09-25", "2026-09-26"]);
  });

  it("separador vírgula, aspas e latin1; linhas com número de colunas errado são ignoradas", async () => {
    const { parseCsvRecords } = await lib();
    const csv = '"MES_REFERENCIA","SUBMERCADO","DIA","HORA","PLD_HORA"\n"202609","NORDESTE","25","3","57.31"\n"202609","quebrada"\n';
    const recs = parseCsvRecords(enc(csv));
    expect(recs).toEqual([{ MES_REFERENCIA: "202609", SUBMERCADO: "NORDESTE", DIA: "25", HORA: "3", PLD_HORA: "57.31" }]);
    expect(() => parseCsvRecords(enc("so_cabecalho"))).toThrow(/vazio/);
  });

  it("fica só com as linhas mais recentes (mês, dia e hora), independente da ordem do arquivo", async () => {
    const { newestRecords } = await lib();
    const mk = (mes: string, dia: number, hora: number) => ({ MES_REFERENCIA: mes, SUBMERCADO: "SUL", DIA: String(dia), HORA: String(hora), PLD_HORA: "60" });
    const all = [mk("202609", 30, 0), mk("202610", 1, 5), mk("202609", 9, 23), mk("202610", 1, 2), mk("202608", 31, 23)];
    const out = newestRecords(all, 3);
    expect(out.map((r: Record<string, string>) => `${r.MES_REFERENCIA}-${r.DIA}-${r.HORA}`)).toEqual(["202609-30-0", "202610-1-2", "202610-1-5"]);
  });
});
