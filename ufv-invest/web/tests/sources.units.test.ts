import { describe, expect, it } from "vitest";
import {
  coefficientOfVariationPct,
  compassToOpenMeteoAzimuth,
  compassToPvgisAspect,
  compoundLossPct,
  cleanFill,
  dailyIrradiationFactorToKWh,
  daysInMonth,
  isLeapYear,
  mjToKWh,
  parseDecimal,
  brDateToIso,
  southBasedAzimuthToCompass,
} from "@/lib/sources/units";

describe("conversão de azimute (bússola → 0 = Sul)", () => {
  it("usina voltada para o Norte é aspect 180 no PVGIS", () => {
    expect(compassToPvgisAspect(0)).toBe(180);
    expect(compassToPvgisAspect(360)).toBe(180);
  });

  it("Sul = 0, Leste = −90, Oeste = 90", () => {
    expect(compassToPvgisAspect(180)).toBe(0);
    expect(compassToPvgisAspect(90)).toBe(-90);
    expect(compassToPvgisAspect(270)).toBe(90);
    expect(compassToPvgisAspect(-90)).toBe(90); // −90 de bússola = Oeste
  });

  it("direções intermediárias", () => {
    expect(compassToPvgisAspect(45)).toBe(-135); // NE
    expect(compassToPvgisAspect(315)).toBe(135); // NO
    expect(compassToPvgisAspect(200)).toBe(20); // SSO
    expect(compassToPvgisAspect(10)).toBe(-170); // N levemente a Leste
  });

  it("Open-Meteo usa a mesma convenção do PVGIS", () => {
    for (const az of [0, 15, 90, 180, 250, 359]) expect(compassToOpenMeteoAzimuth(az)).toBe(compassToPvgisAspect(az));
  });

  it("ida e volta", () => {
    for (const az of [0, 1, 45, 90, 135, 180, 225, 270, 315, 359]) {
      expect(southBasedAzimuthToCompass(compassToPvgisAspect(az))).toBeCloseTo(az, 9);
    }
    expect(southBasedAzimuthToCompass(180)).toBe(0);
    expect(southBasedAzimuthToCompass(-180)).toBe(0);
  });
});

describe("unidades", () => {
  it("MJ/m² → kWh/m² (÷ 3,6)", () => {
    expect(mjToKWh(3.6)).toBeCloseTo(1, 12);
    expect(mjToKWh(25.2)).toBeCloseTo(7, 12);
  });

  it("fator de irradiação diária a partir do texto de unidade", () => {
    expect(dailyIrradiationFactorToKWh("kW-hr/m^2/day")).toBe(1);
    expect(dailyIrradiationFactorToKWh("MJ/m^2/day")).toBeCloseTo(1 / 3.6, 12);
    expect(dailyIrradiationFactorToKWh("MJ/m²")).toBeCloseTo(1 / 3.6, 12);
    expect(dailyIrradiationFactorToKWh("W/m^2")).toBeCloseTo(0.024, 12);
    expect(dailyIrradiationFactorToKWh("Wh/m²")).toBeCloseTo(0.001, 12);
    expect(dailyIrradiationFactorToKWh(undefined)).toBe(1);
  });

  it("perdas compostas: 1 − Π(1 − p)", () => {
    expect(compoundLossPct([2, 1])).toBeCloseTo(2.98, 10);
    expect(compoundLossPct([])).toBe(0);
    expect(compoundLossPct([100, 5])).toBe(100);
  });

  it("dias do mês e ano bissexto", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2025, 1)).toBe(28);
    expect(daysInMonth(2025, 11)).toBe(31);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
});

describe("parseDecimal (vírgula/ponto, tokens de ausência)", () => {
  it.each([
    ["14,90", 14.9],
    ["14.90", 14.9],
    ["5.4321", 5.4321],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.393.420", 1393420],
    ["-0,5", -0.5],
    [" 7 ", 7],
    ["1e3", 1000],
    [12, 12],
  ] as const)("%s → %s", (input, expected) => {
    expect(parseDecimal(input)).toBeCloseTo(expected, 10);
  });

  it.each(["-", "...", "X", "", "abc", "12abc", null, undefined, NaN, Infinity, {}])("%s → undefined", (input) => {
    expect(parseDecimal(input)).toBeUndefined();
  });

  it("data do SGS dd/mm/aaaa → ISO", () => {
    expect(brDateToIso("03/10/2026")).toBe("2026-10-03");
    expect(brDateToIso("2026-10-03")).toBe("2026-10-03");
  });
});

describe("valor de preenchimento da NASA POWER", () => {
  it("−999 é ausente; valores negativos legítimos são mantidos", () => {
    expect(cleanFill(-999)).toBeUndefined();
    expect(cleanFill(-999.0)).toBeUndefined();
    expect(cleanFill("-999")).toBeUndefined();
    expect(cleanFill(-1000)).toBeUndefined();
    expect(cleanFill(-12.5)).toBe(-12.5);
    expect(cleanFill(5.73)).toBe(5.73);
    expect(cleanFill(null)).toBeUndefined();
    expect(cleanFill(-99, -99)).toBeUndefined();
  });
});

describe("coeficiente de variação", () => {
  it("usa desvio-padrão amostral (n − 1)", () => {
    // média 100; Σ(x − m)² = 0 + 100 + 100 + 25 + 25 = 250; s = √(250/4) = 7,9057
    expect(coefficientOfVariationPct([100, 110, 90, 105, 95])).toBeCloseTo(7.90569, 4);
  });

  it("série constante ⇒ CV 0", () => {
    expect(coefficientOfVariationPct([2000, 2000, 2000])).toBe(0);
  });
});
