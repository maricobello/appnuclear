import { describe, expect, it } from "vitest";
import { midWindows } from "../src/lib/sources/uk";

describe("Elexon MID — janelas", () => {
  it("divide 8 dias em janelas contíguas de até 6 dias (a BMRS rejeita intervalos longos)", () => {
    const from = Date.parse("2026-09-20T02:00:00Z");
    const to = Date.parse("2026-09-28T02:00:00Z");
    const w = midWindows(from, to);
    expect(w).toEqual([
      ["2026-09-20T02:00Z", "2026-09-26T02:00Z"],
      ["2026-09-26T02:00Z", "2026-09-28T02:00Z"],
    ]);
    for (const [a, b] of w) expect(Date.parse(b) - Date.parse(a)).toBeLessThanOrEqual(6 * 86400_000);
  });
  it("intervalo curto vira uma janela só", () => {
    const from = Date.parse("2026-09-25T00:00:00Z");
    expect(midWindows(from, from + 3 * 86400_000)).toHaveLength(1);
  });
});
