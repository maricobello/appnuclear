import type { Probe } from "./types";

/**
 * Cliente HTTP instrumentado: timeout, retry com backoff exponencial para
 * falhas transitórias (rede, 429, 5xx) e telemetria de cada tentativa.
 * 429 respeita Retry-After. A telemetria alimenta o agente auditor (latência
 * real observada em produção).
 */

// identificação honesta, com contato — nunca se passa por navegador
const UA = "SIN-OS/1.0 (+https://github.com/maricobello/sinos)";
const RETRY_AFTER_MAX_MS = 8_000;
const RING_MAX = 500;

type GlobalWithTelemetry = typeof globalThis & { __sinTelemetry?: Probe[] };
const g = globalThis as GlobalWithTelemetry;
g.__sinTelemetry ??= [];

export function recentTelemetry(): Probe[] {
  return g.__sinTelemetry!.slice();
}

function record(p: Probe) {
  const ring = g.__sinTelemetry!;
  ring.push(p);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

export class HttpError extends Error {
  constructor(
    message: string,
    public probes: Probe[],
  ) {
    super(message);
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const redact = (url: string) => url.replace(/(api_key|apikey|token|securityToken)=[^&]+/gi, "$1=***");

/** Inclui a causa raiz (undici encapsula ECONNREFUSED, 403 do proxy, TLS etc. em `cause`). */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const detail = cause ? ` (${[cause.code, cause.message].filter(Boolean).join(": ")})` : "";
  return `${e.name}: ${e.message}${detail}`;
}

/**
 * Resumo legível do corpo de erro. Páginas HTML (WAF, CDN) viram o <title> mais o
 * código do erro e o IP que a página de bloqueio mostra — é o que o provedor pede
 * para abrir chamado. Sem esses dados, inclui o trecho final do texto da página.
 */
export function errorSnippet(text: string): string {
  const t = text.trim();
  if (!(/^<(!doctype|html)/i.test(t) || /<\/(head|body|html)>/i.test(t))) return t.slice(0, 200);
  const clean = (x: string) => x.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const title = clean(/<title[^>]*>([^<]*)<\/title>/i.exec(t)?.[1] ?? "");
  const body = clean(
    t.replace(/<head[\s\S]*?<\/head>/i, " ").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "),
  );
  const code = [...body.matchAll(/(?:error\s*code|c[óo]digo(?:\s+do\s+erro)?)\W{0,3}([\w-]+)/gi)].map((m) => m[1]).find((x) => /\d/.test(x));
  const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(body)?.[0] ?? /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/i.exec(body)?.[0];
  const ids = [code && `Error Code ${code}`, ip && `IP ${ip}`].filter(Boolean).join(" · ");
  if (ids) return `${title || "HTML"} (${ids})`;
  // sem código/IP reconhecíveis: o fim da página costuma trazer os detalhes
  return title ? `${title} — ${body.length > 250 ? "…" : ""}${body.slice(-250)}` : body.slice(0, 300);
}

/** Espera sugerida por Retry-After (segundos ou data HTTP), limitada; null se ausente. */
export function retryAfterMs(h: string | null, now = Date.now()): number | null {
  if (!h) return null;
  const secs = Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - now;
  return Number.isFinite(ms) ? Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms)) : null;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<{ text: string; probes: Probe[] }> {
  const { timeoutMs = 20_000, retries = 2, headers = {} } = opts;
  const probes: Probe[] = [];
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let text = "";
    let probe: Probe;
    let wait: number | null = null;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json, text/csv, */*", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      text = await res.text();
      probe = {
        url: redact(url),
        ok: res.ok,
        status: res.status,
        latencyMs: Date.now() - t0,
        bytes: text.length,
        at: t0,
        error: res.ok ? undefined : `HTTP ${res.status}: ${errorSnippet(text)}`,
      };
      if (res.status === 429) wait = retryAfterMs(res.headers.get("retry-after")) ?? 1500 * 2 ** attempt;
    } catch (e) {
      probe = {
        url: redact(url),
        ok: false,
        status: null,
        latencyMs: Date.now() - t0,
        bytes: 0,
        at: t0,
        error: describeError(e),
      };
    }
    record(probe);
    probes.push(probe);
    if (probe.ok) return { text, probes };
    const retryable = probe.status === null || probe.status === 429 || probe.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(probe.error ?? "falha HTTP", probes);
    await new Promise((r) => setTimeout(r, wait ?? 400 * 2 ** attempt));
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<{ json: T; probes: Probe[] }> {
  const { text, probes } = await fetchText(url, opts);
  try {
    return { json: JSON.parse(text) as T, probes };
  } catch {
    throw new HttpError(`Resposta não é JSON válido: ${text.slice(0, 80)}`, probes);
  }
}

export function probesOf(e: unknown): Probe[] {
  return e instanceof HttpError ? e.probes : [];
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
