/**
 * Infraestrutura HTTP compartilhada pelos adaptadores de dados públicos.
 *
 *  - `fetchJson`: GET com timeout (AbortSignal.timeout), 1 nova tentativa com backoff em erro de
 *    rede/timeout/5xx (nunca em 4xx), validação do corpo com zod e `next.revalidate` para o
 *    Data Cache do Next.js no servidor.
 *  - Cache em memória por processo (TTL), chaveado pela URL: acertos voltam com status "cache" e o
 *    `fetchedAt` original. Cópias expiradas ainda servem como "stale-if-error" se a API falhar.
 *  - Cache negativo curto (60 s) para não martelar uma API que acabou de falhar.
 *  - `provenance()`: monta o registro de procedência exibido na tela e no PDF.
 *
 * O `fetch` é injetável (`SourceOptions.fetchImpl`) para que os testes rodem offline.
 */
import type { z } from "zod";
import type { Provenance, SourceStatus } from "@/lib/types";

export const USER_AGENT = "UFVInvest/0.1 (+https://github.com/maricobello/appnuclear)";

/** RequestInit com a extensão `next` do Next.js (Data Cache) */
export type NextFetchInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
export type FetchLike = (url: string, init?: NextFetchInit) => Promise<Response>;

/** Opções aceitas por todas as funções públicas de `@/lib/sources` (principalmente para testes) */
export interface SourceOptions {
  /** substitui o `fetch` global (testes) */
  fetchImpl?: FetchLike;
  /** timeout por tentativa, ms (cada fonte tem seu padrão) */
  timeoutMs?: number;
  /** novas tentativas em erro de rede/timeout/5xx (padrão 1) */
  retries?: number;
  /** base do backoff exponencial entre tentativas, ms (padrão 400) */
  backoffMs?: number;
  /** ignora a leitura do cache em memória (a resposta nova ainda é gravada) */
  noCache?: boolean;
  /** relógio injetável (testes) */
  now?: () => Date;
}

export interface FetchJsonOptions extends SourceOptions {
  /** segundos para `next: { revalidate }` (Data Cache do Next.js) */
  revalidateSec?: number;
  headers?: Record<string, string>;
  /** TTL do cache em memória, s (padrão: revalidateSec ou 300) */
  cacheTtlSec?: number;
  /** quanto tempo após expirar uma cópia ainda pode ser servida se a API falhar, s (padrão: máx(TTL, 1 dia)) */
  staleIfErrorSec?: number;
}

export interface FetchJsonResult<T> {
  data: T;
  /** "live" = buscado agora; "cache" = cache em memória, cópia expirada (API falhou) ou Data Cache do Next */
  status: Extract<SourceStatus, "live" | "cache">;
  fetchedAt: string;
  url: string;
  note?: string;
}

export type SourceErrorKind = "timeout" | "network" | "http" | "parse" | "schema";

export class SourceError extends Error {
  readonly kind: SourceErrorKind;
  readonly status?: number;
  constructor(kind: SourceErrorKind, message: string, status?: number) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.status = status;
  }
  /** rede, timeout e 5xx merecem nova tentativa; 4xx, JSON inválido e formato inesperado não */
  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "network" || (this.kind === "http" && (this.status ?? 0) >= 500);
  }
  get isClientError(): boolean {
    return this.kind === "http" && (this.status ?? 0) >= 400 && (this.status ?? 0) < 500;
  }
}

/** Texto curto (pt-BR) do motivo de uma falha, para notas de procedência */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── Cache em memória ───────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  fetchedAt: string;
  expiresAt: number;
  staleUntil: number;
}
interface FailureEntry {
  error: SourceError;
  until: number;
}

const MAX_CACHE_ENTRIES = 300;
const NEGATIVE_TTL_MS = 60_000;
/** cabeçalho Date mais antigo que isso ⇒ resposta veio de um cache (Data Cache do Next/CDN) */
const UPSTREAM_CACHE_THRESHOLD_MS = 5 * 60_000;

const cache = new Map<string, CacheEntry>();
const failures = new Map<string, FailureEntry>();

/** Esvazia o cache em memória e o cache negativo (testes, ou para forçar nova consulta) */
export function clearSourceCache(): void {
  cache.clear();
  failures.clear();
}

function cacheSet(url: string, entry: CacheEntry): void {
  cache.delete(url);
  cache.set(url, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ─── fetchJson ──────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

function isAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function toSourceError(e: unknown, timeoutMs: number): SourceError {
  if (e instanceof SourceError) return e;
  if (isAbort(e)) return new SourceError("timeout", `tempo esgotado após ${timeoutMs} ms`);
  const cause = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  const detail = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
  return new SourceError("network", `falha de rede (${detail})`);
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "(raiz)"}: ${i.message}`)
    .join("; ");
}

/** Extrai uma mensagem curta do corpo de erro (JSON {message|msg|error} ou texto/HTML) */
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    if (!text) return "";
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const m = j.message ?? j.msg ?? j.error ?? j.reason;
      if (typeof m === "string" && m) return ` — ${m.slice(0, 200)}`;
    } catch {
      /* corpo não é JSON */
    }
    const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return plain ? ` — ${plain.slice(0, 120)}` : "";
  } catch {
    return "";
  }
}

async function attemptOnce<S extends z.ZodType>(
  url: string,
  schema: S,
  fetchImpl: FetchLike,
  timeoutMs: number,
  revalidateSec: number | undefined,
  headers: Record<string, string> | undefined,
): Promise<{ data: z.output<S>; date: string | null }> {
  const init: NextFetchInit = {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (revalidateSec !== undefined) init.next = { revalidate: revalidateSec };

  const res = await fetchImpl(url, init);
  if (!res.ok) {
    throw new SourceError("http", `HTTP ${res.status}${await errorDetail(res)}`, res.status);
  }
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new SourceError("parse", "resposta não é JSON válido");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SourceError("schema", `formato inesperado (${summarizeIssues(parsed.error)})`);
  }
  return { data: parsed.data, date: res.headers.get("date") };
}

/**
 * GET JSON validado. Lança `SourceError` se todas as tentativas falharem e não houver cópia em
 * cache utilizável — as funções públicas capturam e aplicam o fallback.
 */
export async function fetchJson<S extends z.ZodType>(
  url: string,
  schema: S,
  options: FetchJsonOptions = {},
): Promise<FetchJsonResult<z.output<S>>> {
  const { timeoutMs = 8_000, retries = 1, backoffMs = 400, revalidateSec, headers, noCache = false } = options;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, init) => globalThis.fetch(u, init));
  const now = () => (options.now ? options.now() : new Date());
  const ttlSec = options.cacheTtlSec ?? revalidateSec ?? 300;
  const staleSec = options.staleIfErrorSec ?? Math.max(ttlSec, 86_400);

  const staleOrThrow = (err: SourceError, at: number): FetchJsonResult<z.output<S>> => {
    const entry = cache.get(url);
    if (entry && entry.staleUntil > at) {
      return {
        data: entry.data as z.output<S>,
        status: "cache",
        fetchedAt: entry.fetchedAt,
        url,
        note: `API indisponível (${err.message}); usando cópia em cache de ${entry.fetchedAt}`,
      };
    }
    throw err;
  };

  const t0 = now().getTime();
  if (!noCache) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > t0) {
      return { data: hit.data as z.output<S>, status: "cache", fetchedAt: hit.fetchedAt, url };
    }
    const failed = failures.get(url);
    if (failed && failed.until > t0) return staleOrThrow(failed.error, t0);
  }

  let lastError = new SourceError("network", "nenhuma tentativa realizada");
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.25));
    try {
      const { data, date } = await attemptOnce(url, schema, fetchImpl, timeoutMs, revalidateSec, headers);
      const at = now();
      let fetchedAt = at.toISOString();
      let status: FetchJsonResult<unknown>["status"] = "live";
      let note: string | undefined;
      const upstream = date ? Date.parse(date) : NaN;
      if (Number.isFinite(upstream) && at.getTime() - upstream > UPSTREAM_CACHE_THRESHOLD_MS) {
        // O Data Cache do Next.js (ou uma CDN) devolveu uma resposta guardada: o cabeçalho Date
        // preserva o instante da consulta original.
        status = "cache";
        fetchedAt = new Date(upstream).toISOString();
        note = "resposta servida pelo cache de dados do servidor (Next.js/CDN)";
      }
      failures.delete(url);
      cacheSet(url, { data, fetchedAt, expiresAt: at.getTime() + ttlSec * 1000, staleUntil: at.getTime() + (ttlSec + staleSec) * 1000 });
      return { data, status, fetchedAt, url, ...(note ? { note } : {}) };
    } catch (e) {
      lastError = toSourceError(e, timeoutMs);
      if (!lastError.retryable) break;
    }
  }
  const at = now().getTime();
  failures.set(url, { error: lastError, until: at + NEGATIVE_TTL_MS });
  return staleOrThrow(lastError, at);
}

// ─── Procedência ────────────────────────────────────────────────────────────────────────────

/** Junta notas não vazias com "; " */
export function joinNotes(...parts: (string | undefined | false | null)[]): string | undefined {
  const s = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("; ");
  return s || undefined;
}

export function provenance(
  id: string,
  name: string,
  url: string,
  status: SourceStatus,
  note?: string,
  fetchedAt: string = new Date().toISOString(),
): Provenance {
  return { id, name, url, fetchedAt, status, ...(note ? { note } : {}) };
}

/** Procedência a partir do resultado de `fetchJson` (status/fetchedAt/nota de cache) */
export function provenanceFromResult(id: string, name: string, result: FetchJsonResult<unknown>, note?: string): Provenance {
  return provenance(id, name, result.url, result.status, joinNotes(note, result.note), result.fetchedAt);
}

/** Aviso no log do servidor (silencioso nos testes) */
export function warnSource(message: string): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.warn(`[sources] ${message}`);
}

export const DAY_SEC = 86_400;
