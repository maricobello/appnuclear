import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { clearFirestoreError, firestore, firestoreHealthy, reportFirestoreError } from "./firebase";
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
type Mem = { runs: AuditRun[]; reports: AgentReport[]; pld: Map<string, PldDay>; persisted: Map<string, string>; trust: Map<string, DayDigest>; revisions: Revision[] };
const g = globalThis as typeof globalThis & { __sinMem?: Mem };
g.__sinMem ??= { runs: [], reports: [], pld: new Map(), persisted: new Map(), trust: new Map(), revisions: [] };
g.__sinMem.persisted ??= new Map();
g.__sinMem.trust ??= new Map();
g.__sinMem.revisions ??= [];
const mem = g.__sinMem;

async function withDb<T>(op: (db: Firestore) => Promise<T>, fallback: () => T): Promise<T> {
  const db = firestore();
  if (!db) return fallback();
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

export async function saveAuditRun(run: AuditRun): Promise<void> {
  mem.runs.unshift(run);
  mem.runs.splice(200);
  await withDb((db) => db.collection("audit_runs").doc(run.id).set(run).then(() => undefined), () => undefined);
}

export async function listAuditRuns(limit = 20): Promise<AuditRun[]> {
  return withDb(
    async (db) => {
      const snap = await db.collection("audit_runs").orderBy("startedAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as AuditRun);
    },
    () => mem.runs.slice(0, limit),
  );
}

export async function saveAgentReport(r: AgentReport): Promise<void> {
  mem.reports.unshift(r);
  mem.reports.splice(50);
  await withDb((db) => db.collection("agent_reports").doc(r.id).set(r).then(() => undefined), () => undefined);
}

export async function listAgentReports(limit = 5): Promise<AgentReport[]> {
  return withDb(
    async (db) => {
      const snap = await db.collection("agent_reports").orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as AgentReport);
    },
    () => mem.reports.slice(0, limit),
  );
}

/** Oficial (CCEE) substitui estimado (CMO do ONS limitado); nunca o contrário. */
const sourceRank = (s: string | undefined) => (s === "ccee" ? 2 : s ? 1 : 0);

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
      existing.forEach((snap, i) => {
        const d = pending[i];
        const current = snap.exists ? ((snap.get("source") as string | undefined) ?? "ccee") : undefined;
        if (sourceRank(d.source) > sourceRank(current)) {
          batch.set(refs[i], d);
          written++;
          kept.push([d.date, d.source]);
        } else kept.push([d.date, current!]);
      });
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

export const euZoneStore: ZoneStore = {
  load: () =>
    withDb(
      async (db) => (await db.collection("eu_prices").get()).docs.map((d) => d.data() as ZoneSnapshot),
      () => [],
    ).then(async (fromDb) => (fromDb.length ? fromDb : memoryZoneStore.load())),
  save: async (z) => {
    await memoryZoneStore.save(z);
    await withDb((db) => db.collection("eu_prices").doc(z.bzn).set(z).then(() => undefined), () => undefined);
  },
};

const slots = new Map<string, number>();
/**
 * Trava de taxa global (entre instâncias) via transação no Firestore: devolve true e
 * registra o horário se a última reserva de `key` tem mais de `minIntervalMs`. Sem
 * Firestore, vale só para esta instância.
 */
export async function claimSlot(key: string, minIntervalMs: number, now = Date.now()): Promise<boolean> {
  const local = () => {
    const last = slots.get(key) ?? 0;
    if (now - last < minIntervalMs) return false;
    slots.set(key, now);
    return true;
  };
  return withDb(
    (db) =>
      db.runTransaction(async (tx) => {
        const ref = db.collection("meta").doc(`slot_${key}`);
        const last = Number((await tx.get(ref)).data()?.at ?? 0);
        if (now - last < minIntervalMs) return false;
        tx.set(ref, { at: now });
        return true;
      }),
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
  await withDb(async (db) => {
    const batch = db.batch();
    for (const r of list) batch.set(db.collection("trust_revisions").doc(`${r.source}_${r.date}_${r.detectedAt}`), r);
    await batch.commit();
  }, () => undefined);
}

export async function listRevisions(sinceMs: number, limit = 200): Promise<Revision[]> {
  return withDb(
    async (db) => {
      const snap = await db.collection("trust_revisions").where("detectedAt", ">=", sinceMs).orderBy("detectedAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as Revision);
    },
    () => mem.revisions.filter((r) => r.detectedAt >= sinceMs).slice(0, limit),
  );
}
