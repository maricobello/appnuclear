import { errMsg, fetchJson, probesOf } from "./http";
import { isoDay } from "./time";
import { emptyQuality, type Probe, type SourceResult, type TimeSeries } from "./types";

/**
 * Energy-Charts API (Fraunhofer ISE) — preços day-ahead das zonas de licitação
 * europeias (resolução de 15 min desde o MTU de 15 min do SDAC, out/2025). Sem chave.
 * Licença CC BY 4.0. https://api.energy-charts.info
 */
export const EC_BASE = "https://api.energy-charts.info";

export const EU_ZONES = [
  { bzn: "DE-LU", name: "Alemanha-Lux." },
  { bzn: "FR", name: "França" },
  { bzn: "NL", name: "Holanda" },
  { bzn: "BE", name: "Bélgica" },
  { bzn: "AT", name: "Áustria" },
  { bzn: "CH", name: "Suíça" },
  { bzn: "PL", name: "Polônia" },
  { bzn: "DK1", name: "Dinamarca O." },
  { bzn: "NO2", name: "Noruega S." },
  { bzn: "SE4", name: "Suécia S." },
  { bzn: "ES", name: "Espanha" },
  { bzn: "IT-North", name: "Itália N." },
] as const;

export interface EcPrice {
  unix_seconds: number[];
  price?: (number | null)[];
  data?: (number | null)[];
  unit?: string;
  license_info?: string;
}

export type ZonePrices = Record<string, TimeSeries & { name: string }>;

/** Zona já baixada — guardada em memória ou no Firestore (coleção eu_prices). */
export interface ZoneSnapshot {
  bzn: string;
  name: string;
  ts: number[];
  values: number[];
  unit: string;
  fetchedAt: number;
}

export interface ZoneStore {
  load(): Promise<ZoneSnapshot[]>;
  save(z: ZoneSnapshot): Promise<void>;
}

type EcState = { zones: Map<string, ZoneSnapshot>; calls: number[]; cooldownUntil: number };
const g = globalThis as typeof globalThis & { __sinEc?: EcState };
g.__sinEc ??= { zones: new Map(), calls: [], cooldownUntil: 0 };
const ec = g.__sinEc;

export const memoryZoneStore: ZoneStore = {
  load: async () => [...ec.zones.values()],
  save: async (z) => void ec.zones.set(z.bzn, z),
};

/** Limite publicado da rota /price: 2 requisições por minuto por IP (burst 2). */
export const EC_PRICE_RATE = { perMinute: 2 } as const;
const MAX_AGE_MS = 2 * 3600_000; // day-ahead muda 1x/dia; 2 h basta para pegar a publicação de D+1
const WINDOW_BACK_DAYS = 8;

/** Libera até `want` chamadas dentro do limite da API (janela deslizante de 60 s, por instância). */
function takeCalls(want: number, now = Date.now()): number {
  if (now < ec.cooldownUntil) return 0;
  ec.calls = ec.calls.filter((t) => now - t < 60_000);
  return Math.max(0, Math.min(want, EC_PRICE_RATE.perMinute - ec.calls.length));
}

export function resetEcThrottle() {
  ec.calls = [];
  ec.cooldownUntil = 0;
  ec.zones.clear();
}

async function downloadZone(z: (typeof EU_ZONES)[number], now: number): Promise<{ snap: ZoneSnapshot | null; probes: Probe[]; issue?: string; invalid: number; duplicates: number }> {
  const start = isoDay(now - WINDOW_BACK_DAYS * 86400_000);
  const end = isoDay(now + 2 * 86400_000);
  ec.calls.push(Date.now());
  // sem retry: uma nova tentativa dentro do mesmo minuto só consome a cota
  const { json: j, probes } = await fetchJson<EcPrice>(`${EC_BASE}/price?bzn=${encodeURIComponent(z.bzn)}&start=${start}&end=${end}`, { retries: 0 });
  const arr = j.price ?? j.data;
  if (!Array.isArray(j.unix_seconds) || !Array.isArray(arr) || arr.length !== j.unix_seconds.length) {
    return { snap: null, probes, issue: `${z.bzn}: arrays unix_seconds/price ausentes ou desalinhados`, invalid: 0, duplicates: 0 };
  }
  const ts: number[] = [];
  const values: number[] = [];
  const seen = new Set<number>();
  let invalid = 0;
  let duplicates = 0;
  j.unix_seconds.forEach((s, i) => {
    const v = arr[i];
    if (v === null || !Number.isFinite(v)) { invalid++; return; }
    if (seen.has(s)) { duplicates++; return; }
    seen.add(s);
    ts.push(s * 1000);
    values.push(v);
  });
  return { snap: { bzn: z.bzn, name: z.name, ts, values, unit: j.unit ?? "EUR/MWh", fetchedAt: Date.now() }, probes, invalid, duplicates };
}

export interface EuFetchOpts {
  store?: ZoneStore;
  /** Força ao menos uma chamada ao vivo (auditoria mede disponibilidade real). */
  probe?: boolean;
}

/**
 * Preços day-ahead de 12 zonas respeitando o limite de 2 req/min da API: cada chamada
 * atualiza no máximo as 2 zonas mais antigas e devolve todas a partir do armazenamento
 * (Firestore quando configurado). Em 429 a instância entra em espera e não re-tenta.
 */
export async function fetchEuPrices(daysBack = 7, opts: EuFetchOpts = {}): Promise<SourceResult<ZonePrices>> {
  const store = opts.store ?? memoryZoneStore;
  const now = Date.now();
  const probes: Probe[] = [];
  const quality = emptyQuality();
  const errors: string[] = [];

  const stored = new Map((await store.load().catch(() => [] as ZoneSnapshot[])).map((z) => [z.bzn, z]));
  const byAge = [...EU_ZONES].sort((a, b) => (stored.get(a.bzn)?.fetchedAt ?? 0) - (stored.get(b.bzn)?.fetchedAt ?? 0));
  const stale = byAge.filter((z) => now - (stored.get(z.bzn)?.fetchedAt ?? 0) > MAX_AGE_MS);
  const queue = stale.length ? stale : opts.probe ? byAge.slice(0, 1) : [];
  const budget = takeCalls(queue.length);

  for (const z of queue.slice(0, budget)) {
    try {
      const r = await downloadZone(z, now);
      probes.push(...r.probes);
      quality.invalid += r.invalid;
      quality.duplicates += r.duplicates;
      if (r.issue) quality.schemaIssues.push(r.issue);
      if (r.snap?.ts.length) {
        stored.set(z.bzn, r.snap);
        await store.save(r.snap).catch(() => undefined);
      }
    } catch (e) {
      probes.push(...probesOf(e));
      errors.push(`${z.bzn}: ${errMsg(e)}`);
      if (probesOf(e).some((p) => p.status === 429)) {
        ec.cooldownUntil = Date.now() + 60_000;
        break;
      }
    }
  }

  const cutoff = now - daysBack * 86400_000;
  const out: ZonePrices = {};
  for (const z of EU_ZONES) {
    const snap = stored.get(z.bzn);
    if (!snap) continue;
    const i0 = snap.ts.findIndex((t) => t >= cutoff);
    if (i0 < 0) continue;
    out[z.bzn] = { ts: snap.ts.slice(i0), values: snap.values.slice(i0), unit: snap.unit, name: z.name };
  }
  const zones = Object.values(out);
  if (!zones.length) {
    return { id: "energy_charts", ok: false, data: null, error: errors.join(" | ") || "nenhuma zona carregada ainda (limite de 2 req/min da API)", probes, quality, simulated: false, fetchedAt: now };
  }
  quality.points = zones.reduce((s, z) => s + z.values.length, 0);
  quality.latestTs = Math.max(...zones.map((z) => z.ts[z.ts.length - 1] ?? 0));
  quality.values = zones.flatMap((z) => z.values.slice(-96));
  quality.range = [-500, 4000]; // harmonised min/max clearing price SDAC
  if (errors.length) quality.schemaIssues.push(...errors.map((e) => `zona não atualizada — ${e}`));
  const missing = EU_ZONES.filter((z) => !out[z.bzn]).map((z) => z.bzn);
  if (missing.length) quality.schemaIssues.push(`${missing.length} zona(s) aguardando carga (2 req/min): ${missing.join(", ")}`);
  return { id: "energy_charts", ok: true, data: out, probes, quality, simulated: false, fetchedAt: now };
}
