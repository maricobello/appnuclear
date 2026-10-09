import { beforeEach, describe, expect, it } from "vitest";
import { clearSourceCache } from "@/lib/sources/http";
import { focusSchema, parseSgsLatest, pickLongTermIpca, sgsSchema } from "@/lib/sources/bcb";
import { MARKET_DEFAULTS } from "@/lib/sources/defaults";
import { getMarketRates } from "@/lib/sources/market";
import { createMockFetch, fixture, hang, json, networkError, route, status, type Route } from "./fixtures/sources/mock-fetch";

const NOW = () => new Date("2026-10-04T12:00:00Z");
const OPTS = { now: NOW, backoffMs: 0 };

const sgs = (code: number) => new RegExp(`bcdata\\.sgs\\.${code}/`);
const FOCUS = /olinda\.bcb\.gov\.br/;
const BINANCE_USDT = /binance\.com.*symbol=USDTBRL/;
const BINANCE_BNB = /binance\.com.*symbol=BNBBRL/;
const COINGECKO = /coingecko\.com/;

function bcbRoutes(): Route[] {
  return [
    route(sgs(432), json(fixture("bcb-sgs-432.json"))),
    route(sgs(4389), json(fixture("bcb-sgs-4389.json"))),
    route(sgs(13522), json(fixture("bcb-sgs-13522.json"))),
    route(sgs(1), json(fixture("bcb-sgs-1.json"))),
    route(FOCUS, json(fixture("bcb-focus-ipca.json"))),
  ];
}
function binanceRoutes(): Route[] {
  return [route(BINANCE_USDT, json(fixture("binance-ticker-usdtbrl.json"))), route(BINANCE_BNB, json(fixture("binance-ticker-bnbbrl.json")))];
}
const statusOf = (r: Awaited<ReturnType<typeof getMarketRates>>, id: string) => r.provenance.find((p) => p.id === id)?.status;

beforeEach(() => clearSourceCache());

describe("SGS", () => {
  it("lê o último ponto com vírgula ou ponto decimal", () => {
    expect(parseSgsLatest(sgsSchema.parse([{ data: "03/10/2026", valor: "14,90" }]))).toEqual({ value: 14.9, date: "2026-10-03" });
    expect(parseSgsLatest(sgsSchema.parse([{ data: "02/10/2026", valor: "5.4123" }]))).toEqual({ value: 5.4123, date: "2026-10-02" });
    expect(parseSgsLatest(sgsSchema.parse([{ data: "01/10/2026", valor: 14.15 }])).value).toBe(14.15);
  });

  it("vários pontos ⇒ o último válido", () => {
    const rows = sgsSchema.parse([
      { data: "01/10/2026", valor: "14,25" },
      { data: "02/10/2026", valor: "" },
    ]);
    expect(parseSgsLatest(rows)).toEqual({ value: 14.25, date: "2026-10-01" });
  });

  it("array vazio é rejeitado pelo esquema", () => {
    expect(sgsSchema.safeParse([]).success).toBe(false);
  });
});

describe("Focus — IPCA de longo prazo", () => {
  it("usa o ano de referência mais distante na pesquisa mais recente, promediando bases de cálculo", () => {
    const r = pickLongTermIpca(focusSchema.parse(fixture("bcb-focus-ipca.json")));
    expect(r).toEqual({ value: 3.52, refYear: 2030, surveyDate: "2026-10-02" });
  });

  it("ignora medianas nulas e outros indicadores", () => {
    const r = pickLongTermIpca(
      focusSchema.parse({
        value: [
          { Indicador: "IPCA", Data: "2026-10-02", DataReferencia: "2031", Mediana: null },
          { Indicador: "Selic", Data: "2026-10-02", DataReferencia: "2032", Mediana: 9.5 },
          { Indicador: "IPCA", Data: "2026-09-26", DataReferencia: "2030", Mediana: "3,6" },
        ],
      }),
    );
    expect(r).toEqual({ value: 3.6, refYear: 2030, surveyDate: "2026-09-26" });
  });

  it("sem dados ⇒ erro", () => {
    expect(() => pickLongTermIpca({ value: [] })).toThrow();
  });
});

describe("getMarketRates", () => {
  it("tudo ao vivo", async () => {
    const mock = createMockFetch([...bcbRoutes(), ...binanceRoutes()]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(mock.unmatched).toEqual([]);
    expect(r).toMatchObject({
      selicPct: 14.25,
      cdiPct: 14.15,
      ipca12mPct: 4.82, // "4,82" no fixture
      ipcaLongTermPct: 3.52,
      realRatePct: MARKET_DEFAULTS.realRatePct.value,
      usdBrl: 5.4123,
      usdtBrl: 5.418,
      bnbBrl: 5123.4,
    });
    expect(r.provenance.map((p) => [p.id, p.status])).toEqual([
      ["bcb-sgs-432", "live"],
      ["bcb-sgs-4389", "live"],
      ["bcb-sgs-13522", "live"],
      ["bcb-focus-ipca", "live"],
      ["tesouro-ipca-longo", "fallback"],
      ["bcb-sgs-1", "live"],
      ["crypto-usdt-brl", "live"],
      ["crypto-bnb-brl", "live"],
    ]);
    expect(r.provenance[0].note).toBe("referência 2026-10-03");
    expect(r.provenance[3].name).toContain("2030");
    expect(r.provenance[4].note).toContain("defaults.ts");
    expect(mock.callsTo(COINGECKO)).toHaveLength(0);
    // revalidate de 1 h no BCB e 60 s na cripto
    expect(mock.callsTo(sgs(432))[0].init?.next).toEqual({ revalidate: 3600 });
    expect(mock.callsTo(BINANCE_USDT)[0].init?.next).toEqual({ revalidate: 60 });
  });

  it("Binance 451 (região restrita) ⇒ CoinGecko", async () => {
    const mock = createMockFetch([
      ...bcbRoutes(),
      route(/binance\.com/, status(451, fixture("binance-error-451.json"))),
      route(COINGECKO, json(fixture("coingecko-simple-price.json"))),
    ]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(r.usdtBrl).toBe(5.42);
    expect(r.bnbBrl).toBe(5118.27);
    const usdt = r.provenance.find((p) => p.id === "crypto-usdt-brl")!;
    expect(usdt).toMatchObject({ status: "live", name: "CoinGecko — tether/BRL" });
    expect(usdt.note).toContain("HTTP 451");
    expect(mock.callsTo(BINANCE_USDT)).toHaveLength(1); // 4xx: sem nova tentativa
    expect(mock.callsTo(COINGECKO)).toHaveLength(1);
  });

  it("só BNB falha na Binance ⇒ USDT da Binance e BNB do CoinGecko", async () => {
    const mock = createMockFetch([
      ...bcbRoutes(),
      route(BINANCE_USDT, json(fixture("binance-ticker-usdtbrl.json"))),
      route(BINANCE_BNB, status(400, { code: -1121, msg: "Invalid symbol." })),
      route(COINGECKO, json(fixture("coingecko-simple-price.json"))),
    ]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(r.usdtBrl).toBe(5.418);
    expect(r.bnbBrl).toBe(5118.27);
    expect(r.provenance.find((p) => p.id === "crypto-bnb-brl")!.note).toContain("Invalid symbol");
  });

  it("toda cripto fora ⇒ USDT ≈ dólar PTAX (fallback) e BNB omitido (error)", async () => {
    const mock = createMockFetch([...bcbRoutes(), route(/binance\.com/, status(451)), route(COINGECKO, status(429))]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(r.usdtBrl).toBe(5.4123);
    expect(r.bnbBrl).toBeUndefined();
    expect("bnbBrl" in r).toBe(false);
    expect(statusOf(r, "crypto-usdt-brl")).toBe("fallback");
    expect(statusOf(r, "crypto-bnb-brl")).toBe("error");
    expect(r.provenance.find((p) => p.id === "crypto-usdt-brl")!.note).toMatch(/451.*429/);
  });

  it("CDI fora ⇒ estimado como Selic − 0,10 p.p.", async () => {
    const mock = createMockFetch([route(sgs(4389), status(503)), ...bcbRoutes(), ...binanceRoutes()]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(r.selicPct).toBe(14.25);
    expect(r.cdiPct).toBe(14.15);
    expect(statusOf(r, "bcb-sgs-4389")).toBe("fallback");
    expect(r.provenance.find((p) => p.id === "bcb-sgs-4389")!.note).toContain("Selic meta (14.25) − 0.1 p.p.");
  });

  it("Selic fora ⇒ estimada como CDI + 0,10 p.p.", async () => {
    const mock = createMockFetch([route(sgs(432), json([])), ...bcbRoutes(), ...binanceRoutes()]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(r.selicPct).toBe(14.25);
    expect(statusOf(r, "bcb-sgs-432")).toBe("fallback");
  });

  it("BCB inteiro fora (rede/timeout/HTML) ⇒ valores de referência documentados, nunca lança", async () => {
    const mock = createMockFetch([
      route(sgs(432), networkError("ENOTFOUND")),
      route(sgs(4389), hang()),
      route(sgs(13522), status(500)),
      route(sgs(1), () => new Response("<html>Request Rejected</html>", { status: 200 })),
      route(FOCUS, json({ value: [] })),
      ...binanceRoutes(),
    ]);
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS, timeoutMs: 20 });
    const D = MARKET_DEFAULTS;
    expect(r).toMatchObject({
      selicPct: D.selicPct.value,
      cdiPct: D.cdiPct.value,
      ipca12mPct: D.ipca12mPct.value,
      ipcaLongTermPct: D.ipcaLongTermPct.value,
      usdBrl: D.usdBrl.value,
      usdtBrl: 5.418,
    });
    for (const id of ["bcb-sgs-432", "bcb-sgs-4389", "bcb-sgs-13522", "bcb-sgs-1", "bcb-focus-ipca"]) {
      expect(statusOf(r, id)).toBe("fallback");
    }
    const notes = r.provenance.map((p) => p.note ?? "").join(" | ");
    expect(notes).toContain("ENOTFOUND");
    expect(notes).toContain("tempo esgotado");
    expect(notes).toContain("HTTP 500");
    expect(notes).toContain("não é JSON");
    expect(notes).toContain("Focus sem medianas");
    expect(r.provenance.find((p) => p.id === "bcb-sgs-432")!.url).toBe(D.selicPct.url);
  });

  it("segunda chamada sai do cache", async () => {
    const mock = createMockFetch([...bcbRoutes(), ...binanceRoutes()]);
    await getMarketRates({ fetchImpl: mock, ...OPTS });
    const n = mock.calls.length;
    const r = await getMarketRates({ fetchImpl: mock, ...OPTS });
    expect(mock.calls.length).toBe(n);
    expect(statusOf(r, "bcb-sgs-432")).toBe("cache");
    expect(statusOf(r, "crypto-usdt-brl")).toBe("cache");
  });
});
