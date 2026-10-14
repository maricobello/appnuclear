import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { curtailmentHistory } from "@/lib/sources/ons-renewables-history";

describe.skipIf(!process.env.REAL)("dados reais", () => it("histórico mensal de corte (12 meses, ONS S3)", async () => {
  const t0 = Date.now();
  const h = await curtailmentHistory(12);
  const cold = Date.now() - t0;
  const t1 = Date.now();
  await curtailmentHistory(12);
  console.log(JSON.stringify({ coldMs: cold, warmMs: Date.now() - t1, months: h.map((m) => ({ m: m.month, eolGWh: Math.round(m.eolicaMWh / 1000), solGWh: Math.round(m.solarMWh / 1000), cappedGWh: Math.round(m.cappedMWh / 1000), days: m.days })) }));
  expect(h.length).toBe(12);
}, 300_000));
