import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runTrustCheck } from "../src/lib/audit/trust-run";
import { listRevisions } from "../src/lib/store";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type Sub, type SubPanel, type SourceResult } from "../src/lib/sources/types";

const NOW = brtToUtc(2026, 10, 8, 12, 0);
function panel(f: (h: number) => number): SubPanel {
  const ts: number[] = [];
  const values = Object.fromEntries(SUBS.map((s) => [s, [] as number[]])) as Record<Sub, number[]>;
  for (const d of [6, 7]) for (let h = 0; h < 24; h++) {
    ts.push(brtToUtc(2026, 10, d, h));
    for (const s of SUBS) values[s].push(f(h));
  }
  return { ts, values, unit: "MWmed" };
}
const ok = (data: SubPanel): Partial<Record<"ons_carga", SourceResult<unknown>>> => ({
  ons_carga: { id: "ons_carga", ok: true, data, probes: [], quality: { latestTs: null, points: 0, duplicates: 0, invalid: 0, schemaIssues: [] }, simulated: false, fetchedAt: NOW },
});

describe("verificação de revisões (rotina completa, em memória)", () => {
  it("1ª execução guarda o baseline; igual não gera revisão; republicação diferente gera e atualiza o baseline", async () => {
    const a = await runTrustCheck(ok(panel((h) => 1000 + h)), NOW);
    expect(a.revisions).toHaveLength(0);
    expect(a.stored).toBe(2);
    const b = await runTrustCheck(ok(panel((h) => 1000 + h)), NOW + 3600_000);
    expect(b.revisions).toHaveLength(0);
    expect(b.stored).toBe(0);
    const c = await runTrustCheck(ok(panel((h) => 1000 + h + (h === 10 ? 25 : 0))), NOW + 2 * 3600_000);
    expect(c.revisions).toHaveLength(2); // os 2 dias fechados mudaram
    expect(c.revisions[0]).toMatchObject({ source: "ons_carga", changedPoints: 4, maxAbsDiff: 25 });
    const d = await runTrustCheck(ok(panel((h) => 1000 + h + (h === 10 ? 25 : 0))), NOW + 3 * 3600_000);
    expect(d.revisions).toHaveLength(0); // baseline já é a versão nova
    const listed = await listRevisions(NOW);
    expect(listed.length).toBeGreaterThanOrEqual(2);
  });

  it("fonte simulada ou com erro não vira baseline", async () => {
    const sim = ok(panel(() => 1));
    sim.ons_carga!.simulated = true;
    expect((await runTrustCheck(sim, NOW)).checked).toBe(0);
    const bad = ok(panel(() => 1));
    bad.ons_carga!.ok = false;
    expect((await runTrustCheck(bad, NOW)).checked).toBe(0);
  });
});
