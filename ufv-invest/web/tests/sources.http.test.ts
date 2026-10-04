import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SourceError, USER_AGENT, clearSourceCache, fetchJson, provenance, provenanceFromResult } from "@/lib/sources/http";
import { createMockFetch, hang, json, networkError, route, status, text } from "./fixtures/sources/mock-fetch";

const URL_A = "https://api.example.test/a";
const schema = z.looseObject({ value: z.number() });

/** relógio controlável */
function clock(startIso = "2026-10-04T12:00:00Z") {
  let t = Date.parse(startIso);
  return { now: () => new Date(t), advance: (sec: number) => (t += sec * 1000) };
}

beforeEach(() => clearSourceCache());

describe("fetchJson", () => {
  it("busca, valida e devolve status live com fetchedAt, User-Agent, timeout e next.revalidate", async () => {
    const c = clock();
    const mock = createMockFetch([route(URL_A, json({ value: 42, extra: "ok" }))]);
    const r = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, revalidateSec: 3600 });
    expect(r.data.value).toBe(42);
    expect(r.status).toBe("live");
    expect(r.fetchedAt).toBe("2026-10-04T12:00:00.000Z");
    expect(r.url).toBe(URL_A);
    const init = mock.calls[0].init!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.next).toEqual({ revalidate: 3600 });
  });

  it("segunda chamada sai do cache em memória com status cache e o fetchedAt original", async () => {
    const c = clock();
    const mock = createMockFetch([route(URL_A, json({ value: 1 }))]);
    const first = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 600 });
    c.advance(120);
    const second = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 600 });
    expect(mock.calls).toHaveLength(1);
    expect(second.status).toBe("cache");
    expect(second.fetchedAt).toBe(first.fetchedAt);
    expect(second.data).toEqual(first.data);
  });

  it("cache expira após o TTL; noCache ignora a leitura do cache", async () => {
    const c = clock();
    const mock = createMockFetch([route(URL_A, [json({ value: 1 }), json({ value: 2 }), json({ value: 3 })])]);
    await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 60 });
    c.advance(61);
    const r2 = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 60 });
    expect(r2).toMatchObject({ status: "live", data: { value: 2 } });
    const r3 = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 60, noCache: true });
    expect(r3).toMatchObject({ status: "live", data: { value: 3 } });
    expect(mock.calls).toHaveLength(3);
  });

  it("nova tentativa em HTTP 5xx", async () => {
    const mock = createMockFetch([route(URL_A, [status(503), json({ value: 7 })])]);
    const r = await fetchJson(URL_A, schema, { fetchImpl: mock, backoffMs: 0 });
    expect(r.data.value).toBe(7);
    expect(mock.calls).toHaveLength(2);
  });

  it("nova tentativa em erro de rede; desiste após retries", async () => {
    const mock = createMockFetch([route(URL_A, networkError("ECONNREFUSED"))]);
    const err = await fetchJson(URL_A, schema, { fetchImpl: mock, backoffMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.kind).toBe("network");
    expect(err.message).toContain("ECONNREFUSED");
    expect(mock.calls).toHaveLength(2);
  });

  it("sem nova tentativa em 4xx; mensagem do corpo vai para o erro", async () => {
    const mock = createMockFetch([route(URL_A, status(404, { message: "série não encontrada" }))]);
    const err = await fetchJson(URL_A, schema, { fetchImpl: mock, backoffMs: 0 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 404 });
    expect(err.message).toBe("HTTP 404 — série não encontrada");
    expect(mock.calls).toHaveLength(1);
  });

  it("timeout por tentativa (AbortSignal.timeout) com uma nova tentativa", async () => {
    const mock = createMockFetch([route(URL_A, hang())]);
    const t0 = Date.now();
    const err = await fetchJson(URL_A, schema, { fetchImpl: mock, timeoutMs: 30, backoffMs: 0 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout" });
    expect(err.message).toContain("30 ms");
    expect(mock.calls).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("formato inesperado ⇒ erro schema sem nova tentativa", async () => {
    const mock = createMockFetch([route(URL_A, json({ value: "não é número" }))]);
    const err = await fetchJson(URL_A, schema, { fetchImpl: mock, backoffMs: 0 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "schema" });
    expect(err.message).toContain("value");
    expect(mock.calls).toHaveLength(1);
  });

  it("corpo HTML com status 200 ⇒ erro parse", async () => {
    const mock = createMockFetch([route(URL_A, text("<html>manutenção</html>"))]);
    await expect(fetchJson(URL_A, schema, { fetchImpl: mock })).rejects.toMatchObject({ kind: "parse" });
  });

  it("stale-if-error: cópia expirada é servida (status cache + nota) se a API falhar", async () => {
    const c = clock();
    const mock = createMockFetch([route(URL_A, [json({ value: 5 }), status(500)])]);
    const first = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 60, backoffMs: 0 });
    c.advance(3600);
    const r = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, cacheTtlSec: 60, backoffMs: 0 });
    expect(r.status).toBe("cache");
    expect(r.data.value).toBe(5);
    expect(r.fetchedAt).toBe(first.fetchedAt);
    expect(r.note).toContain("HTTP 500");
  });

  it("cache negativo: falha recente não é repetida por 60 s", async () => {
    const c = clock();
    const mock = createMockFetch([route(URL_A, [status(500), status(500), json({ value: 1 })])]);
    await expect(fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, backoffMs: 0 })).rejects.toMatchObject({ status: 500 });
    await expect(fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, backoffMs: 0 })).rejects.toMatchObject({ status: 500 });
    expect(mock.calls).toHaveLength(2);
    c.advance(61);
    const r = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now, backoffMs: 0 });
    expect(r.status).toBe("live");
  });

  it("cabeçalho Date antigo (Data Cache do Next/CDN) ⇒ status cache com o horário original", async () => {
    const c = clock("2026-10-04T12:00:00Z");
    const mock = createMockFetch([route(URL_A, json({ value: 1 }, 200, { date: "Sat, 04 Oct 2026 10:00:00 GMT" }))]);
    const r = await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now });
    expect(r.status).toBe("cache");
    expect(r.fetchedAt).toBe("2026-10-04T10:00:00.000Z");
    expect(r.note).toContain("cache de dados");
  });

  it("cabeçalho Date recente ⇒ live", async () => {
    const c = clock("2026-10-04T12:00:00Z");
    const mock = createMockFetch([route(URL_A, json({ value: 1 }, 200, { date: "Sat, 04 Oct 2026 11:59:58 GMT" }))]);
    expect((await fetchJson(URL_A, schema, { fetchImpl: mock, now: c.now })).status).toBe("live");
  });
});

describe("provenance", () => {
  it("monta o registro e omite nota vazia", () => {
    expect(provenance("x", "Fonte X", "https://x", "fallback", undefined, "2026-01-01T00:00:00.000Z")).toEqual({
      id: "x",
      name: "Fonte X",
      url: "https://x",
      status: "fallback",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("provenanceFromResult junta a nota da fonte com a nota de cache", () => {
    const p = provenanceFromResult("y", "Y", { data: 1, status: "cache", fetchedAt: "t", url: "u", note: "cópia" }, "detalhe");
    expect(p).toMatchObject({ id: "y", status: "cache", fetchedAt: "t", url: "u", note: "detalhe; cópia" });
  });
});
