import { createHash } from "node:crypto";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { plants } from "@/data/plants";
import { ATTACHMENT_NAME, parseReportVariant, renderAuditReport } from "@/lib/report";
import { buildInvestmentComparison, findBenchmark, rateHeadline, topDrivers } from "@/lib/report/investor";
import type { OnChainState, PlantAnalysis } from "@/lib/types";
import { analysisFixture, analysisFixturesBySlug, onChainFixture } from "./fixtures/analysis.fixture";

const NOW = new Date("2026-10-06T13:30:00Z");

async function renderResumo(a: PlantAnalysis, onChain: OnChainState | null = null) {
  const bytes = await renderAuditReport(a, { siteUrl: "https://ufv-invest.example", onChain, now: NOW });
  return { bytes, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
}

/** Anexos do PDF: nome → bytes */
function attachments(doc: PDFDocument): Map<string, Uint8Array> {
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const arr = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)?.lookupMaybe(PDFName.of("Names"), PDFArray);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; arr && i < arr.size(); i += 2) {
    const n = arr.lookup(i) as unknown as { decodeText?: () => string };
    const stream = arr.lookup(i + 1, PDFDict).lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
    if (stream instanceof PDFRawStream) out.set(n.decodeText ? n.decodeText() : String(n), decodePDFRawStream(stream).decode());
  }
  return out;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("renderAuditReport — resumo (padrão)", () => {
  it("é o padrão: até 4 páginas, anexo, hash e metadados", async () => {
    const { bytes, doc } = await renderResumo(analysisFixture, onChainFixture);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getPageCount()).toBeLessThanOrEqual(4);
    expect(doc.getTitle()).toBe("Relatório de Auditoria — UFV Janaúba I");
    expect(doc.getAuthor()).toBe("UFV Invest");
    expect(doc.getSubject()).toContain("resumo para o investidor");
    expect(doc.getKeywords()).toContain(analysisFixture.dataHash);
    expect(doc.getKeywords()).toContain("versao:resumo");
    expect(doc.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    const json = attachments(doc).get(ATTACHMENT_NAME);
    expect(json).toBeDefined();
    expect(sha256(json!)).toBe(analysisFixture.dataHash);
    expect(bytes.length).toBeLessThan(800_000);
  });

  it("é bem menor que a versão completa", async () => {
    const full = await renderAuditReport(analysisFixture, { siteUrl: "https://x.example", now: NOW, variant: "completo" });
    const fullDoc = await PDFDocument.load(full, { updateMetadata: false });
    const { doc } = await renderResumo(analysisFixture);
    expect(fullDoc.getPageCount()).toBeGreaterThan(doc.getPageCount());
    expect(fullDoc.getKeywords()).toContain("versao:completo");
    // o anexo verificável é o mesmo nas duas versões
    expect(sha256(attachments(fullDoc).get(ATTACHMENT_NAME)!)).toBe(sha256(attachments(doc).get(ATTACHMENT_NAME)!));
  });

  it.each(plants.map((p) => p.slug))("cabe em 4 páginas para %s, com e sem estado on-chain", async (slug) => {
    const a = analysisFixturesBySlug[slug];
    for (const oc of [null, onChainFixture]) {
      const { doc } = await renderResumo(a, oc);
      expect(doc.getPageCount()).toBeLessThanOrEqual(4);
      expect(doc.getTitle()).toBe(`Relatório de Auditoria — ${a.plant.name}`);
    }
  });

  it("tolera dados ausentes e cenário adverso sem passar de 4 páginas", async () => {
    const a = structuredClone(analysisFixture);
    a.pvgis = null;
    a.live = null;
    delete a.generation.crossCheck;
    a.finance.sensitivity = [];
    a.finance.benchmarks = [];
    a.finance.paybackYears = null;
    a.finance.irrNominalPct = 9.5;
    a.finance.npvBRL = -2_000_000;
    a.finance.monteCarlo = { ...a.finance.monteCarlo, probIrrBelowCdiPct: 87 };
    a.provenance = [];
    a.resource.provenance = [];
    a.location = { municipio: "Janaúba", uf: "MG", ibgeCode: 3135100, provenance: [] };
    a.market = { ...a.market, provenance: [] };
    a.plant = { ...a.plant, name: "UFV Usina Fotovoltaica com um Nome Extraordinariamente Longo de Teste", illustrative: false };
    const { doc } = await renderResumo(a, { ...onChainFixture, documents: [], offeringState: "failed" });
    expect(doc.getPageCount()).toBeLessThanOrEqual(4);
    expect(doc.getSubject()).not.toContain("Projeto ilustrativo");
  });

  it("parâmetro ?versao", () => {
    expect(parseReportVariant("completa")).toBe("completo");
    expect(parseReportVariant("COMPLETO")).toBe("completo");
    expect(parseReportVariant(null)).toBe("resumo");
    expect(parseReportVariant("resumo")).toBe("resumo");
    expect(parseReportVariant("qualquer")).toBe("resumo");
  });
});

describe("simulação do investidor (resumo)", () => {
  it.each(plants.map((p) => p.slug))("valores finais batem com finance.benchmarks × 10 (%s)", (slug) => {
    const a = analysisFixturesBySlug[slug];
    const c = buildInvestmentComparison(a, 10_000);
    expect(c.investedBRL).toBe(10_000);
    expect(c.cotas).toBe(10_000 / a.plant.token.cotaPriceBRL);
    expect(c.years).toBe(a.plant.finance.horizonYears);
    for (const s of c.series) {
      expect(s.values).toHaveLength(c.years + 1);
      expect(s.benchmarkFinalBRL).not.toBeNull();
      const b = findBenchmark(a.finance.benchmarks, s.key)!;
      expect(Math.abs(s.finalBRL - b.finalValueOf1000BRL * 10) / (b.finalValueOf1000BRL * 10)).toBeLessThan(0.01);
    }
    expect(c.series.find((s) => s.key === "usina")!.values[0]).toBe(0);
    expect(c.series.find((s) => s.key === "cdi")!.values[0]).toBe(10_000);
  });

  it("renda e payback proporcionais ao fluxo P50", () => {
    const a = analysisFixture;
    const c = buildInvestmentComparison(a, 10_000);
    const share = 10_000 / a.finance.investmentBRL;
    expect(c.firstYearIncomeBRL).toBeCloseTo(a.finance.cashFlows[1].netCashFlowBRL * share, 6);
    expect(c.totalIncomeBRL).toBeCloseTo(a.finance.perCota.totalIncomeBRL * c.cotas, 0);
    expect(c.avgMonthlyIncomeBRL).toBeCloseTo(a.finance.perCota.avgMonthlyIncomeBRL * c.cotas, 0);
    expect(c.paybackYears).toBeGreaterThan(4);
    expect(c.paybackYears).toBeLessThan(9);
    expect(c.calendarYears[0]).toBe(a.finance.cashFlows[0].calendarYear);
    // a renda reinvestida cruza o CDI direto em algum momento do horizonte
    expect(c.crossoverYear).not.toBeNull();
  });

  it("aporte que não divide o preço da cota usa cotas inteiras", () => {
    const c = buildInvestmentComparison(analysisFixture, 10_050);
    expect(c.cotas).toBe(100);
    expect(c.investedBRL).toBe(10_000);
  });

  it("manchete contra a Selic e o CDI líquido", () => {
    const h = rateHeadline(analysisFixture);
    expect(h.selicPct).toBe(analysisFixture.market.selicPct);
    expect(h.vsSelicPp).toBeCloseTo(analysisFixture.finance.irrNominalPct - analysisFixture.market.selicPct, 9);
    expect(h.vsCdiNetPp).toBeCloseTo(analysisFixture.finance.irrNominalPct - analysisFixture.market.cdiPct * 0.85, 9);
  });

  it("principais sensibilidades ordenadas por amplitude", () => {
    const top = topDrivers(analysisFixture.finance.sensitivity, 3);
    expect(top).toHaveLength(3);
    const amp = top.map((r) => Math.abs(r.irrHighPct - r.irrLowPct));
    expect(amp[0]).toBeGreaterThanOrEqual(amp[1]);
    expect(amp[1]).toBeGreaterThanOrEqual(amp[2]);
    expect(topDrivers([], 3)).toEqual([]);
  });
});
