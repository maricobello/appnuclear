/**
 * Conversões de unidades, convenções de ângulo e estatísticas usadas pelos adaptadores de dados.
 * Funções puras (sem I/O), testadas em tests/sources.units.test.ts.
 */

/** Dias de cada mês num ano não bissexto (climatologia: 365 dias) */
export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Dias do mês `month0` (0..11) no ano `year` (considera bissexto) */
export function daysInMonth(year: number, month0: number): number {
  return month0 === 1 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month0];
}

// ─── Azimute ────────────────────────────────────────────────────────────────────────────────

/**
 * Converte azimute de bússola (0 = Norte, 90 = Leste, 180 = Sul, 270 = Oeste) para a convenção
 * "0 = Sul" usada pelo PVGIS (`aspect`) e pelo Open-Meteo (`azimuth`): 0 = Sul, 90 = Oeste,
 * −90 = Leste, ±180 = Norte. Resultado no intervalo (−180, 180]; Norte → 180.
 */
export function compassToSouthBasedAzimuth(compassDeg: number): number {
  const a = (((compassDeg - 180) % 360) + 360) % 360; // 0..360
  const r = a > 180 ? a - 360 : a;
  return r === 0 ? 0 : r; // evita −0
}

/** Inversa de `compassToSouthBasedAzimuth`: devolve azimute de bússola em [0, 360) */
export function southBasedAzimuthToCompass(southBasedDeg: number): number {
  const r = (((southBasedDeg + 180) % 360) + 360) % 360;
  return r === 0 ? 0 : r;
}

/** `aspect` do PVGIS a partir do azimute de bússola da usina */
export const compassToPvgisAspect = compassToSouthBasedAzimuth;
/** `azimuth` do Open-Meteo (GTI) a partir do azimute de bússola da usina */
export const compassToOpenMeteoAzimuth = compassToSouthBasedAzimuth;

// ─── Energia ────────────────────────────────────────────────────────────────────────────────

/** MJ/m² → kWh/m² (1 kWh = 3,6 MJ) */
export function mjToKWh(mj: number): number {
  return mj / 3.6;
}

/**
 * Fator para converter uma irradiação diária média para kWh/m²/dia a partir do texto de unidade
 * informado pela API (ex.: "kW-hr/m^2/day", "MJ/m^2/day", "W/m^2"). Desconhecida → 1 (kWh).
 */
export function dailyIrradiationFactorToKWh(units: string | undefined): number {
  if (!units) return 1;
  const u = units.toLowerCase().trim();
  if (u.includes("mj")) return 1 / 3.6;
  if (u.includes("kw")) return 1;
  if (u.startsWith("wh") || u.startsWith("w-hr")) return 1 / 1000;
  if (u.startsWith("w")) return 24 / 1000; // média diária em W/m² → kWh/m²/dia
  return 1;
}

/**
 * Perda total composta (%) de perdas aplicadas em cascata: 1 − Π(1 − pᵢ/100).
 * Ex.: [2, 1] → 2,98 %.
 */
export function compoundLossPct(lossesPct: number[]): number {
  const kept = lossesPct.reduce((acc, p) => acc * (1 - p / 100), 1);
  return (1 - kept) * 100;
}

// ─── Números ────────────────────────────────────────────────────────────────────────────────

export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

const MISSING_TOKENS = new Set(["", "-", "--", "...", "..", "x", "nan", "null", "n/a", "nd"]);

/**
 * Converte número em texto tolerando vírgula ou ponto decimal e separadores de milhar:
 * "14,90" → 14.9 · "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "5.4321" → 5.4321 ·
 * "1.393.420" → 1393420. Tokens de ausência do IBGE/SIDRA ("-", "...", "X") → undefined.
 * Um único ponto é sempre tratado como separador decimal (formato do SGS e do SIDRA).
 */
export function parseDecimal(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.trim().replace(/\s| /g, "");
  if (MISSING_TOKENS.has(s.toLowerCase())) return undefined;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    const decimalIsComma = s.lastIndexOf(",") > s.lastIndexOf(".");
    s = decimalIsComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    s = (s.match(/,/g)?.length ?? 0) === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot && (s.match(/\./g)?.length ?? 0) > 1) {
    s = s.replace(/\./g, "");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Valor numérico da NASA POWER com tratamento do valor de preenchimento (−999 = sem dado).
 * Qualquer valor ≤ −999 (ou igual ao `fill` informado no cabeçalho) vira undefined.
 */
export function cleanFill(v: unknown, fill = -999): number | undefined {
  const n = parseDecimal(v);
  if (n === undefined) return undefined;
  if (n === fill || n <= -999) return undefined;
  return n;
}

// ─── Estatística ────────────────────────────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Desvio-padrão amostral (n − 1) */
export function sampleStdDev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Coeficiente de variação, % (desvio-padrão amostral ÷ média × 100) */
export function coefficientOfVariationPct(xs: number[]): number {
  return (sampleStdDev(xs) / mean(xs)) * 100;
}

/** "dd/mm/aaaa" → "aaaa-mm-dd" (outros formatos são devolvidos como vieram) */
export function brDateToIso(d: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

/** Coordenada com 4 casas (≈ 11 m) — mantém as URLs estáveis para o cache */
export function fmtCoord(x: number): string {
  return x.toFixed(4);
}
