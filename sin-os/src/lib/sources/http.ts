import type { Probe } from "./types";

/**
 * Cliente HTTP instrumentado: timeout, retry com backoff exponencial para
 * falhas transitórias (rede, 429, 5xx) e telemetria de cada tentativa.
 * A telemetria alimenta o agente auditor (latência real observada em produção).
 */

const UA = "SIN-OS/1.0 (energy-market-terminal)";
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

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<{ text: string; probes: Probe[] }> {
  const { timeoutMs = 20_000, retries = 2, headers = {} } = opts;
  const probes: Probe[] = [];
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let text = "";
    let probe: Probe;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json, text/csv, */*", ...headers },
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
        error: res.ok ? undefined : `HTTP ${res.status}: ${text.slice(0, 160)}`,
      };
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
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
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
