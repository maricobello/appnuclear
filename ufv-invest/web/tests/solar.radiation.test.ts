import { describe, expect, it } from "vitest";
import {
  bendtBounds,
  capDayTypes,
  clearnessDayTypes,
  collaresPereiraRablRt,
  erbsDailyDiffuseFraction,
  erbsHourlyDiffuseFraction,
  erbsMonthlyDiffuseFraction,
  haurwitzGhiWm2,
  hourlyFractions,
  intradayProfile,
  liuJordanRd,
  waterfillUnderCeiling,
} from "@/lib/solar/decomposition";
import {
  cosIncidence,
  iamBeam,
  iamDiffuse,
  singleAxisRotationDeg,
  sunVectorFromAngles,
  TRACKER_GCR,
  trackerSurface,
  transposeHDKR,
} from "@/lib/solar/transposition";
import { ambientTemperatureC, faimanCellTempC } from "@/lib/solar/thermal";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("fração difusa — Erbs, Klein & Duffie (1982)", () => {
  it("correlação média mensal (D&B Eq. 2.12.1) nos dois ramos de ωs", () => {
    // ωs > 81,4°: 1,311 − 3,022 K + 3,427 K² − 1,821 K³
    expect(erbsMonthlyDiffuseFraction(0.5, 90)).toBeCloseTo(0.4291, 4);
    expect(erbsMonthlyDiffuseFraction(0.55, 90)).toBeCloseTo(0.3826, 4);
    // ωs ≤ 81,4°: 1,391 − 3,560 K + 4,189 K² − 2,137 K³
    expect(erbsMonthlyDiffuseFraction(0.6, 75)).toBeCloseTo(0.3014, 4);
    // decrescente com K̄T; fora da validade (0,3–0,8) o K̄T é limitado
    expect(erbsMonthlyDiffuseFraction(0.4, 90)).toBeGreaterThan(erbsMonthlyDiffuseFraction(0.7, 90));
    expect(erbsMonthlyDiffuseFraction(0.95, 90)).toBeCloseTo(erbsMonthlyDiffuseFraction(0.8, 90), 12);
  });

  it("correlações diária (Eq. 2.11.1) e horária (Eq. 2.10.1)", () => {
    expect(erbsDailyDiffuseFraction(0.5, 90)).toBeCloseTo(0.6083, 4);
    expect(erbsDailyDiffuseFraction(0.75, 90)).toBe(0.175);
    expect(erbsDailyDiffuseFraction(0.75, 70)).toBe(0.143);
    expect(erbsHourlyDiffuseFraction(0.1)).toBeCloseTo(0.991, 6);
    expect(erbsHourlyDiffuseFraction(0.5)).toBeCloseTo(0.6591, 4);
    expect(erbsHourlyDiffuseFraction(0.9)).toBe(0.165);
  });
});

describe("distribuição intradiária — Collares-Pereira & Rabl (1979) e Liu & Jordan (1960)", () => {
  it("frações horárias somam 1; r_d integra exatamente 1 e r_t ≈ 1 (±2 %)", () => {
    for (const ws of [80, 90, 97]) {
      const h = hourlyFractions(ws);
      expect(sum(h.rt)).toBeCloseTo(1, 12);
      expect(sum(h.rd)).toBeCloseTo(1, 12);
      expect(h.rawSumD).toBeCloseTo(1, 4);
      expect(Math.abs(h.rawSumT - 1)).toBeLessThan(0.02);
      const p = intradayProfile(ws, 96);
      expect(sum(p.ft)).toBeCloseTo(1, 12);
      expect(sum(p.fd)).toBeCloseTo(1, 12);
    }
  });

  it("perfis simétricos em torno do meio-dia solar e global mais concentrada que a difusa", () => {
    const h = hourlyFractions(90);
    for (let k = 0; k < 12; k++) {
      expect(h.rt[k]).toBeCloseTo(h.rt[23 - k], 12);
      expect(h.rd[k]).toBeCloseTo(h.rd[23 - k], 12);
    }
    expect(h.rt[11]).toBeGreaterThan(h.rd[11]);
    expect(h.rt[6]).toBeLessThan(h.rd[6]);
    expect(collaresPereiraRablRt(95, 90)).toBe(0);
    expect(liuJordanRd(-91, 90)).toBe(0);
  });

  it("valor analítico de r_t entre 10 e 11 h com ωs = 90° (ponto médio ω = −22,5°): ≈ 0,127", () => {
    // ωs = 90° → sen ωs − (π ωs/180) cos ωs = 1; a = 0,409 + 0,5016 sen 30° = 0,6598; b = 0,6609 − 0,4767 sen 30° = 0,42255
    const c = Math.cos((-22.5 * Math.PI) / 180);
    const expected = (Math.PI / 24) * (0.6598 + 0.42255 * c) * c;
    expect(collaresPereiraRablRt(-22.5, 90)).toBeCloseTo(expected, 6);
    expect(collaresPereiraRablRt(-22.5, 90)).toBeCloseTo(0.127, 3);
    expect(liuJordanRd(-22.5, 90)).toBeCloseTo((Math.PI / 24) * c, 12);
  });
});

describe("dias-tipo (Bendt et al. 1981) e teto de céu claro (Haurwitz 1945)", () => {
  it("dias-tipo preservam K̄T, ficam ordenados e dentro de [K_min, K_max]", () => {
    for (const k of [0.45, 0.55, 0.65, 0.7]) {
      const t = clearnessDayTypes(k, 5);
      expect(sum(t) / 5).toBeCloseTo(k, 10);
      const { min, max } = bendtBounds(k);
      for (let i = 0; i < 5; i++) {
        expect(t[i]).toBeGreaterThan(min);
        expect(t[i]).toBeLessThan(max + 1e-9);
        if (i > 0) expect(t[i]).toBeGreaterThan(t[i - 1]);
      }
    }
  });

  it("teto preserva a média e nunca é excedido", () => {
    const t = clearnessDayTypes(0.6, 5);
    const c = capDayTypes(t, 0.72);
    expect(sum(c) / 5).toBeCloseTo(0.6, 12);
    for (const x of c) expect(x).toBeLessThanOrEqual(0.72 + 1e-12);
    // local mais límpido que o teto → inalterado
    expect(capDayTypes([0.75, 0.8], 0.7)).toEqual([0.75, 0.8]);
  });

  it("water-filling preserva a soma e respeita o teto", () => {
    const g = [100, 600, 1100, 600, 100];
    const ceil = [300, 900, 1000, 900, 300];
    const out = waterfillUnderCeiling(g, ceil);
    expect(sum(out)).toBeCloseTo(sum(g), 9);
    out.forEach((x, i) => expect(x).toBeLessThanOrEqual(ceil[i] + 1e-9));
  });

  it("Haurwitz: ≈ 1037 W/m² no zênite, zero com o Sol abaixo do horizonte", () => {
    expect(haurwitzGhiWm2(1)).toBeCloseTo(1098 * Math.exp(-0.057), 6);
    expect(haurwitzGhiWm2(0)).toBe(0);
  });
});

describe("transposição HDKR, IAM e seguidor", () => {
  it("superfície horizontal recupera exatamente a GHI", () => {
    const sun = sunVectorFromAngles(35, 60);
    const ghi = 800;
    const dhi = 200;
    const dni = (ghi - dhi) / sun.cosZ;
    const p = transposeHDKR(sun, { tiltDeg: 0, azimuthDeg: 0 }, ghi, dhi, dni, 1361, 0.2);
    expect(p.total).toBeCloseTo(ghi, 9);
    expect(p.ground).toBe(0);
  });

  it("cos θ: plano voltado ao Sol → 1; convenção de bússola", () => {
    const sun = sunVectorFromAngles(30, 0); // Sol ao Norte, 60° de elevação
    expect(cosIncidence(sun, { tiltDeg: 30, azimuthDeg: 0 })).toBeCloseTo(1, 12);
    expect(cosIncidence(sun, { tiltDeg: 30, azimuthDeg: 180 })).toBeCloseTo(Math.cos((60 * Math.PI) / 180), 12);
  });

  it("IAM de Martin & Ruiz (2001): 1 na normal, ≈ 0,958 a 60°, 0 a 90°; difusa ≈ 0,95", () => {
    expect(iamBeam(1)).toBeCloseTo(1, 12);
    expect(iamBeam(0.5)).toBeCloseTo(0.9579, 4);
    expect(iamBeam(0)).toBe(0);
    expect(iamDiffuse(0).sky).toBeCloseTo(0.9515, 3);
    expect(iamDiffuse(0).ground).toBe(0);
    expect(iamDiffuse(30).ground).toBeGreaterThan(iamDiffuse(15).ground);
  });

  it("seguidor N-S: rastreamento verdadeiro, limite mecânico e backtracking (GCR 0,35)", () => {
    const sun = (elev: number, az: number) => sunVectorFromAngles(90 - elev, az);
    expect(TRACKER_GCR).toBe(0.35);
    // Sol a Leste, 30° de elevação: rastreamento verdadeiro 60° → limitado a 55°
    expect(singleAxisRotationDeg(sun(30, 90), 0, 55)).toBeCloseTo(55, 9);
    expect(singleAxisRotationDeg(sun(30, 90), 0, 90)).toBeCloseTo(60, 9);
    // Sol rasante (10°): backtracking R = 80° − acos(cos 80° / 0,35) = 19,74°
    expect(singleAxisRotationDeg(sun(10, 90), 0, 55)).toBeCloseTo(19.745, 2);
    expect(singleAxisRotationDeg(sun(10, 270), 0, 55)).toBeCloseTo(-19.745, 2);
    // Sol no plano do eixo (ao Norte): módulos na horizontal
    expect(singleAxisRotationDeg(sun(40, 0), 0, 55)).toBeCloseTo(0, 9);
    // rotação positiva = módulos voltados para Leste
    expect(trackerSurface(20, 0)).toEqual({ tiltDeg: 20, azimuthDeg: 90 });
    expect(trackerSurface(-20, 0)).toEqual({ tiltDeg: 20, azimuthDeg: 270 });
  });

  it("backtracking elimina o sombreamento entre fileiras: cos(ψ − R)/cos ψ ≤ 1/GCR", () => {
    for (let elev = 2; elev <= 30; elev += 2) {
      const psi = 90 - elev; // ângulo projetado do Sol (Sol a Leste)
      const r = singleAxisRotationDeg(sunVectorFromAngles(90 - elev, 90), 0, 55);
      const shade = Math.cos(((psi - r) * Math.PI) / 180) / Math.cos((psi * Math.PI) / 180);
      expect(shade).toBeLessThanOrEqual(1 / TRACKER_GCR + 1e-9);
    }
  });
});

describe("temperatura", () => {
  it("perfil diurno: Tmín no nascer do sol, Tmáx às 15 h", () => {
    expect(ambientTemperatureC(6, 6, 18, 32)).toBeCloseTo(18, 9);
    expect(ambientTemperatureC(15, 6, 18, 32)).toBeCloseTo(32, 9);
    const t12 = ambientTemperatureC(12, 6, 18, 32);
    expect(t12).toBeGreaterThan(25);
    expect(t12).toBeLessThan(32);
  });

  it("Faiman (2008): 1000 W/m², vento 2 m/s → Tc ≈ Ta + 25,8 °C", () => {
    expect(faimanCellTempC(1000, 30, 2)).toBeCloseTo(30 + 1000 / (25 + 6.84 * 2), 9);
    expect(faimanCellTempC(1000, 30, 6)).toBeLessThan(faimanCellTempC(1000, 30, 1));
  });
});
