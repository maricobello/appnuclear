import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { clearFirestoreError, firestore, firestoreCoolingDown, firestoreHealthy, reportFirestoreError } from "./firebase";
import type { AgentReport, AuditRun } from "./audit/types";
import type { DayDigest, Revision, TrustSourceId } from "./audit/trust";
import { memoryZoneStore, type ZoneSnapshot, type ZoneStore } from "./sources/europe";
import { SUBS, type Sub } from "./sources/types";

/**
 * Persistência: Firestore quando configurado e saudável; memória do processo como
 * fallback (não durável — a UI avisa). Uma falha do Firestore (API desativada, banco
 * inexistente, cota) nunca derruba a rota: a operação cai para a memória e o erro
 * aparece em /api/status e na tela do auditor. Coleções:
 *   audit_runs/{id}       execuções do auditor (sem séries brutas)
 *   agent_reports/{id}    relatórios do agente IA
 *   pld_days/{YYYY-MM-DD} PLD horário por submercado — histórico próprio e
 *                         "last known good" se a CCEE ficar fora do ar
 *   eu_prices/{zona}      último download day-ahead por zona (a API limita a 2 req/min;
 *                         as instâncias compartilham o que já foi baixado)
 */
export interface PldDay {
  date: string;
  values: Record<Sub, number[]>;
  source: string;
}

// persisted: data → fonte já gravada no Firestore (evita reler os mesmos dias a cada requisição)
type Mem = { runs: AuditRun[]; reports: AgentReport[]; pld: Map<string, PldDay>; persisted: Map<string, string>; trust: Map<string, DayDigest>; revisions: Revision[]; docs: Map<string, unknown> };
const g = globalThis as typeof globalThis & { __sinMem?: Mem };
g.__sinMem ??= { runs: [], reports: [], pld: new Map(), persisted: new Map(), trust: new Map(), revisions: [], docs: new Map() };
g.__sinMem.docs ??= new Map();
g.__sinMem.persisted ??= new Map();
g.__sinMem.trust ??= new Map();
g.__sinMem.revisions ??= [];
const mem = g.__sinMem;

async function withDb<T>(op: (db: Firestore) => Promise<T>, fallback: () => T): Promise<T> {
  const db = firestore();
  if (!db || firestoreCoolingDown()) return fallback();
  try {
    const v = await op(db);
    clearFirestoreError();
    return v;
  } catch (e) {
    reportFirestoreError(e);
    return fallback();
  }
}

export const storageKind = (): "firestore" | "memory" => (firestoreHealthy() ? "firestore" : "memory");

/**
 * Listas lidas com frequência (menu lateral e home consultam a auditoria a cada minuto, em cada
 * aba) ficam alguns minutos na memória da instância: a mesma pergunta não volta ao Firestore. O
 * que esta instância grava entra no cache na hora. Se o Firestore falhar, vale a última lista
 * conhecida (mais o que esta instância gravou), em vez de uma lista vazia.
 */
type ListCache<T> = Map<number, { at: number; items: T[] }>;
const RECENT_TTL_MS = 2 * 60_000;
const HISTORY_TTL_MS = 10 * 60_000;
const runsCache: ListCache<AuditRun> = new Map();
const reportsCache: ListCache<AgentReport> = new Map();

function fromCache<T>(cache: ListCache<T>, limit: number, ttl: number, now = Date.now()): T[] | null {
  for (const [n, c] of cache) if (n >= limit && now - c.at < ttl) return c.items.slice(0, limit);
  return null;
}

/** A maior lista guardada, mesmo vencida, unida ao que esta instância gravou (sem repetir). */
function lastKnown<T>(cache: ListCache<T>, local: T[], key: (x: T) => string, order: (x: T) => number, limit: number): T[] {
  const stale = [...cache.values()].sort((a, b) => b.items.length - a.items.length)[0]?.items ?? [];
  const seen = new Set<string>();
  return [...local, ...stale]
    .filter((x) => !seen.has(key(x)) && !!seen.add(key(x)))
    .sort((a, b) => order(b) - order(a))
    .slice(0, limit);
}

function pushToCache<T>(cache: ListCache<T>, item: T, key: (x: T) => string) {
  for (const c of cache.values()) c.items = [item, ...c.items.filter((x) => key(x) !== key(item))];
}

const runId = (r: AuditRun) => r.id;
const reportId = (r: AgentReport) => r.id;

/** Só para testes: esvazia os caches de listas desta instância. */
export function clearListCachesForTests() {
  runsCache.clear();
  reportsCache.clear();
  revisionsCache.at = 0;
  revisionsCache.items = [];
  euLoadedAt = 0;
}

export async function saveAuditRun(run: AuditRun): Promise<void> {
  mem.runs.unshift(run);
  mem.runs.splice(200);
  pushToCache(runsCache, run, runId);
  await withDb((db) => db.collection("audit_runs").doc(run.id).set(run).then(() => undefined), () => undefined);
}

export async function listAuditRuns(limit = 20): Promise<AuditRun[]> {
  const hit = fromCache(runsCache, limit, limit > 1 ? HISTORY_TTL_MS : RECENT_TTL_MS);
  if (hit) return hit;
  return withDb(
    async (db) => {
      const snap = await db.collection("audit_runs").orderBy("startedAt", "desc").limit(limit).get();
      const runs = snap.docs.map((d) => d.data() as AuditRun);
      runsCache.set(limit, { at: Date.now(), items: runs });
      return runs;
    },
    () => lastKnown(runsCache, mem.runs, runId, (r) => r.startedAt, limit),
  );
}

export async function saveAgentReport(r: AgentReport): Promise<void> {
  mem.reports.unshift(r);
  mem.reports.splice(50);
  pushToCache(reportsCache, r, reportId);
  await withDb((db) => db.collection("agent_reports").doc(r.id).set(r).then(() => undefined), () => undefined);
}

export async function listAgentReports(limit = 5): Promise<AgentReport[]> {
  const hit = fromCache(reportsCache, limit, HISTORY_TTL_MS);
  if (hit) return hit;
  return withDb(
    async (db) => {
      const snap = await db.collection("agent_reports").orderBy("createdAt", "desc").limit(limit).get();
      const reports = snap.docs.map((d) => d.data() as AgentReport);
      reportsCache.set(limit, { at: Date.now(), items: reports });
      return reports;
    },
    () => lastKnown(reportsCache, mem.reports, reportId, (r) => r.createdAt, limit),
  );
}

/** Oficial (CCEE) substitui estimado (CMO do ONS limitado); nunca o contrário. */
const sourceRank = (s: string | undefined) => (s === "ccee" ? 2 : s ? 1 : 0);

/** meta/{PLD_OFFICIAL_MARK}.updatedAt muda sempre que um dia oficial é gravado. */
export const PLD_OFFICIAL_MARK = "pld_official";

/** Grava dias completos de PLD ainda não persistidos ou só estimados (idempotente). */
export async function savePldDays(days: PldDay[]): Promise<number> {
  for (const d of days) {
    if (sourceRank(d.source) >= sourceRank(mem.pld.get(d.date)?.source)) mem.pld.set(d.date, d);
  }
  const pending = days.filter((d) => sourceRank(d.source) > sourceRank(mem.persisted.get(d.date)));
  if (!pending.length) return 0;
  return withDb(
    async (db) => {
      const refs = pending.map((d) => db.collection("pld_days").doc(d.date));
      const existing = await db.getAll(...refs);
      const batch = db.batch();
      const kept: [string, string][] = [];
      let written = 0;
      let official = false;
      existing.forEach((snap, i) => {
        const d = pending[i];
        const current = snap.exists ? ((snap.get("source") as string | undefined) ?? "ccee") : undefined;
        if (sourceRank(d.source) > sourceRank(current)) {
          batch.set(refs[i], d);
          written++;
          official ||= d.source === "ccee";
          kept.push([d.date, d.source]);
        } else kept.push([d.date, current!]);
      });
      // marca de versão: as outras instâncias só releem os dias oficiais quando ela muda
      if (official) batch.set(db.collection("meta").doc(PLD_OFFICIAL_MARK), { updatedAt: Date.now() });
      if (written) await batch.commit();
      for (const [date, source] of kept) mem.persisted.set(date, source);
      return written;
    },
    () => 0,
  );
}

export async function loadPldDays(n = 120): Promise<PldDay[]> {
  return withDb(
    async (db) => {
      const snap = await db.collection("pld_days").orderBy("date", "desc").limit(n).get();
      return snap.docs.map((d) => d.data() as PldDay).reverse();
    },
    () => [...mem.pld.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-n),
  );
}

export const isCompleteDay = (v: Record<Sub, (number | null)[]>) =>
  SUBS.every((s) => v[s].length === 24 && v[s].every((x) => x !== null && Number.isFinite(x)));

/**
 * Preços europeus: a memória da instância responde e o Firestore (as 12 zonas, 12 leituras) só é
 * relido a cada 15 min, para pegar o que outras instâncias baixaram. O day-ahead muda 1x por dia.
 */
const EU_RELOAD_MS = 15 * 60_000;
let euLoadedAt = 0;
export const euZoneStore: ZoneStore = {
  load: async () => {
    const local = await memoryZoneStore.load();
    if (local.length && Date.now() - euLoadedAt < EU_RELOAD_MS) return local;
    euLoadedAt = Date.now();
    const fromDb = await withDb(
      async (db) => (await db.collection("eu_prices").get()).docs.map((d) => d.data() as ZoneSnapshot),
      () => [] as ZoneSnapshot[],
    );
    const have = new Map(local.map((z) => [z.bzn, z.fetchedAt]));
    for (const z of fromDb) if (z.fetchedAt > (have.get(z.bzn) ?? 0)) await memoryZoneStore.save(z);
    return memoryZoneStore.load();
  },
  save: async (z) => {
    await memoryZoneStore.save(z);
    await withDb((db) => db.collection("eu_prices").doc(z.bzn).set(z).then(() => undefined), () => undefined);
  },
};

const slots = new Map<string, number>();
/**
 * Trava de taxa global (entre instâncias) via transação no Firestore: devolve true e
 * registra o horário se a última reserva de `key` tem mais de `minIntervalMs`. Sem
 * Firestore, vale só para esta instância. Se esta instância já reservou dentro do intervalo,
 * responde não sem consultar o Firestore.
 */
export async function claimSlot(key: string, minIntervalMs: number, now = Date.now()): Promise<boolean> {
  if (now - (slots.get(key) ?? 0) < minIntervalMs) return false;
  const local = () => {
    slots.set(key, now);
    return true;
  };
  return withDb(
    async (db) => {
      const ok = await db.runTransaction(async (tx) => {
        const ref = db.collection("meta").doc(`slot_${key}`);
        const last = Number((await tx.get(ref)).data()?.at ?? 0);
        if (now - last < minIntervalMs) return false;
        tx.set(ref, { at: now });
        return true;
      });
      if (ok) slots.set(key, now);
      return ok;
    },
    local,
  );
}

const quotas = new Map<string, number>();
/**
 * Cota diária global (entre instâncias, via transação no Firestore; sem Firestore, por
 * instância): consome 1 unidade de `key` no dia UTC e recusa quando `limit` já foi usado.
 * Teto de custo para APIs pagas (assistente de IA) num site público.
 */
export async function takeDailyQuota(key: string, limit: number, now = Date.now()): Promise<{ ok: boolean; used: number }> {
  const id = `${key}_${new Date(now).toISOString().slice(0, 10)}`;
  const local = () => {
    const used = quotas.get(id) ?? 0;
    if (used >= limit) return { ok: false, used };
    quotas.set(id, used + 1);
    return { ok: true, used: used + 1 };
  };
  return withDb(
    (db) =>
      db.runTransaction(async (tx) => {
        const ref = db.collection("meta").doc(`quota_${id}`);
        const used = Number((await tx.get(ref)).data()?.n ?? 0);
        if (used >= limit) return { ok: false, used };
        tx.set(ref, { n: used + 1, at: now });
        return { ok: true, used: used + 1 };
      }),
    local,
  );
}

/**
 * Camada de confiança (ver audit/trust.ts): impressão digital por fonte/dia fechado e o
 * registro das revisões retroativas detectadas.
 *   trust_days/{fonte}_{data}   última impressão digital vista (com os valores, ~100 números)
 *   trust_revisions/{id}        cada vez que um dia fechado reapareceu diferente
 */
const trustId = (source: string, date: string) => `${source}_${date}`;

export async function loadTrustDays(source: TrustSourceId, dates: string[]): Promise<Map<string, DayDigest>> {
  const out = new Map<string, DayDigest>();
  if (!dates.length) return out;
  const local = () => {
    for (const d of dates) {
      const v = mem.trust.get(trustId(source, d));
      if (v) out.set(d, v);
    }
    return out;
  };
  return withDb(async (db) => {
    const snaps = await db.getAll(...dates.map((d) => db.collection("trust_days").doc(trustId(source, d))));
    snaps.forEach((snap, i) => {
      if (snap.exists) out.set(dates[i], snap.data() as DayDigest);
    });
    return out;
  }, local);
}

export async function saveTrustDays(list: DayDigest[]): Promise<void> {
  for (const d of list) mem.trust.set(trustId(d.source, d.date), d);
  if (!list.length) return;
  await withDb(async (db) => {
    const batch = db.batch();
    for (const d of list) batch.set(db.collection("trust_days").doc(trustId(d.source, d.date)), d);
    await batch.commit();
  }, () => undefined);
}

export async function saveRevisions(list: Revision[]): Promise<void> {
  mem.revisions.unshift(...list);
  mem.revisions.splice(500);
  if (!list.length) return;
  if (revisionsCache.at) revisionsCache.items = [...list, ...revisionsCache.items].sort((a, b) => b.detectedAt - a.detectedAt);
  await withDb(async (db) => {
    const batch = db.batch();
    for (const r of list) batch.set(db.collection("trust_revisions").doc(`${r.source}_${r.date}_${r.detectedAt}`), r);
    await batch.commit();
  }, () => undefined);
}

/** O painel de confiança pede as revisões de 30 dias a cada 5 min: a lista fica 30 min na memória. */
const REVISIONS_TTL_MS = 30 * 60_000;
const revisionsCache: { at: number; since: number; limit: number; items: Revision[] } = { at: 0, since: 0, limit: 0, items: [] };

export async function listRevisions(sinceMs: number, limit = 200): Promise<Revision[]> {
  const c = revisionsCache;
  const pick = (list: Revision[]) => list.filter((r) => r.detectedAt >= sinceMs).slice(0, limit);
  if (c.at && Date.now() - c.at < REVISIONS_TTL_MS && sinceMs >= c.since && limit <= c.limit) return pick(c.items);
  return withDb(
    async (db) => {
      const snap = await db.collection("trust_revisions").where("detectedAt", ">=", sinceMs).orderBy("detectedAt", "desc").limit(limit).get();
      const items = snap.docs.map((d) => d.data() as Revision);
      Object.assign(revisionsCache, { at: Date.now(), since: sinceMs, limit, items });
      return items;
    },
    () => pick(c.items.length ? c.items : mem.revisions),
  );
}

/** Documento genérico (cache persistente de agregados): Firestore quando há, memória senão. */
export async function loadDoc<T>(collection: string, id: string): Promise<T | null> {
  const local = () => (mem.docs.get(`${collection}/${id}`) as T | undefined) ?? null;
  const hit = local();
  if (hit) return hit;
  return withDb(
    async (db) => {
      const v = ((await db.collection(collection).doc(id).get()).data() as T | undefined) ?? null;
      if (v) mem.docs.set(`${collection}/${id}`, v);
      return v;
    },
    () => null,
  );
}

/** Leitura sempre fresca de um documento (1 leitura); sem Firestore, o que houver na memória. */
export async function readDoc<T>(collection: string, id: string): Promise<T | null> {
  return withDb(
    async (db) => ((await db.collection(collection).doc(id).get()).data() as T | undefined) ?? null,
    () => (mem.docs.get(`${collection}/${id}`) as T | undefined) ?? null,
  );
}

export async function saveDoc<T extends object>(collection: string, id: string, doc: T): Promise<void> {
  mem.docs.set(`${collection}/${id}`, doc);
  await withDb((db) => db.collection(collection).doc(id).set(doc).then(() => undefined), () => undefined);
}
