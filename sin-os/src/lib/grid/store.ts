import "server-only";
import { cached, invalidate } from "../cache";
import { readDoc, saveDoc } from "../store";
import { GridSnapshotSchema, mergeHistory, summarize, type GridDaySummary, type GridSnapshot } from "./snapshot";

/**
 * Um documento só (grid_snapshot/latest): o relatório completo como texto JSON (~260 kB, abaixo
 * do 1 MiB do Firestore e sem estourar o limite de campos indexados) e o histórico de 30 dias.
 * Cada instância relê no máximo a cada 10 min: 1 leitura por instância, não por visita.
 */
const COL = "grid_snapshot";
const ID = "latest";
const CACHE_KEY = "grid:latest";
const TTL = 10 * 60_000;

interface StoredDoc {
  v: 1;
  date: string;
  generatedAt: string;
  receivedAt: number;
  json: string;
  history: GridDaySummary[];
}

export interface LoadedGrid {
  snapshot: GridSnapshot | null;
  history: GridDaySummary[];
  receivedAt: number | null;
  /** O documento guardado não passa mais no esquema (formato antigo): tratado como ausente. */
  invalid: boolean;
}

/** Grava o relatório; um dia mais antigo que o guardado (reprocessamento manual) só entra no histórico. */
export async function saveGridSnapshot(s: GridSnapshot, now = Date.now()): Promise<{ kept: "novo" | "anterior"; history: GridDaySummary[] }> {
  const prev = await readDoc<StoredDoc>(COL, ID).catch(() => null);
  const history = mergeHistory(prev?.history ?? [], summarize(s));
  const older = !!prev && prev.date > s.date;
  const doc: StoredDoc = older ? { ...prev, history } : { v: 1, date: s.date, generatedAt: s.generatedAt, receivedAt: now, json: JSON.stringify(s), history };
  await saveDoc(COL, ID, doc);
  invalidate(CACHE_KEY);
  return { kept: older ? "anterior" : "novo", history };
}

export async function loadGridSnapshot(): Promise<LoadedGrid> {
  const { value } = await cached(CACHE_KEY, TTL, async () => {
    const doc = await readDoc<StoredDoc>(COL, ID);
    if (!doc) return { snapshot: null, history: [], receivedAt: null, invalid: false } satisfies LoadedGrid;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(doc.json);
    } catch {
      parsed = null;
    }
    const r = GridSnapshotSchema.safeParse(parsed);
    return { snapshot: r.success ? r.data : null, history: doc.history ?? [], receivedAt: doc.receivedAt ?? null, invalid: !r.success } satisfies LoadedGrid;
  });
  return value;
}
