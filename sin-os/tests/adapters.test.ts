import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidate } from "../src/lib/cache";
import { fetchPldHourly } from "../src/lib/sources/ccee";
import { fetchCmoHourly, fetchEarDaily } from "../src/lib/sources/ons";
import { EU_ZONES, fetchEuPrices, resetEcThrottle } from "../src/lib/sources/europe";
import { fetchUkMid } from "../src/lib/sources/uk";
import { fetchFx } from "../src/lib/sources/fx";
import { fetchWeather, HUBS } from "../src/lib/sources/weather";
import { auditSource, crossPldCmo } from "../src/lib/audit/checks";
import { SOURCES } from "../src/lib/sources/registry";
import { brtDate } from "../src/lib/sources/time";
import { PLD_LIMITS } from "../src/lib/market/brazil";
import { errorSnippet, fetchJson, retryAfterMs } from "../src/lib/sources/http";

/**
 * Contratos dos adaptadores: payloads no formato documentado de cada provedor
 * (CKAN da CCEE/ONS, CSV ';' do ONS, Energy-Charts, Elexon, BCB SGS, Open-Meteo).
 */
const H = 3600_000;
const SUBS_CCEE = ["SUDESTE", "SUL", "NORDESTE", "NORTE"];
const SUBS_ONS = ["SE", "S", "NE", "N"];
// preço determinístico por (dia, hora, submercado), com piso aplicado
const price = (d: number, h: number, k: number) => 90 + 60 * Math.sin((h / 24) * 2 * Math.PI) + 10 * k + 5 * (d % 7);

function lastDays(n: number) {
  const out: { y: number; m: number; d: number; iso: string }[] = [];
  for (let i = n - 1; i >= -1; i--) {
    const iso = brtDate(Date.now() - i * 86400_000);
    const [y, m, d] = iso.split("-").map(Number);
    out.push({ y, m, d, iso });
  }
  return out;
}

function respond(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

function router(url: string): Response {
  const days = lastDays(40);
  if (url.includes("dadosabertos.ccee.org.br") && url.includes("package_show")) {
    return respond({ success: true, result: { resources: [
      { id: "res-2025", name: "PLD_HORARIO_2025", url: "x", datastore_active: true },
      { id: "res-2026", name: "PLD_HORARIO_2026", url: "y", datastore_active: true },
    ] } });
  }
  if (url.includes("dadosabertos.ccee.org.br") && url.includes("datastore_search")) {
    const records: Record<string, unknown>[] = [];
    let id = 1;
    days.forEach(({ y, m, d }, di) => {
      for (let h = 0; h < 24; h++) SUBS_CCEE.forEach((s, k) => records.push({ _id: id++, MES_REFERENCIA: y * 100 + m, SUBMERCADO: s, DIA: d, HORA: h, PLD_HORA: Math.max(PLD_LIMITS.min, price(di, h, k)) }));
    });
    return respond({ success: true, result: { records: records.reverse(), total: records.length } });
  }
  if (url.includes("dados.ons.org.br") && url.includes("package_show")) {
    const pkg = new URL(url).searchParams.get("id");
    return respond({ success: true, result: { resources: [
      { id: "dic", name: "Dicionário de Dados", url: "https://ons/dic.pdf", format: "PDF" },
      { id: "a", name: `${pkg}-2026`, url: `https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/${pkg}_2026.csv`, format: "CSV" },
    ] } });
  }
  if (url.includes("CMO_SEMIHORARIO_2026.csv") || url.includes("cmo-semi-horario_2026.csv")) {
    const lines = ["id_subsistema;nom_subsistema;din_instante;val_cmo"];
    days.forEach(({ iso }, di) => {
      for (let h = 0; h < 24; h++) for (const mm of ["00", "30"]) SUBS_ONS.forEach((s, k) => lines.push(`${s};X;${iso} ${String(h).padStart(2, "0")}:${mm}:00;${price(di, h, k).toFixed(2)}`));
    });
    return respond(lines.join("\n"));
  }
  if (url.includes("ear-diario-por-subsistema_2026.csv")) {
    const lines = ["id_subsistema;nom_subsistema;ear_data;ear_max_subsistema;ear_verif_subsistema_mwmes;ear_verif_subsistema_percentual"];
    days.slice(0, -2).forEach(({ iso }, di) => SUBS_ONS.forEach((s) => lines.push(`${s};X;${iso};200000;100000;${(55 - di * 0.1).toFixed(2)}`)));
    return respond(lines.join("\n"));
  }
  if (url.includes("api.energy-charts.info/price")) {
    const start = Math.floor(Date.now() / 900_000) * 900_000 - 3 * 86400_000;
    const unix = Array.from({ length: 4 * 96 }, (_, i) => (start + i * 900_000) / 1000);
    return respond({ license_info: "CC BY 4.0", unix_seconds: unix, price: unix.map((_, i) => 80 + 30 * Math.sin(i / 10)), unit: "EUR / MWh", deprecated: false });
  }
  if (url.includes("data.elexon.co.uk") && url.includes("market-index")) {
    const t0 = Math.floor(Date.now() / 1800_000) * 1800_000 - 47 * 1800_000;
    return respond({ data: Array.from({ length: 48 }, (_, i) => ({ startTime: new Date(t0 + i * 1800_000).toISOString(), dataProvider: "APXMIDP", settlementPeriod: i + 1, price: 70 + i, volume: 500 })) });
  }
  if (url.includes("api.bcb.gov.br")) {
    const code = url.match(/sgs\.(\d+)/)![1];
    const base = code === "1" ? 5.3 : code === "21619" ? 6.2 : 7.1;
    const today = new Date(Date.now() - 3 * H);
    return respond(Array.from({ length: 20 }, (_, i) => {
      const d = new Date(today.getTime() - (19 - i) * 86400_000);
      return { data: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`, valor: (base + i * 0.001).toFixed(4) };
    }));
  }
  if (url.includes("api.open-meteo.com")) {
    const times = Array.from({ length: 16 * 24 }, (_, i) => new Date(Date.now() + i * H - 3 * H).toISOString().slice(0, 13) + ":00");
    return respond(HUBS.map((h) => ({
      latitude: h.lat,
      longitude: h.lon,
      hourly: { time: times, temperature_2m: times.map(() => 25), shortwave_radiation: times.map(() => 500), wind_speed_100m: times.map(() => 9), precipitation: times.map(() => 0) },
      daily: { time: Array.from({ length: 16 }, (_, i) => new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10)), precipitation_sum: new Array(16).fill(1) },
    })));
  }
  return respond({ error: "not mocked" }, 404);
}

describe("contratos dos adaptadores (fetch mockado)", () => {
  beforeEach(() => {
    invalidate("");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => router(String(input))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("CCEE PLD horário: resolve recurso anual, normaliza submercados e horário BRT", async () => {
    const r = await fetchPldHourly(30);
    expect(r.ok).toBe(true);
    expect(r.quality.schemaIssues).toEqual([]);
    expect(r.quality.duplicates).toBe(0);
    expect(r.data!.values.SE.every((v) => v === null || v >= PLD_LIMITS.min)).toBe(true);
    const a = auditSource(SOURCES.ccee_pld, r);
    expect(a.status).toBe("ok");
    expect(a.score).toBeGreaterThanOrEqual(85);
  });

  it("ONS CMO semi-horário → horário, e integridade PLD × CMO passa", async () => {
    const pld = await fetchPldHourly(30);
    const cmo = await fetchCmoHourly(30);
    expect(cmo.ok).toBe(true);
    expect(cmo.data!.ts.length).toBeGreaterThan(24 * 20);
    const x = crossPldCmo(pld.data, cmo.data);
    expect(x.status).toBe("pass");
    expect(x.metrics.mae).toBeLessThan(0.01);
  });

  it("ONS EAR diário", async () => {
    const r = await fetchEarDaily(30);
    expect(r.ok).toBe(true);
    expect(r.data!.values.SE.at(-1)).toBeGreaterThan(40);
    expect(auditSource(SOURCES.ons_ear, r).status).toBe("ok");
  });

  it("Energy-Charts, Elexon, BCB e Open-Meteo", async () => {
    resetEcThrottle();
    const eu = await fetchEuPrices(3);
    expect(eu.ok).toBe(true);
    expect(Object.keys(eu.data!).length).toBe(2);
    const uk = await fetchUkMid(1);
    expect(uk.ok).toBe(true);
    expect(uk.data!.values.length).toBe(48);
    const fx = await fetchFx();
    expect(fx.ok).toBe(true);
    expect(fx.data!.EUR.rate / fx.data!.USD.rate).toBeGreaterThan(1);
    const wx = await fetchWeather();
    expect(wx.ok).toBe(true);
    expect(wx.data!.length).toBe(HUBS.length);
  });

  it("ONS CMO: lê direto do bucket S3 e cai para o CKAN se o S3 falhar", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => { calls.push(String(input)); return router(String(input)); }));
    const r = await fetchCmoHourly(30);
    expect(r.ok).toBe(true);
    expect(calls.some((u) => u.includes("/cmo_tm/CMO_SEMIHORARIO_2026.csv"))).toBe(true); // S3 direto
    expect(calls.some((u) => u.includes("package_show"))).toBe(false); // não precisou do CKAN

    invalidate("");
    calls.length = 0;
    // S3 fora do ar → precisa cair para o CKAN e ainda assim resolver
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.includes("CMO_SEMIHORARIO")) return respond("bloqueado", 503);
      return router(u);
    }));
    const r2 = await fetchCmoHourly(30);
    expect(r2.ok).toBe(true);
    expect(calls.some((u) => u.includes("package_show"))).toBe(true); // usou o CKAN como fallback
  });

  it("auditor detecta HTTP 403 (bloqueio/WAF) sem retentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond("Forbidden", 403)));
    const r = await fetchPldHourly(30);
    expect(r.ok).toBe(false);
    expect(r.probes).toHaveLength(1);
    const a = auditSource(SOURCES.ccee_pld, r);
    expect(a.status).toBe("down");
    expect(a.error).toContain("403");
    expect(a.error).toContain("atendimento@ccee.org.br");
  });
});

describe("Energy-Charts dentro do limite de 2 req/min", () => {
  const ecCalls = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("energy-charts")).length;
  beforeEach(() => {
    resetEcThrottle();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => router(String(input))));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("carrega 2 zonas por minuto, guarda e completa as 12 aos poucos", async () => {
    const first = await fetchEuPrices(7);
    expect(Object.keys(first.data!)).toHaveLength(2);
    expect(first.quality.schemaIssues.join()).toContain("10 zona(s) aguardando carga");
    const again = await fetchEuPrices(7);
    expect(ecCalls()).toBe(2); // mesma janela de 60 s: nenhuma chamada extra
    expect(Object.keys(again.data!)).toHaveLength(2);
    for (let m = 1; m <= 5; m++) {
      vi.setSystemTime(Date.now() + 61_000);
      await fetchEuPrices(7);
    }
    const all = await fetchEuPrices(7);
    expect(Object.keys(all.data!)).toHaveLength(EU_ZONES.length);
    expect(ecCalls()).toBe(EU_ZONES.length);
    expect(all.quality.schemaIssues).toEqual([]);
  });

  it("429: não re-tenta e entra em espera", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Too Many Requests", { status: 429 })));
    const r = await fetchEuPrices(7);
    expect(r.ok).toBe(false);
    expect(r.probes).toHaveLength(1);
    await fetchEuPrices(7);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
});

describe("cliente HTTP", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resume páginas HTML de erro (WAF) pelo <title> e preserva código/IP", () => {
    const html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Acesso bloqueado</title><style>body{font:13px Arial}</style></head>' +
      "<body><h1>Acesso bloqueado</h1><p>Abra um chamado informando o Error Code e o IP exibidos abaixo.</p>" +
      "<p>Error Code: 0.5e2b3b17.1727272727.1a2b3c.</p><p>IP&nbsp;203.0.113.7</p><script>x()</script></body></html>";
    expect(errorSnippet(html).split(" — ")[0]).toBe("Acesso bloqueado (Error Code 0.5e2b3b17.1727272727.1a2b3c · IP 203.0.113.7)");
    expect(errorSnippet("<html><head><title>Acesso bloqueado</title></head><body>sem detalhes</body></html>")).toBe("Acesso bloqueado — sem detalhes");
    expect(errorSnippet("<html><body><h1>Forbidden</h1></body></html>")).toBe("Forbidden");
    expect(errorSnippet('{"error":"rate"}')).toBe('{"error":"rate"}');
  });

  it("429 respeita Retry-After e tenta de novo", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++calls === 1 ? new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }) : respond({ ok: 1 }))));
    const r = await fetchJson<{ ok: number }>("https://example.test/x");
    expect(r.json.ok).toBe(1);
    expect(r.probes.map((p) => p.status)).toEqual([429, 200]);
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("600")).toBe(8000);
    expect(retryAfterMs(null)).toBeNull();
  });
});
