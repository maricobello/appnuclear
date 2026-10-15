import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Firestore } from "firebase-admin/firestore";
import { firestoreCoolingDown, isQuotaError, QUOTA_COOLDOWN_MS, reportFirestoreError, setFirestoreForTests } from "../src/lib/firebase";
import { clearListCachesForTests, euZoneStore, listAuditRuns, saveAuditRun } from "../src/lib/store";
import type { AuditRun } from "../src/lib/audit/types";

const QUOTA = "8 RESOURCE_EXHAUSTED: Quota exceeded.";
const run = (id: string, startedAt: number) => ({ id, startedAt, overallScore: 90, counts: { ok: 15, degraded: 1, down: 0 }, sources: [], trigger: "cron" }) as unknown as AuditRun;

/** Firestore falso: conta leituras de documentos e pode falhar como a cota esgotada. */
function fakeDb(collections: Record<string, object[]>) {
  const state = { reads: 0, fail: null as string | null };
  const read = <T>(docs: T[]) => {
    if (state.fail) throw new Error(state.fail);
    state.reads += docs.length;
    return { docs: docs.map((d) => ({ data: () => d })) };
  };
  const query = (name: string) => ({
    orderBy: () => query(name),
    where: () => query(name),
    limit: (n: number) => ({ get: async () => read((collections[name] ?? []).slice(0, n)) }),
    get: async () => read(collections[name] ?? []),
    doc: () => ({ set: async () => undefined, get: async () => ({ data: () => undefined }) }),
  });
  const db = { collection: (name: string) => query(name) } as unknown as Firestore;
  return { db, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  clearListCachesForTests();
  const mem = (globalThis as unknown as { __sinMem?: { runs: AuditRun[] } }).__sinMem;
  if (mem) mem.runs.length = 0;
});

afterEach(() => {
  setFirestoreForTests(undefined);
  vi.useRealTimers();
});

describe("cota do Firestore", () => {
  it("reconhece o erro de cota e abre o disjuntor por 10 min", () => {
    expect(isQuotaError(QUOTA)).toBe(true);
    expect(isQuotaError("7 PERMISSION_DENIED")).toBe(false);
    setFirestoreForTests(null);
    reportFirestoreError(new Error(QUOTA));
    expect(firestoreCoolingDown()).toBe(true);
    expect(firestoreCoolingDown(Date.now() + QUOTA_COOLDOWN_MS + 1)).toBe(false);
    reportFirestoreError(new Error("7 PERMISSION_DENIED"));
    expect(firestoreCoolingDown()).toBe(false);
  });

  it("depois do erro de cota não chama o Firestore até o intervalo passar", async () => {
    const { db, state } = fakeDb({ audit_runs: [run("a", 1)] });
    setFirestoreForTests(db);
    state.fail = QUOTA;
    expect(await listAuditRuns(1)).toEqual([]);
    state.fail = null;
    const before = state.reads;
    expect(await listAuditRuns(1)).toEqual([]); // disjuntor aberto: nem tenta
    expect(state.reads).toBe(before);
    vi.advanceTimersByTime(QUOTA_COOLDOWN_MS + 1);
    expect((await listAuditRuns(1))[0]?.id).toBe("a"); // cota renovada: volta a ler
  });
});

describe("cache das execuções do auditor", () => {
  it("a mesma consulta dentro do prazo não volta ao Firestore", async () => {
    const runs = Array.from({ length: 48 }, (_, i) => run(`r${i}`, 1000 - i));
    const { db, state } = fakeDb({ audit_runs: runs });
    setFirestoreForTests(db);
    await listAuditRuns(48);
    await listAuditRuns(48);
    await listAuditRuns(1); // a lista longa também responde a curta
    expect(state.reads).toBe(48);
    vi.advanceTimersByTime(11 * 60_000);
    await listAuditRuns(48);
    expect(state.reads).toBe(96);
  });

  it("a execução gravada aqui aparece na hora, sem nova leitura", async () => {
    const { db, state } = fakeDb({ audit_runs: [run("velha", 1)] });
    setFirestoreForTests(db);
    await listAuditRuns(1);
    await saveAuditRun(run("nova", 2));
    expect((await listAuditRuns(1))[0].id).toBe("nova");
    expect(state.reads).toBe(1);
  });

  it("com o Firestore fora, devolve a última lista conhecida em vez de vazio", async () => {
    const { db, state } = fakeDb({ audit_runs: [run("conhecida", 5)] });
    setFirestoreForTests(db);
    await listAuditRuns(1);
    vi.advanceTimersByTime(3 * 60_000); // cache vencido
    state.fail = QUOTA;
    expect((await listAuditRuns(1))[0]?.id).toBe("conhecida");
  });
});

describe("preços europeus", () => {
  it("a memória responde e o Firestore só é relido a cada 15 min", async () => {
    const zones = Array.from({ length: 12 }, (_, i) => ({ bzn: `Z${i}`, name: `Z${i}`, ts: [1], values: [50], unit: "EUR/MWh", fetchedAt: Date.now() }));
    const { db, state } = fakeDb({ eu_prices: zones });
    setFirestoreForTests(db);
    expect((await euZoneStore.load()).length).toBe(12);
    await euZoneStore.load();
    await euZoneStore.load();
    expect(state.reads).toBe(12);
    vi.advanceTimersByTime(16 * 60_000);
    await euZoneStore.load();
    expect(state.reads).toBe(24);
  });
});
