import { describe, expect, it } from "vitest";
import { sunPosition, sunPositionDetailed } from "@/lib/solar";
import {
  cosZenith,
  dayOfYearUTC,
  declinationCooperDeg,
  declinationDeg,
  equationOfTimeMin,
  extraterrestrialDailyMJm2,
  KLEIN_MEAN_DAY,
  solarAzimuthCompassDeg,
  sunsetHourAngleDeg,
} from "@/lib/solar/geometry";

/** Declinações da D&B Tabela 1.6.1 (dias médios de Klein 1977, calculadas pela equação de Cooper) */
const DB_TABLE_161_DECL = [-20.9, -13.0, -2.4, 9.4, 18.8, 23.1, 21.2, 13.5, 2.2, -9.6, -18.9, -23.0];

describe("declinação solar", () => {
  it("solstícios ≈ ±23,45° e equinócios ≈ 0° (Spencer 1971)", () => {
    expect(declinationDeg(172)).toBeCloseTo(23.45, 1); // 21/jun
    expect(declinationDeg(355)).toBeCloseTo(-23.42, 1); // 21/dez
    expect(Math.abs(declinationDeg(80))).toBeLessThan(0.5); // 21/mar
    expect(Math.abs(declinationDeg(266))).toBeLessThan(0.6); // 23/set
  });

  it("Cooper (1969) reproduz a D&B Tabela 1.6.1 nos dias médios de Klein (1977)", () => {
    KLEIN_MEAN_DAY.forEach((n, m) => expect(declinationCooperDeg(n)).toBeCloseTo(DB_TABLE_161_DECL[m], 0));
    KLEIN_MEAN_DAY.forEach((n, m) => expect(Math.abs(declinationCooperDeg(n) - DB_TABLE_161_DECL[m])).toBeLessThan(0.1));
  });

  it("NOAA/Meeus acerta os instantes de equinócio e solstício de 2025", () => {
    // equinócio de março: 20/03/2025 09:01 UTC; solstício de junho: 21/06/2025 02:42 UTC (obliquidade ≈ 23,436°)
    expect(Math.abs(sunPositionDetailed(new Date("2025-03-20T09:01:00Z"), 0, 0).declinationDeg)).toBeLessThan(0.01);
    expect(sunPositionDetailed(new Date("2025-06-21T02:42:00Z"), 0, 0).declinationDeg).toBeCloseTo(23.436, 2);
  });

  it("Spencer concorda com o NOAA/Meeus em ±0,6°", () => {
    // A série de Spencer foi ajustada a efemérides de ~1950; em 2025 os equinócios caem ~0,8 dia mais
    // cedo no calendário, o que dá até ~0,5° de diferença perto dos equinócios (δ varia 0,4°/dia).
    // Irrelevante para médias mensais (efeito < 0,2 % em H₀ nas latitudes do Brasil).
    for (const iso of ["2025-01-17", "2025-03-20", "2025-04-15", "2025-06-11", "2025-09-15", "2025-10-15", "2025-12-10"]) {
      const d = new Date(`${iso}T12:00:00Z`);
      const noaa = sunPositionDetailed(d, 0, 0).declinationDeg;
      expect(Math.abs(declinationDeg(dayOfYearUTC(d)) - noaa)).toBeLessThan(0.6);
    }
  });

  it("equação do tempo: extremos de ≈ −14 min (fev) e ≈ +16 min (nov)", () => {
    expect(equationOfTimeMin(42)).toBeCloseTo(-14.2, 0);
    expect(equationOfTimeMin(307)).toBeCloseTo(16.4, 0);
  });
});

describe("ângulo do pôr do sol e H₀", () => {
  it("equador: ωs = 90° o ano todo", () => {
    for (const d of [-23.45, 0, 10, 23.45]) expect(sunsetHourAngleDeg(0, d)).toBeCloseTo(90, 9);
  });

  it("D&B Exemplo 1.10.1 (Madison, φ = 43°, 15/abr): ωs = 98,9°, H₀ ≈ 33,7 MJ/m² (Gsc = 1361)", () => {
    expect(sunsetHourAngleDeg(43, 9.4)).toBeCloseTo(98.9, 1);
    expect(extraterrestrialDailyMJm2(43, 105)).toBeGreaterThan(33.4);
    expect(extraterrestrialDailyMJm2(43, 105)).toBeLessThan(34.0);
  });

  it("H₀ no equador ~ D&B Tabela 1.10.1 (mar ≈ 37,7–37,9; jun ≈ 33,4–34,3 MJ/m²)", () => {
    expect(extraterrestrialDailyMJm2(0, 75)).toBeGreaterThan(37.4);
    expect(extraterrestrialDailyMJm2(0, 75)).toBeLessThan(38.0);
    expect(extraterrestrialDailyMJm2(0, 162)).toBeGreaterThan(33.0);
    expect(extraterrestrialDailyMJm2(0, 162)).toBeLessThan(34.0);
  });

  it("hemisfério Sul: dia mais longo e H₀ maior em dezembro que em junho", () => {
    expect(sunsetHourAngleDeg(-15.8, declinationDeg(355))).toBeGreaterThan(95);
    expect(sunsetHourAngleDeg(-15.8, declinationDeg(172))).toBeLessThan(85);
    expect(extraterrestrialDailyMJm2(-15, 344)).toBeGreaterThan(extraterrestrialDailyMJm2(-15, 162) + 10);
  });

  it("noite polar → H₀ = 0 e ωs = 0", () => {
    expect(sunsetHourAngleDeg(80, -23)).toBe(0);
    expect(extraterrestrialDailyMJm2(80, 355)).toBe(0);
  });
});

describe("sunPosition (NOAA) e convenção de azimute de bússola", () => {
  it("equinócio no equador ao meio-dia solar → zênite ≈ 0", () => {
    // 20/03/2024: equação do tempo ≈ −7,5 min → meio-dia solar em lon 0 ≈ 12:07 UTC
    const p = sunPosition(new Date("2024-03-20T12:07:00Z"), 0, 0);
    expect(p.zenithDeg).toBeLessThan(0.5);
    expect(p.elevationDeg).toBeCloseTo(90 - p.zenithDeg, 12);
  });

  const noonScan = (iso: string, lat: number, lon: number) => {
    let best = { zenithDeg: 999, azimuthDeg: 0, elevationDeg: 0 };
    for (let min = 13 * 60; min < 17 * 60; min++) {
      const p = sunPosition(new Date(Date.parse(`${iso}T00:00:00Z`) + min * 60_000), lat, lon);
      if (p.zenithDeg < best.zenithDeg) best = p;
    }
    return best;
  };

  it("Brasília (−15,8°) ao meio-dia solar: Sol ao Norte em junho (Az ≈ 0°) e ao Sul em dezembro (Az ≈ 180°)", () => {
    const jun = noonScan("2024-06-21", -15.8, -47.9);
    expect(jun.zenithDeg).toBeCloseTo(15.8 + 23.44, 0);
    expect(Math.min(jun.azimuthDeg, 360 - jun.azimuthDeg)).toBeLessThan(2);
    const dec = noonScan("2024-12-21", -15.8, -47.9);
    expect(dec.zenithDeg).toBeCloseTo(23.44 - 15.8, 0);
    expect(Math.abs(dec.azimuthDeg - 180)).toBeLessThan(2);
  });

  it("manhã → Leste (0–180°), tarde → Oeste (180–360°)", () => {
    const morning = sunPosition(new Date("2024-06-21T11:00:00Z"), -15.8, -47.9); // ≈ 08h locais
    const afternoon = sunPosition(new Date("2024-06-21T20:00:00Z"), -15.8, -47.9); // ≈ 17h locais
    expect(morning.azimuthDeg).toBeGreaterThan(0);
    expect(morning.azimuthDeg).toBeLessThan(90); // inverno austral: nasce a NE
    expect(afternoon.azimuthDeg).toBeGreaterThan(270);
    const decMorning = sunPosition(new Date("2024-12-21T11:00:00Z"), -15.8, -47.9);
    expect(decMorning.azimuthDeg).toBeGreaterThan(90); // verão austral: nasce a SE
    expect(decMorning.azimuthDeg).toBeLessThan(180);
  });

  it("noite → elevação negativa", () => {
    expect(sunPosition(new Date("2024-06-21T05:00:00Z"), -15.8, -47.9).elevationDeg).toBeLessThan(0);
  });

  it("NOAA e a geometria de D&B em hora solar concordam em ±0,4° de zênite e ±1° de azimute", () => {
    const lat = -9.34;
    const lon = -40.57;
    for (const iso of ["2025-01-10T13:30:00Z", "2025-04-02T17:45:00Z", "2025-07-20T12:15:00Z", "2025-10-05T19:00:00Z"]) {
      const d = new Date(iso);
      const n = dayOfYearUTC(d);
      const decl = declinationDeg(n);
      const solarMin = d.getUTCHours() * 60 + d.getUTCMinutes() + 4 * lon + equationOfTimeMin(n);
      const omega = solarMin / 4 - 180;
      const zDB = (Math.acos(cosZenith(lat, decl, omega)) * 180) / Math.PI;
      const p = sunPosition(d, lat, lon);
      expect(Math.abs(p.zenithDeg - zDB)).toBeLessThan(0.4);
      const dAz = Math.abs(p.azimuthDeg - solarAzimuthCompassDeg(lat, decl, omega));
      expect(Math.min(dAz, 360 - dAz)).toBeLessThan(1);
    }
  });
});
