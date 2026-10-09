import { createHash } from "node:crypto";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { plants } from "@/data/plants";
import { ATTACHMENT_NAME, canonicalAnalysisJson, defaultReportId, renderAuditReport, type ReportVariant } from "@/lib/report";
import { canonicalJson } from "@/lib/report/canonical";
import type { OnChainState, PlantAnalysis } from "@/lib/types";
import { analysisFixture, analysisFixturesBySlug, buildAnalysisFixture, onChainFixture } from "./fixtures/analysis.fixture";

const SITE = "https://ufv-invest.example";
const NOW = new Date("2026-10-04T13:30:00Z");

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const clone = <T>(v: T): T => structuredClone(v);

async function render(a: PlantAnalysis, onChain: OnChainState | null = null, variant: ReportVariant = "completo") {
  const bytes = await renderAuditReport(a, { siteUrl: SITE, onChain, now: NOW, variant });
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { bytes, doc };
}

/** Lê os anexos (EmbeddedFiles) do catálogo: nome → bytes decodificados */
function readAttachments(doc: PDFDocument): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const arr = ef?.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!arr) return out;
  for (let i = 0; i < arr.size(); i += 2) {
    const nameObj = arr.lookup(i);
    const name = nameObj instanceof PDFString || nameObj instanceof PDFHexString ? nameObj.decodeText() : String(nameObj);
    const spec = arr.lookup(i + 1, PDFDict);
    const stream = spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
    if (stream instanceof PDFRawStream) out.set(name, decodePDFRawStream(stream).decode());
  }
  return out;
}

describe("fixture de análise", () => {
  it("é internamente consistente", () => {
    const a = analysisFixture;
    const g = a.generation;
    const f = a.finance;
    expect(a.plant.slug).toBe("ufv-janauba-1");
    expect(g.monthly).toHaveLength(12);
    expect(a.resource.monthly.ghiKWhM2Day).toHaveLength(12);
    const sumMonthly = g.monthly.reduce((s, m) => s + m.energyMWh, 0);
    expect(Math.abs(sumMonthly - g.annualP50MWh)).toBeLessThan(2);
    expect(g.annualP50MWh).toBeGreaterThan(5300);
    expect(g.annualP50MWh).toBeLessThan(6000);
    expect(g.p90MWh).toBeLessThan(g.p75MWh);
    expect(g.p75MWh).toBeLessThan(g.annualP50MWh);
    expect(g.p99MWh).toBeLessThan(g.p90MWh);
    expect(g.performanceRatioPct).toBeGreaterThan(76);
    expect(g.performanceRatioPct).toBeLessThan(84);
    expect(g.lossWaterfall.at(-1)!.energyMWhAfter).toBeCloseTo(g.annualP50MWh, 0);
    expect(f.cashFlows).toHaveLength(26);
    expect(f.cashFlows[0].netCashFlowBRL).toBe(-13_000_000);
    expect(f.investmentBRL).toBe(a.plant.token.totalCotas * a.plant.token.cotaPriceBRL);
    const inv = f.cashFlows.find((c) => c.year === a.plant.finance.inverterReplacementYear)!;
    const prev = f.cashFlows.find((c) => c.year === a.plant.finance.inverterReplacementYear - 1)!;
    expect(inv.capexBRL).toBeGreaterThan(0);
    expect(inv.netCashFlowBRL).toBeLessThan(prev.netCashFlowBRL);
    for (let i = 1; i < f.cashFlows.length; i++) {
      expect(Math.abs(f.cashFlows[i].cumulativeBRL - (f.cashFlows[i - 1].cumulativeBRL + f.cashFlows[i].netCashFlowBRL))).toBeLessThanOrEqual(2);
    }
    expect(f.irrNominalPct).toBeGreaterThan(15);
    expect(f.irrNominalPct).toBeLessThan(19.5);
    expect(f.paybackYears).toBeGreaterThan(5);
    expect(f.paybackYears).toBeLessThan(7.5);
    expect(f.npvBRL).toBeGreaterThan(0);
    expect(f.monteCarlo.irrP10Pct).toBeLessThan(f.monteCarlo.irrP50Pct);
    expect(f.monteCarlo.irrP50Pct).toBeLessThan(f.monteCarlo.irrP90Pct);
    expect(f.monteCarlo.histogram.reduce((s, b) => s + b.count, 0)).toBe(f.monteCarlo.runs);
    expect(f.sensitivity.length).toBeGreaterThanOrEqual(6);
    expect(f.benchmarks.length).toBeGreaterThanOrEqual(4);
    const statuses = new Set(a.provenance.map((p) => p.status));
    expect(statuses.has("live") && statuses.has("fallback")).toBe(true);
    expect(a.live?.forecast.length).toBeGreaterThan(0);
    expect(a.dataHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dataHash = sha256(canonicalAnalysisJson(analysis))", () => {
    expect(sha256(canonicalAnalysisJson(analysisFixture))).toBe(analysisFixture.dataHash);
    for (const a of Object.values(analysisFixturesBySlug)) expect(sha256(canonicalAnalysisJson(a))).toBe(a.dataHash);
  });
});

describe("canonicalAnalysisJson", () => {
  function reverseKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(reverseKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as object)
          .reverse()
          .map((k) => [k, reverseKeys((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  }

  it("independe da ordem das chaves", () => {
    const reordered = reverseKeys(analysisFixture) as PlantAnalysis;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(analysisFixture)[0]);
    expect(canonicalAnalysisJson(reordered)).toBe(canonicalAnalysisJson(analysisFixture));
  });

  it("exclui live, generatedAt e dataHash; muda quando um dado estável muda", () => {
    const base = canonicalAnalysisJson(analysisFixture);
    const a = clone(analysisFixture);
    a.generatedAt = "2030-01-01T00:00:00Z";
    a.dataHash = "0".repeat(64);
    a.live = null;
    expect(canonicalAnalysisJson(a)).toBe(base);
    expect(base).not.toMatch(/"live":/);
    expect(base).not.toMatch(/"generatedAt":/);
    expect(base).not.toMatch(/"dataHash":/);
    a.finance.irrNominalPct += 0.01;
    expect(canonicalAnalysisJson(a)).not.toBe(base);
  });

  it("é JSON compacto e válido, com chaves ordenadas", () => {
    const json = canonicalAnalysisJson(analysisFixture);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toMatch(/":\s|,\s"/);
    expect(canonicalJson({ b: 1, a: [3, { d: undefined, c: "x" }], e: NaN })).toBe('{"a":[3,{"c":"x"}],"b":1,"e":null}');
    expect(canonicalJson({ big: BigInt(10) })).toBe('{"big":"10"}');
  });
});

describe("renderAuditReport — versão completa", () => {
  it("gera o PDF completo com metadados, anexo verificável e tamanho contido", async () => {
    const { bytes, doc } = await render(analysisFixture, onChainFixture);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    expect(doc.getPageCount()).toBeLessThanOrEqual(11);
    for (const p of doc.getPages()) {
      expect(Math.round(p.getWidth())).toBe(595);
      expect(Math.round(p.getHeight())).toBe(842);
    }
    expect(doc.getTitle()).toBe("Relatório de Auditoria — Usina Janaúba I");
    expect(doc.getAuthor()).toBe("Aferi Capital");
    expect(doc.getSubject()).toContain("Usina Janaúba I");
    expect(doc.getSubject()).toContain("Projeto ilustrativo");
    expect(doc.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    expect(doc.getKeywords()).toContain(analysisFixture.dataHash);
    expect(doc.getKeywords()).toContain(defaultReportId(analysisFixture, NOW));

    const files = readAttachments(doc);
    const json = files.get(ATTACHMENT_NAME);
    expect(json).toBeDefined();
    expect(sha256(json!)).toBe(analysisFixture.dataHash);
    expect(new TextDecoder().decode(json!)).toBe(canonicalAnalysisJson(analysisFixture));

    expect(bytes.length).toBeLessThan(1_500_000);
  });

  it("usa reportId informado e inclui links clicáveis (QR/BscScan)", async () => {
    const bytes = await renderAuditReport(analysisFixture, { siteUrl: `${SITE}/`, onChain: onChainFixture, reportId: "RA-TESTE-001", now: NOW, variant: "completo" });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getKeywords()).toContain("RA-TESTE-001");
    const uris: string[] = [];
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookup(i, PDFDict);
        const action = a.lookupMaybe(PDFName.of("A"), PDFDict);
        const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString);
        if (uri) uris.push(uri.decodeText());
      }
    }
    expect(uris).toContain(`${SITE}/usinas/ufv-janauba-1`);
    expect(uris).toContain(`https://testnet.bscscan.com/address/${onChainFixture.tokenAddress}`);
    expect(uris.some((u) => u.endsWith("/verificar"))).toBe(true);
  });

  it("renderiza sem estado on-chain e com oferta em outros estados", async () => {
    const { doc } = await render(analysisFixture, null);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    const failed: OnChainState = { ...onChainFixture, chainId: 56, offeringState: "failed", documents: [], cotasSold: BigInt(0), raisedUSDT: BigInt(0) };
    const r2 = await render(analysisFixture, failed);
    expect(r2.doc.getPageCount()).toBeGreaterThanOrEqual(6);
    // supply com 18 casas decimais (tolerado)
    const wei = BigInt(10) ** BigInt(18);
    const r3 = await render(analysisFixture, { ...onChainFixture, totalSupply: BigInt(48250) * wei, maxSupply: BigInt(130000) * wei });
    expect(r3.doc.getPageCount()).toBeGreaterThanOrEqual(6);
  });

  it.each(plants.map((p) => [p.slug, p] as const))("renderiza para a usina %s (trocando o campo plant da fixture)", async (_slug, plant) => {
    const a = { ...clone(analysisFixture), plant: clone(plant) };
    const { doc, bytes } = await render(a, null);
    expect(doc.getTitle()).toBe(`Relatório de Auditoria — ${plant.name}`);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    expect(doc.getPageCount()).toBeLessThanOrEqual(11);
    expect(bytes.length).toBeLessThan(1_500_000);
  });

  it.each(plants.map((p) => p.slug))("renderiza a análise construída para %s", async (slug) => {
    const a = buildAnalysisFixture(slug);
    const { doc } = await render(a, null);
    expect(doc.getKeywords()).toContain(a.dataHash);
  });

  it("tolera dados opcionais ausentes", async () => {
    const a = clone(analysisFixture);
    a.pvgis = null;
    a.live = null;
    delete a.generation.crossCheck;
    delete a.resource.annualSeries;
    delete a.resource.monthly.dhiKWhM2Day;
    delete a.resource.monthly.tempMaxC;
    delete a.resource.monthly.tempMinC;
    delete a.resource.monthly.windMs;
    a.resource.provenance = [];
    a.location = { municipio: "Janaúba", uf: "MG", ibgeCode: 3135100, provenance: [] };
    a.market = { ...a.market, bnbBrl: undefined, provenance: [] };
    a.provenance = [];
    a.finance.paybackYears = null;
    a.finance.discountedPaybackYears = null;
    a.finance.sensitivity = [];
    a.finance.benchmarks = [];
    a.finance.assumptions = [];
    a.finance.monteCarlo = { ...a.finance.monteCarlo, histogram: [], variables: [] };
    a.generation.method = [];
    a.plant = { ...a.plant, illustrative: false, token: { ...a.plant.token, tokenAddress: undefined, offeringAddress: undefined, offeringStart: undefined, offeringEnd: undefined } };
    a.dataHash = "";
    const { doc } = await render(a, null);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(doc.getSubject()).not.toContain("Projeto ilustrativo");
  });

  it("tolera cenário adverso (VPL negativo, TIR abaixo do CDI) e textos longos", async () => {
    const a = clone(analysisFixture);
    a.finance.irrNominalPct = 6.2;
    a.finance.irrRealPct = 2.6;
    a.finance.npvBRL = -3_456_789;
    a.finance.monteCarlo.probIrrBelowCdiPct = 91.5;
    a.finance.monteCarlo.probNpvNegativePct = 88;
    a.generation.crossCheck = { source: "PVGIS", annualMWh: 4800, deviationPct: 17.3 };
    a.plant = {
      ...a.plant,
      name: "UFV Usina Fotovoltaica com um Nome Extraordinariamente Longo para Testar Quebras de Linha",
      tagline: "Texto de chamada muito longo ".repeat(12),
    };
    a.provenance = [
      ...a.provenance,
      {
        id: "x",
        name: "Fonte com caracteres incomuns ✓ σ Δ ́ e um nome muito longo que precisa quebrar em várias linhas dentro da célula da tabela",
        url: "https://example.com/" + "segmento-muito-longo/".repeat(20),
        fetchedAt: "data inválida",
        status: "error",
        note: "Observação longa ".repeat(10),
      },
    ];
    const { doc } = await render(a, onChainFixture);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
  });
});
