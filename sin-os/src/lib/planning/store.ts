import "server-only";
import { cached, invalidate } from "../cache";
import { readDoc, saveDoc } from "../store";
import { mergePlanHistory, PlanReportSchema, summarizePlan, type PlanReport, type PlanSummary } from "./report";

/**
 * Um documento só (plan_report/latest): o relatório completo como texto JSON (dezenas de kB) e o
 * histórico das últimas 90 rodadas. Cada instância relê no máximo a cada 10 min.
 */
const COL = "plan_report";
const ID = "latest";
const CACHE_KEY = "plan:latest";
const TTL = 10 * 60_000;

interface StoredDoc {
  v: 1;
  asof: string;
  generatedAt: string;
  receivedAt: number;
  json: string;
  history: PlanSummary[];
}

export interface LoadedPlan {
  report: PlanReport | null;
  history: PlanSummary[];
  receivedAt: number | null;
  /** O documento guardado não passa mais no esquema (formato antigo): tratado como ausente. */
  invalid: boolean;
}

/** Grava o relatório; uma rodada com data de referência mais antiga que a guardada só entra no histórico. */
export async function savePlanReport(r: PlanReport, now = Date.now()): Promise<{ kept: "novo" | "anterior"; history: PlanSummary[] }> {
  const prev = await readDoc<StoredDoc>(COL, ID).catch(() => null);
  const history = mergePlanHistory(prev?.history ?? [], summarizePlan(r));
  const older = !!prev && prev.asof > r.asof;
  const doc: StoredDoc = older ? { ...prev, history } : { v: 1, asof: r.asof, generatedAt: r.generatedAt, receivedAt: now, json: JSON.stringify(r), history };
  await saveDoc(COL, ID, doc);
  invalidate(CACHE_KEY);
  return { kept: older ? "anterior" : "novo", history };
}

export async function loadPlanReport(): Promise<LoadedPlan> {
  const { value } = await cached(CACHE_KEY, TTL, async () => {
    const doc = await readDoc<StoredDoc>(COL, ID);
    if (!doc) return { report: null, history: [], receivedAt: null, invalid: false } satisfies LoadedPlan;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(doc.json);
    } catch {
      parsed = null;
    }
    const r = PlanReportSchema.safeParse(parsed);
    return { report: r.success ? r.data : null, history: doc.history ?? [], receivedAt: doc.receivedAt ?? null, invalid: !r.success } satisfies LoadedPlan;
  });
  return value;
}
