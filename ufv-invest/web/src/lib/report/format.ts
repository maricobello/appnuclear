/**
 * Formatação pt-BR determinística (sem depender do ICU do runtime): números, moeda, percentuais,
 * datas e coordenadas. Usa espaço comum entre "R$" e o valor e antes de "%" — o motor de layout
 * trata esses espaços como inquebráveis ao quebrar linhas.
 */

const MINUS = "-";

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** 1234567.891 → "1.234.567,89" (decimals = 2). Valores não finitos → "—". */
export function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (!isFiniteNumber(n)) return "—";
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const isZero = Number(fixed) === 0;
  const sign = n < 0 && !isZero ? MINUS : "";
  return sign + grouped + (frac ? "," + frac : "");
}

/** Número com sinal explícito: +1,2 / -0,8 */
export function fmtSigned(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "—";
  const s = fmtNum(n, decimals);
  return n > 0 && Number(Math.abs(n).toFixed(decimals)) !== 0 ? "+" + s : s;
}

/** R$ 1.234,56 · -R$ 1.234,56 */
export function fmtBRL(n: number | null | undefined, decimals = 2): string {
  if (!isFiniteNumber(n)) return "—";
  const body = fmtNum(Math.abs(n), decimals);
  const isZero = Number(Math.abs(n).toFixed(decimals)) === 0;
  return (n < 0 && !isZero ? MINUS : "") + "R$ " + body;
}

/** Moeda compacta: R$ 13,0 mi · R$ 850 mil · R$ 1,25 bi · R$ 950 */
export function fmtBRLCompact(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  if (a >= 1e9) return `${sign}R$ ${fmtNum(a / 1e9, decimals + 1)} bi`;
  if (a >= 1e6) return `${sign}R$ ${fmtNum(a / 1e6, decimals + (a < 1e7 ? 1 : 0))} mi`;
  if (a >= 1e4) return `${sign}R$ ${fmtNum(a / 1e3, 0)} mil`;
  return `${sign}R$ ${fmtNum(a, a >= 100 ? 0 : 2)}`;
}

/** Percentual em pontos percentuais (12.34 → "12,3 %") */
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "—";
  return `${fmtNum(n, decimals)} %`;
}

/** Diferença em pontos percentuais com sinal (3.21 → "+3,2 p.p.") */
export function fmtPp(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "—";
  return `${fmtSigned(n, decimals)} p.p.`;
}

/** Variação percentual com sinal (1.2 → "+1,2 %") */
export function fmtPctSigned(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "—";
  return `${fmtSigned(n, decimals)} %`;
}

export function fmtYears(n: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(n)) return "não atingido";
  return `${fmtNum(n, decimals)} ${Number(n.toFixed(decimals)) === 1 ? "ano" : "anos"}`;
}

export function fmtMultiple(n: number | null | undefined, decimals = 2): string {
  if (!isFiniteNumber(n)) return "—";
  return `${fmtNum(n, decimals)}x`;
}

// ─── Datas (horário de Brasília, UTC-3 sem horário de verão desde 2019) ─────────────────────

const BRT_OFFSET_MS = -3 * 3600 * 1000;

function toDate(d: Date | string | number): Date | null {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function brtParts(d: Date) {
  const s = new Date(d.getTime() + BRT_OFFSET_MS);
  const pad = (v: number) => String(v).padStart(2, "0");
  return {
    dd: pad(s.getUTCDate()),
    mm: pad(s.getUTCMonth() + 1),
    yyyy: String(s.getUTCFullYear()),
    hh: pad(s.getUTCHours()),
    mi: pad(s.getUTCMinutes()),
  };
}

/** dd/mm/aaaa no horário de Brasília. Datas só com dia (aaaa-mm-dd) são mantidas sem fuso. */
export function fmtDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === "") return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }
  const date = toDate(d);
  if (!date) return "—";
  const p = brtParts(date);
  return `${p.dd}/${p.mm}/${p.yyyy}`;
}

/** dd/mm/aaaa hh:mm (horário de Brasília) */
export function fmtDateTime(d: Date | string | number | null | undefined, withZone = false): string {
  if (d === null || d === undefined || d === "") return "—";
  const date = toDate(d);
  if (!date) return "—";
  const p = brtParts(date);
  return `${p.dd}/${p.mm}/${p.yyyy} ${p.hh}:${p.mi}${withZone ? " (BRT)" : ""}`;
}

/** aaaammdd no horário de Brasília (para IDs) */
export function compactDate(d: Date): string {
  const p = brtParts(d);
  return `${p.yyyy}${p.mm}${p.dd}`;
}

export const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// ─── Coordenadas ────────────────────────────────────────────────────────────────────────────

/** -15.835 → "-15,8350°" */
export function fmtDecimalDeg(v: number, decimals = 4): string {
  return `${fmtNum(v, decimals)}°`;
}

/** Graus-minutos-segundos com hemisfério em português: 15°50'06,0" S · 43°16'40,8" O */
export function fmtDMS(v: number, axis: "lat" | "lon"): string {
  if (!isFiniteNumber(v)) return "—";
  const hemi = axis === "lat" ? (v < 0 ? "S" : "N") : v < 0 ? "O" : "L";
  const a = Math.abs(v);
  let deg = Math.floor(a);
  let min = Math.floor((a - deg) * 60);
  let sec = Math.round(((a - deg) * 60 - min) * 60 * 10) / 10;
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  return `${deg}°${String(min).padStart(2, "0")}'${fmtNum(sec, 1).padStart(4, "0")}" ${hemi}`;
}

// ─── Texto ──────────────────────────────────────────────────────────────────────────────────

/** Encurta no meio: "0x1234…abcd" */
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/** Encurta no fim: "https://power.larc.nasa.gov/api/…" */
export function truncateEnd(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/** Hash curto para rodapé: 8 primeiros + 4 últimos */
export function shortHash(hash: string): string {
  const h = hash.replace(/^0x/, "");
  if (h.length <= 14) return h;
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

/** Agrupa um hash hex em blocos de 8 caracteres separados por espaço */
export function groupHex(hash: string, size = 8): string[] {
  const h = hash.replace(/^0x/, "");
  const out: string[] = [];
  for (let i = 0; i < h.length; i += size) out.push(h.slice(i, i + size));
  return out;
}

/** Remove protocolo e "www." de uma URL para exibição */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}
