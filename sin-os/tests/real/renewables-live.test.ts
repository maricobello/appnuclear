import { describe, expect, it } from "vitest";
import { curtailmentSummary, hourConventionCheck, netLoadSummary } from "@/lib/market/renewables";
import { fetchBalance, fetchCurtailment } from "@/lib/sources/ons-renewables";

describe.skipIf(!process.env.REAL)("dados reais", () => it("curtailment e balanço do ONS (S3)", async () => {
  const now = Date.now();
  const [c, b] = await Promise.all([fetchCurtailment(14, now), fetchBalance(14, now)]);
  expect(c.ok, c.error).toBe(true);
  expect(b.ok, b.error).toBe(true);
  const s = curtailmentSummary(c.data!, now, 14);
  const n = netLoadSummary(b.data!, now, 14);
  const h = hourConventionCheck(c.data!, b.data!, "NE");
  console.log(JSON.stringify({ c: c.quality.points, ageH: (now - c.quality.latestTs!) / 3.6e6, totals: s.totals, share: s.curtailedSharePct, q: s.quality, ramp: n.eveningRampMW, minHour: n.minHour, ren: n.renewableSharePct, nq: n.quality, h }, null, 1));
  expect(h.ok).toBe(true);
  expect(s.quality.methodMAE!).toBeLessThan(1);
}, 180_000));
