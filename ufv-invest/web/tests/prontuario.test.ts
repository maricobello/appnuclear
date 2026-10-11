import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { baseScenarioParams, buildCashFlows } from "@/lib/finance";
import { canonicalJson } from "@/lib/report/canonical";
import { buildProntuarioData } from "@/lib/prontuario/dados";
import { applySchedule, auditDistribution, buildCases, evaluate, limitsFor, optimize, plantBase, type PlantBase } from "@/lib/prontuario/modelo";
import { CURRENT_SCHEDULE, GUARDRAILS, type FeeSchedule } from "@/lib/prontuario/premissas";
import { PRONTUARIO_ATTACHMENT, renderProntuario } from "@/lib/prontuario/render";
import { analysisFixturesBySlug } from "./fixtures/analysis.fixture";

const analyses = Object.values(analysisFixturesBySlug);
const NOW = new Date("2026-10-11T15:00:00Z");
const sched = (p: Partial<FeeSchedule>): FeeSchedule => ({ id: "t", label: "t", structuringPct: 0, managementPct: 0, performancePct: 0, hurdleRealPct: 0, ...p });

describe("cascata de caixa da plataforma", () => {
  it("na tabela atual reproduz exatamente o fluxo do cotista do site", () => {
    for (const a of analyses) {
      const o = applySchedule(plantBase(a), a.plant.token.totalCotas, CURRENT_SCHEDULE);
      const site = buildCashFlows(a.plant, baseScenarioParams(a.plant, a.generation, a.market)).flows;
      expect(o.investorFlows.length).toBe(site.length);
      o.investorFlows.forEach((v, i) => expect(v).toBeCloseTo(site[i], 4));
    }
  });

  it("conserva o caixa: taxas + distribuições = caixa operacional, ano a ano", () => {
    const a = analyses[0];
    const b = plantBase(a);
    const o = applySchedule(b, a.plant.token.totalCotas, sched({ structuringPct: 7, managementPct: 11, performancePct: 25, hurdleRealPct: 6 }));
    o.years.forEach((y) => {
      const op = y.revenue - y.taxes - y.opex - y.replacement;
      expect(y.management + y.performance + y.distribution).toBeCloseTo(op, 6);
    });
    // a usina é a mesma: a estruturação muda a captação, não o CAPEX
    expect(o.investment * (1 - 0.07)).toBeCloseTo(b.capex, 4);
    expect(o.structuringFee).toBeCloseTo(o.investment - b.capex, 4);
  });

  it("sem taxas, a plataforma não recebe nada e o investidor fica com todo o caixa", () => {
    const a = analyses[0];
    const o = applySchedule(plantBase(a), a.plant.token.totalCotas, sched({}));
    expect(o.platformFees.every((f) => f === 0)).toBe(true);
    expect(o.platformSharePct).toBe(0);
  });

  it("performance só sobre o excedente ao hurdle e com déficit acumulado", () => {
    // usina sintética: 3 anos de caixa 50, 200, 200 sobre captação de 1.000; hurdle de 10 % a.a. (sem IPCA)
    const b: PlantBase = {
      capex: 1000,
      ipcaPct: 0,
      discountRatePct: 10,
      years: [50, 200, 200].map((cash, i) => ({ year: i + 1, calendarYear: 2030 + i, revenue: cash, taxes: 0, opex: 0, replacement: 0 })),
    };
    const o = applySchedule(b, 1000, sched({ performancePct: 20, hurdleRealPct: 10 }));
    // ano 1: 50 < 100 → déficit 50; ano 2: excedente = 200 − 100 − 50 = 50 → performance 10; ano 3: 200 − 100 = 100 → 20
    expect(o.years.map((y) => +y.performance.toFixed(6))).toEqual([0, 10, 20]);
    expect(o.years.map((y) => +y.deficit.toFixed(6))).toEqual([50, 0, 0]);
  });
});

describe("otimização da tabela", () => {
  const cases = buildCases(analyses);
  const market = analyses[0].market;
  const opt = optimize(cases, market, 25);

  it("a tabela recomendada respeita todas as travas e tem o maior VPL entre as viáveis", () => {
    expect(opt.best.feasible).toBe(true);
    expect(opt.best.worstIrrP50Pct).toBeGreaterThanOrEqual(opt.limits.minIrrP50Pct);
    expect(opt.best.worstRealIrrP90Pct).toBeGreaterThanOrEqual(opt.limits.minRealIrrP90Pct);
    expect(opt.best.worstPaybackYears).toBeLessThanOrEqual(GUARDRAILS.maxPaybackYears);
    expect(opt.best.worstSharePct).toBeLessThanOrEqual(GUARDRAILS.maxPlatformSharePct);
    for (const e of opt.all.filter((x) => x.feasible)) expect(opt.best.platformNpv).toBeGreaterThanOrEqual(e.platformNpv - 1e-6);
  });

  it("travas mais apertadas nunca aumentam o VPL da plataforma", () => {
    const lim = limitsFor(market, 25);
    const loose = evaluate(cases, opt.best.schedule, { ...lim, maxSharePct: 100 });
    expect(loose.feasible).toBe(true);
    const tight = evaluate(cases, opt.best.schedule, { ...lim, maxSharePct: 5 });
    expect(tight.feasible).toBe(false);
    expect(tight.violations).toContain("Participação");
  });
});

describe("auditoria da distribuição on-chain", () => {
  it("não cria nem perde valor: resíduo ≤ 1 wei por detentor e pró-rata exato", () => {
    const monthly = Array.from({ length: 36 }, (_, i) => 12_345_678_901_234_567_890_123n + BigInt(i) * 1_000_003n);
    for (const supply of [1, 7, 5000, 15800]) {
      const r = auditDistribution({ supply, monthlyWei: monthly });
      expect(r.ok).toBe(true);
      expect(r.residualWei >= 0n && r.residualWei <= r.boundWei).toBe(true);
      expect(r.attributedWei + r.residualWei).toBe(r.distributedWei);
    }
  });
});

describe("prontuário (dados e PDF)", () => {
  it("gera o PDF com anexo canônico e hash verificável", async () => {
    const data = buildProntuarioData(analyses, { siteUrl: "https://ufv-invest.example", chainId: 97, deployed: false, now: NOW, review: [] });
    expect(data.id).toMatch(/^PE-20261011-[0-9A-F]{6}$/);
    expect(data.plants.length).toBe(analyses.length);
    expect(data.diagnosis.length).toBeGreaterThanOrEqual(5);
    expect(data.prescriptions.some((p) => p.prioridade === "P0")).toBe(true);

    const bytes = await renderProntuario(data);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(8);
    expect(doc.getTitle()).toContain(data.id);

    // anexo: JSON canônico; o hash cobre os dados sem número, data de emissão e o próprio hash
    const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    const arr = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict)?.lookupMaybe(PDFName.of("Names"), PDFArray);
    expect(arr).toBeDefined();
    const nameObj = arr!.lookup(0);
    const name = nameObj instanceof PDFString || nameObj instanceof PDFHexString ? nameObj.decodeText() : "";
    expect(name).toBe(PRONTUARIO_ATTACHMENT);
    const spec = arr!.lookup(1, PDFDict);
    const stream = spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
    expect(stream).toBeInstanceOf(PDFRawStream);
    const json = new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode());
    const attached = JSON.parse(json) as Record<string, unknown>;
    expect(attached.dataHash).toBe(data.dataHash);
    const { id: _id, dataHash: _h, issuedAt: _t, ...rest } = attached;
    void _id;
    void _h;
    void _t;
    expect(createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex")).toBe(data.dataHash);
  });

  it("é determinístico para os mesmos dados", () => {
    const a = buildProntuarioData(analyses, { siteUrl: "https://x", chainId: 97, deployed: false, now: NOW });
    const b = buildProntuarioData(analyses, { siteUrl: "https://x", chainId: 97, deployed: false, now: new Date("2026-10-11T18:00:00Z") });
    expect(a.dataHash).toBe(b.dataHash);
  });
});
