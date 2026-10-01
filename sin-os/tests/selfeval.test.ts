import { describe, expect, it } from "vitest";
import { runSelfEval, SCENARIOS } from "../src/lib/audit/selfeval";

describe("self-eval do auditor determinístico (falhas injetadas)", () => {
  it("classifica cada cenário conhecido no status esperado", () => {
    const r = runSelfEval(Date.parse("2026-09-26T12:00:00Z"));
    const errs = r.perScenario.filter((p) => !p.ok).map((p) => `${p.name}: esperado ${p.expected}, obteve ${p.got}`);
    expect(errs, errs.join(" | ")).toEqual([]);
  });

  it("precisão e recall macro altos (≥ 0,9) sobre os cenários", () => {
    const r = runSelfEval(Date.parse("2026-09-26T12:00:00Z"));
    expect(r.total).toBe(SCENARIOS.length);
    expect(r.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(r.precisionMacro).toBeGreaterThanOrEqual(0.9);
    expect(r.recallMacro).toBeGreaterThanOrEqual(0.9);
  });
});
