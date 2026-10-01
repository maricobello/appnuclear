import { describe, expect, it } from "vitest";
import { dailyMeans, pldSnapshot } from "../src/lib/market/pld-summary";
import { brtToUtc } from "../src/lib/sources/time";
import { SUBS, type Sub, type SubPanel } from "../src/lib/sources/types";

function panel(days: string[], f: (h: number, k: number, d: number) => number, hoursLastDay = 24): SubPanel {
  const ts: number[] = [];
  const values = Object.fromEntries(SUBS.map((s) => [s, [] as number[]])) as Record<Sub, number[]>;
  days.forEach((d, di) => {
    const [y, m, dd] = d.split("-").map(Number);
    const hours = di === days.length - 1 ? hoursLastDay : 24;
    for (let h = 0; h < hours; h++) {
      ts.push(brtToUtc(y, m, dd, h));
      SUBS.forEach((s, k) => values[s].push(f(h, k, di)));
    }
  });
  return { ts, values, unit: "R$/MWh" };
}

// 27/09 às 15:30 BRT
const NOW = brtToUtc(2026, 9, 27, 15, 30);

describe("resumo do PLD (/api/pld)", () => {
  it("hora atual, hoje e amanhã publicado", () => {
    const p = panel(["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"], (h, k, d) => 100 + d * 10 + (h === 19 ? 200 : 0) + k);
    const [se] = pldSnapshot(p, NOW, ["SE"]);
    expect(se.sub).toBe("SE");
    expect(se.agora).toEqual({ valor: 120, hora_brt: "2026-09-27 15:00" });
    expect(se.hoje?.max).toEqual({ valor: 320, hora: "19h" });
    expect(se.amanha?.media).toBeCloseTo(130 + 200 / 24, 2);
    expect(se.ultimo_dia_completo?.data).toBe("2026-09-27");
    expect(se).not.toHaveProperty("medias_diarias");
  });

  it("amanhã só aparece com as 24 horas; o último dia completo ignora o dia parcial", () => {
    const p = panel(["2026-09-26", "2026-09-27"], () => 90, 12);
    const [n] = pldSnapshot(p, NOW, ["N"]);
    expect(n.amanha).toBeNull();
    expect(n.hoje?.horas).toBe(12);
    expect(n.ultimo_dia_completo).toEqual({ data: "2026-09-26", media: 90 });
  });

  it("médias diárias dos últimos N dias completos, da mais antiga para a mais recente", () => {
    const p = panel(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"], (_h, _k, d) => 60 + d);
    expect(dailyMeans(p, "S", "2026-09-27", 2)).toEqual([
      { data: "2026-09-26", media: 62 },
      { data: "2026-09-27", media: 63 },
    ]);
    const all = pldSnapshot(p, NOW, SUBS, 3);
    expect(all).toHaveLength(4);
    expect(all[0].medias_diarias?.map((x) => x.data)).toEqual(["2026-09-25", "2026-09-26", "2026-09-27"]);
  });
});
