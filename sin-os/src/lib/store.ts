import "server-only";
import { firestore } from "./firebase";
import type { AgentReport, AuditRun } from "./audit/types";
import { SUBS, type Sub } from "./sources/types";

/**
 * Persistência: Firestore quando configurado; memória do processo como fallback
 * (não durável — a UI avisa). Coleções:
 *   audit_runs/{id}      execuções do auditor (sem séries brutas)
 *   agent_reports/{id}   relatórios do agente IA
 *   pld_days/{YYYY-MM-DD} PLD horário por submercado — histórico próprio e
 *                        "last known good" se a CCEE ficar fora do ar
 */
export interface PldDay {
  date: string;
  values: Record<Sub, number[]>;
  source: string;
}

type Mem = { runs: AuditRun[]; reports: AgentReport[]; pld: Map<string, PldDay> };
const g = globalThis as typeof globalThis & { __sinMem?: Mem };
g.__sinMem ??= { runs: [], reports: [], pld: new Map() };
const mem = g.__sinMem;

export const storageKind = (): "firestore" | "memory" => (firestore() ? "firestore" : "memory");

export async function saveAuditRun(run: AuditRun): Promise<void> {
  const db = firestore();
  if (db) await db.collection("audit_runs").doc(run.id).set(run);
  mem.runs.unshift(run);
  mem.runs.splice(200);
}

export async function listAuditRuns(limit = 20): Promise<AuditRun[]> {
  const db = firestore();
  if (db) {
    const snap = await db.collection("audit_runs").orderBy("startedAt", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as AuditRun);
  }
  return mem.runs.slice(0, limit);
}

export async function saveAgentReport(r: AgentReport): Promise<void> {
  const db = firestore();
  if (db) await db.collection("agent_reports").doc(r.id).set(r);
  mem.reports.unshift(r);
  mem.reports.splice(50);
}

export async function listAgentReports(limit = 5): Promise<AgentReport[]> {
  const db = firestore();
  if (db) {
    const snap = await db.collection("agent_reports").orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data() as AgentReport);
  }
  return mem.reports.slice(0, limit);
}

/** Grava dias completos de PLD ainda não persistidos (idempotente). */
export async function savePldDays(days: PldDay[]): Promise<number> {
  const db = firestore();
  let written = 0;
  if (db) {
    const refs = days.map((d) => db.collection("pld_days").doc(d.date));
    const existing = refs.length ? await db.getAll(...refs) : [];
    const batch = db.batch();
    existing.forEach((snap, i) => {
      if (!snap.exists) {
        batch.set(refs[i], days[i]);
        written++;
      }
    });
    if (written) await batch.commit();
  }
  for (const d of days) mem.pld.set(d.date, d);
  return written;
}

export async function loadPldDays(n = 120): Promise<PldDay[]> {
  const db = firestore();
  if (db) {
    const snap = await db.collection("pld_days").orderBy("date", "desc").limit(n).get();
    return snap.docs.map((d) => d.data() as PldDay).reverse();
  }
  return [...mem.pld.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-n);
}

export const isCompleteDay = (v: Record<Sub, (number | null)[]>) =>
  SUBS.every((s) => v[s].length === 24 && v[s].every((x) => x !== null && Number.isFinite(x)));
