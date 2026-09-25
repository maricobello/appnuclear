import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { clearFirestoreError, firestore, firestoreHealthy, reportFirestoreError } from "./firebase";
import type { AgentReport, AuditRun } from "./audit/types";
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
 */
export interface PldDay {
  date: string;
  values: Record<Sub, number[]>;
  source: string;
}

// persisted: data → fonte já gravada no Firestore (evita reler os mesmos dias a cada requisição)
type Mem = { runs: AuditRun[]; reports: AgentReport[]; pld: Map<string, PldDay>; persisted: Map<string, string> };
const g = globalThis as typeof globalThis & { __sinMem?: Mem };
g.__sinMem ??= { runs: [], reports: [], pld: new Map(), persisted: new Map() };
g.__sinMem.persisted ??= new Map();
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
