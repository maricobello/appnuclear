/**
 * `fetch` falso para os testes das fontes de dados (nenhum teste acessa a rede).
 *
 *   const mock = createMockFetch([
 *     route(/power\.larc/, json(fixture("nasa-power-climatology.json"))),
 *     route("binance.com", [status(500), json({...})]),   // respostas em sequência (a última se repete)
 *     route("open-meteo", hang()),                         // nunca responde ⇒ timeout
 *   ]);
 *   await getSolarResource(plant, { fetchImpl: mock, backoffMs: 0 });
 *   expect(mock.calls).toHaveLength(2);
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchLike, NextFetchInit } from "@/lib/sources/http";

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.resolve(import.meta.dirname, name), "utf8")) as T;
}

/** Cópia profunda para alterar um fixture dentro de um teste */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export type Handler = (url: string, init?: NextFetchInit) => Response | Promise<Response>;
type Matcher = string | RegExp | ((url: string) => boolean);

export interface Route {
  match: Matcher;
  handlers: Handler[];
  hits: number;
}

export function route(match: Matcher, handler: Handler | Handler[]): Route {
  return { match, handlers: Array.isArray(handler) ? handler : [handler], hits: 0 };
}

export const json =
  (body: unknown, statusCode = 200, headers: Record<string, string> = {}): Handler =>
  () =>
    new Response(JSON.stringify(body), { status: statusCode, headers: { "content-type": "application/json", ...headers } });

export const text =
  (body: string, statusCode = 200): Handler =>
  () =>
    new Response(body, { status: statusCode, headers: { "content-type": "text/html" } });

export const status = (statusCode: number, body: unknown = { message: `HTTP ${statusCode}` }): Handler => json(body, statusCode);

/** Falha de rede (como o undici: TypeError "fetch failed" com `cause.code`) */
export const networkError =
  (code = "ECONNRESET"): Handler =>
  () => {
    const err = new TypeError("fetch failed") as TypeError & { cause?: unknown };
    err.cause = { code };
    throw err;
  };

/** Nunca responde; rejeita quando o AbortSignal (timeout) dispara */
export const hang = (): Handler => (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // sem sinal ficaria pendurado para sempre — fetchJson sempre envia
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

function matches(m: Matcher, url: string): boolean {
  if (typeof m === "string") return url.includes(m);
  if (m instanceof RegExp) return m.test(url);
  return m(url);
}

export type MockFetch = FetchLike & {
  calls: { url: string; init?: NextFetchInit }[];
  unmatched: string[];
  callsTo: (m: Matcher) => { url: string; init?: NextFetchInit }[];
};

export function createMockFetch(routes: Route[]): MockFetch {
  const calls: MockFetch["calls"] = [];
  const unmatched: string[] = [];
  const fn = (async (url: string, init?: NextFetchInit) => {
    calls.push({ url, init });
    const r = routes.find((rt) => matches(rt.match, url));
    if (!r) {
      unmatched.push(url);
      throw new TypeError(`URL não mockada: ${url}`);
    }
    const h = r.handlers[Math.min(r.hits, r.handlers.length - 1)];
    r.hits++;
    return h(url, init);
  }) as MockFetch;
  fn.calls = calls;
  fn.unmatched = unmatched;
  fn.callsTo = (m) => calls.filter((c) => matches(m, c.url));
  return fn;
}
