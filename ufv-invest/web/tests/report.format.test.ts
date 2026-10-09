import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { niceScale } from "@/lib/report/charts";
import {
  compactDate,
  displayUrl,
  fmtBRL,
  fmtBRLCompact,
  fmtDate,
  fmtDateTime,
  fmtDMS,
  fmtMultiple,
  fmtNum,
  fmtPct,
  fmtPctSigned,
  fmtPp,
  fmtYears,
  groupHex,
  shortHash,
  truncateMiddle,
} from "@/lib/report/format";
import { cdiNetPct, fioBRuleText, statusSummary, verdictItems } from "@/lib/report/insights";
import { Layout, protectSpaces } from "@/lib/report/layout";
import { analysisFixture, buildAnalysisFixture } from "./fixtures/analysis.fixture";

describe("formatação pt-BR", () => {
  it("números", () => {
    expect(fmtNum(1234567.891, 2)).toBe("1.234.567,89");
    expect(fmtNum(1234.5)).toBe("1.235");
    expect(fmtNum(999.999, 2)).toBe("1.000,00");
    expect(fmtNum(-0.0001, 1)).toBe("0,0");
    expect(fmtNum(-1500)).toBe("-1.500");
    expect(fmtNum(0.5, 1)).toBe("0,5");
    expect(fmtNum(NaN)).toBe("—");
    expect(fmtNum(undefined)).toBe("—");
    expect(fmtNum(Infinity, 2)).toBe("—");
  });

  it("moeda", () => {
    expect(fmtBRL(1234.56)).toBe("R$ 1.234,56");
    expect(fmtBRL(-1234.56)).toBe("-R$ 1.234,56");
    expect(fmtBRL(0)).toBe("R$ 0,00");
    expect(fmtBRL(100, 0)).toBe("R$ 100");
    expect(fmtBRL(null)).toBe("—");
    expect(fmtBRLCompact(13_000_000)).toBe("R$ 13,0 mi");
    expect(fmtBRLCompact(6_146_755)).toBe("R$ 6,15 mi");
    expect(fmtBRLCompact(-3_456_789)).toBe("-R$ 3,46 mi");
    expect(fmtBRLCompact(850_000)).toBe("R$ 850 mil");
    expect(fmtBRLCompact(1_250_000_000)).toBe("R$ 1,25 bi");
    expect(fmtBRLCompact(950)).toBe("R$ 950");
    expect(fmtBRLCompact(12.5)).toBe("R$ 12,50");
  });

  it("percentuais e múltiplos", () => {
    expect(fmtPct(12.34)).toBe("12,3 %");
    expect(fmtPct(12.35, 2)).toBe("12,35 %");
    expect(fmtPct(-0.04)).toBe("0,0 %");
    expect(fmtPctSigned(1.25)).toBe("+1,3 %");
    expect(fmtPctSigned(-7.94)).toBe("-7,9 %");
    expect(fmtPctSigned(0)).toBe("0,0 %");
    expect(fmtPp(3.21)).toBe("+3,2 p.p.");
    expect(fmtPp(-0.5)).toBe("-0,5 p.p.");
    expect(fmtMultiple(5.624)).toBe("5,62x");
    expect(fmtYears(6.14)).toBe("6,1 anos");
    expect(fmtYears(1)).toBe("1,0 ano");
    expect(fmtYears(null)).toBe("não atingido");
  });

  it("datas no horário de Brasília", () => {
    expect(fmtDate("2026-10-04T13:15:00Z")).toBe("04/10/2026");
    expect(fmtDate("2026-10-04T01:15:00Z")).toBe("03/10/2026");
    expect(fmtDate("2027-03-01")).toBe("01/03/2027");
    expect(fmtDate(new Date(Date.UTC(2026, 0, 5, 12)))).toBe("05/01/2026");
    expect(fmtDateTime("2026-10-04T13:15:00Z")).toBe("04/10/2026 10:15");
    expect(fmtDateTime("2026-10-04T13:15:00Z", true)).toBe("04/10/2026 10:15 (BRT)");
    expect(fmtDateTime(1_791_120_000_000)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(fmtDate("não é data")).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(compactDate(new Date("2026-10-04T13:15:00Z"))).toBe("20261004");
  });

  it("coordenadas e textos", () => {
    expect(fmtDMS(-15.835, "lat")).toBe(`15°50'06,0" S`);
    expect(fmtDMS(-43.278, "lon")).toBe(`43°16'40,8" O`);
    expect(fmtDMS(9.5, "lat")).toBe(`9°30'00,0" N`);
    expect(fmtDMS(10.9999999, "lon")).toBe(`11°00'00,0" L`);
    expect(truncateMiddle("0x1234567890abcdef", 9)).toBe("0x12…cdef");
    expect(truncateMiddle("curto", 10)).toBe("curto");
    expect(shortHash("a".repeat(8) + "b".repeat(52) + "cdef")).toBe("aaaaaaaa…cdef");
    expect(groupHex("0x" + "ab".repeat(32))).toHaveLength(8);
    expect(displayUrl("https://www.exemplo.com.br/a/")).toBe("exemplo.com.br/a");
  });

  it("escala de eixo", () => {
    const s = niceScale(0, 6.4, 5);
    expect(s.min).toBe(0);
    expect(s.max).toBeGreaterThanOrEqual(6.4);
    expect(s.ticks[0]).toBe(0);
    const n = niceScale(-13, 61, 7);
    expect(n.ticks).toContain(0);
    expect(n.min).toBeLessThanOrEqual(-13);
  });
});

describe("leituras derivadas", () => {
  it("parecer resumido cita TIR, CDI e probabilidade", () => {
    const items = verdictItems(analysisFixture, analysisFixture.provenance).map((runs) => runs.map((r) => r.text).join(""));
    expect(items[0]).toContain("supera o CDI líquido");
    expect(items[0]).toContain("probabilidade de TIR abaixo do CDI");
    expect(items.join(" ")).toContain("PVGIS");
    expect(cdiNetPct(analysisFixture)).toBeCloseTo(analysisFixture.market.cdiPct * 0.85, 6);
    expect(statusSummary(analysisFixture.provenance)).toMatch(/ao vivo.*fallback.*erro/);
  });

  it("regra do Fio B conforme o ano de acesso", () => {
    expect(fioBRuleText(analysisFixture)).toContain("Cobrança gradual");
    expect(fioBRuleText(buildAnalysisFixture("ufv-petrolina-1"))).toContain("2045");
  });
});

describe("motor de layout", () => {
  it("quebra de linha nunca excede a largura e mantém valores unidos", async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const dir = path.join(process.cwd(), "src/lib/report/fonts");
    const load = async (f: string) => pdf.embedFont(await readFile(path.join(dir, f)), { subset: true });
    const fonts = {
      regular: await load("Geist-Regular.ttf"),
      semibold: await load("Geist-SemiBold.ttf"),
      bold: await load("Geist-Bold.ttf"),
      mono: await load("GeistMono-Regular.ttf"),
    };
    const l = new Layout(pdf, fonts);
    const text =
      "A TIR nominal de 17,6 % a.a. supera o CDI; VPL de R$ 6,15 mi e geração de 5.702 MWh/ano. " +
      "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,T2M&latitude=-15.8350";
    for (const width of [60, 90, 140, 260, 515]) {
      const lines = l.wrap(text, "regular", 9, width);
      for (const ln of lines) expect(l.measure(ln, "regular", 9)).toBeLessThanOrEqual(width + 0.01);
      if (width >= 90) {
        expect(lines.some((ln) => ln.includes("17,6 %"))).toBe(true);
        expect(lines.some((ln) => ln.includes("R$ 6,15"))).toBe(true);
      }
    }
    expect(protectSpaces("R$ 1.234 e 12,3 %")).toBe("R$\u00a01.234 e 12,3\u00a0%");
    // caracteres sem glifo são substituídos, sem lançar
    expect(l.clean("σ ✓ ok", "regular")).toBe("dp v ok");
    const fitted = l.fit("texto muito longo que não cabe", "regular", 9, 50);
    expect(fitted.endsWith("…")).toBe(true);
    expect(l.measure(fitted, "regular", 9)).toBeLessThanOrEqual(50);
  });
});
