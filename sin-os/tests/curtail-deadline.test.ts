import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// ONS lento: o download do parquet nunca termina
vi.mock("../src/lib/sources/ons-renewables", () => ({
  curtailmentUrl: (tech: string, y: number, m: number) => `https://ons.test/${tech}/${y}-${m}.parquet`,
  readParquet: () => new Promise(() => undefined),
}));

import { curtailmentHistoryWithin } from "../src/lib/sources/ons-renewables-history";
import { saveDoc } from "../src/lib/store";

describe("histórico de corte com prazo", () => {
  it("devolve no prazo o que está no cache e diz quantos meses faltam", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "last-modified": "v1" } })));
    const zero = { SE: 0, S: 0, NE: 0, N: 0 };
    await saveDoc("curtail_months", "2026-01", {
      month: "2026-01",
      eolicaMWh: 100,
      solarMWh: 50,
      cappedMWh: 120,
      bySub: zero,
      byReason: { REL: 0, CNF: 0, ENE: 0 },
      days: 31,
      version: "v1|v1",
      computedAt: 1,
      revision: null,
    });
    const t0 = Date.now();
    const r = await curtailmentHistoryWithin(12, 150, Date.parse("2026-10-15T12:00:00Z"));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.months.map((m) => m.month)).toEqual(["2026-01"]);
    expect(r.missing).toBe(11);
    vi.unstubAllGlobals();
  });
});
