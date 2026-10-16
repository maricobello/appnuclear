import type { Region, SourceId, SourceMeta, SourceResult } from "../sources/types";

/**
 * Estado ao vivo de cada fonte, do ponto de vista de quem usa o app: vem das mesmas buscas que as
 * telas fazem (com o cache de 1 min), não da última execução do auditor. Assim "APIs conectadas"
 * não depende do horário da auditoria nem do Firebase.
 *   live    — dado atual, fonte primária
 *   alt     — dado real por caminho alternativo (ex.: PLD calculado pelo CMO do ONS)
 *   stale   — respondeu, mas a última observação passou do prazo de frescor da fonte
 *   down    — falhou (ou só haveria dado simulado)
 *   off     — opcional e não configurada (chave ou credencial ausente)
 *   pending — não respondeu dentro do prazo desta consulta
 */
export type LiveState = "live" | "alt" | "stale" | "down" | "off" | "pending";

export interface LiveSource {
  id: SourceId;
  name: string;
  provider: string;
  region: Region;
  state: LiveState;
  /** Última observação contida no dado (não a hora da coleta). */
  latestTs: number | null;
  /** Hora em que o app buscou o dado. */
  fetchedAt: number | null;
  /** Latência da última chamada à fonte. */
  latencyMs: number | null;
  note: string | null;
}

export interface LiveStatus {
  generatedAt: number;
  sources: LiveSource[];
  counts: Record<LiveState, number>;
  /** Última execução do auditor (pode estar indisponível sem o Firebase). */
  audit: { score: number; at: number } | null;
}

const NOT_CONFIGURED = /não configurad|_API_KEY|sem credencial/i;

/** Primeira parte de uma mensagem longa ("… — detalhe técnico") em até 140 caracteres. */
export function shortNote(s: string | null | undefined): string | null {
  if (!s) return null;
  const head = s.split(" — ")[0].trim();
  return head.length > 140 ? `${head.slice(0, 139)}…` : head;
}

export function liveSource(meta: SourceMeta, r: SourceResult<unknown> | null | undefined, now = Date.now()): LiveSource {
  const base = { id: meta.id, name: meta.name, provider: meta.provider, region: meta.region };
  if (!r) return { ...base, state: "pending", latestTs: null, fetchedAt: null, latencyMs: null, note: "não respondeu a tempo nesta consulta" };
  const latencyMs = r.probes.length ? r.probes[r.probes.length - 1].latencyMs : null;
  const latestTs = r.quality?.latestTs ?? null;
  const common = { ...base, latestTs: r.simulated ? null : latestTs, fetchedAt: r.fetchedAt ?? null, latencyMs };
  if (!r.ok && NOT_CONFIGURED.test(r.error ?? "")) return { ...common, state: "off", note: shortNote(r.error) };
  if (r.simulated || !r.ok) return { ...common, state: "down", note: shortNote(r.error ?? r.fallback ?? "falha na fonte") };
  if (r.fallback) return { ...common, state: "alt", note: shortNote(r.fallback) };
  if (latestTs !== null && now - latestTs > meta.freshnessSlaHours * 3600_000) {
    const h = Math.round((now - latestTs) / 3600_000);
    return { ...common, state: "stale", note: `última observação há ${h} h (o esperado é até ${meta.freshnessSlaHours} h)` };
  }
  return { ...common, state: "live", note: shortNote(r.note) };
}

export function liveStatus(list: SourceMeta[], results: Partial<Record<SourceId, SourceResult<unknown> | null>>, audit: LiveStatus["audit"], now = Date.now()): LiveStatus {
  const sources = list.map((m) => liveSource(m, results[m.id], now));
  const counts = { live: 0, alt: 0, stale: 0, down: 0, off: 0, pending: 0 } as Record<LiveState, number>;
  for (const s of sources) counts[s.state]++;
  return { generatedAt: now, sources, counts, audit };
}
