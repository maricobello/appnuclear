/**
 * Cache em memória com TTL, deduplicação de requisições em voo e
 * "stale-if-error": se a origem falhar, serve o último valor bom (marcado).
 * Em Vercel (Fluid Compute) instâncias são reutilizadas entre requisições,
 * então o cache reduz drasticamente chamadas às APIs públicas.
 */
interface Entry<T> {
  value: T;
  at: number;
  expires: number;
}

type G = typeof globalThis & { __sinCache?: Map<string, Entry<unknown>>; __sinInflight?: Map<string, Promise<unknown>> };
const g = globalThis as G;
g.__sinCache ??= new Map();
g.__sinInflight ??= new Map();
const store = g.__sinCache;
const inflight = g.__sinInflight;

export interface CachedMeta {
  cacheHit: boolean;
  stale: boolean;
  ageMs: number;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { staleIfErrorMs?: number; isGood?: (v: T) => boolean } = {},
): Promise<{ value: T; meta: CachedMeta }> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return { value: hit.value, meta: { cacheHit: true, stale: false, ageMs: now - hit.at } };

  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  try {
    const value = await p;
    const good = opts.isGood ? opts.isGood(value) : true;
    if (good) store.set(key, { value, at: Date.now(), expires: Date.now() + ttlMs });
    else if (hit && now - hit.at < (opts.staleIfErrorMs ?? 6 * 3600_000)) {
      return { value: hit.value, meta: { cacheHit: true, stale: true, ageMs: now - hit.at } };
    }
    return { value, meta: { cacheHit: false, stale: false, ageMs: 0 } };
  } catch (e) {
    if (hit && now - hit.at < (opts.staleIfErrorMs ?? 6 * 3600_000)) {
      return { value: hit.value, meta: { cacheHit: true, stale: true, ageMs: now - hit.at } };
    }
    throw e;
  }
}

export function invalidate(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
