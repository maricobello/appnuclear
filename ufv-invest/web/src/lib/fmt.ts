/** Formatação pt-BR compartilhada pela interface. */

const nf = (min: number, max: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return nf(digits, digits).format(v);
}

export function brl(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** R$ 12,4 mi / R$ 830 mil */
export function brlCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}R$ ${num(a / 1e9, 2)} bi`;
  if (a >= 1e6) return `${sign}R$ ${num(a / 1e6, 2)} mi`;
  if (a >= 1e3) return `${sign}R$ ${num(a / 1e3, 0)} mil`;
  return `${sign}${brl(a)}`;
}

export function pct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = `${nf(digits, digits).format(v)}%`;
  return signed && v > 0 ? `+${s}` : s;
}

export function usdt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${nf(digits, digits).format(v)} USDT`;
}

export function years(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "não se paga no horizonte";
  const y = Math.floor(v);
  const m = Math.round((v - y) * 12);
  if (m === 12) return `${y + 1} anos`;
  return m ? `${y} anos e ${m} ${m === 1 ? "mês" : "meses"}` : `${y} anos`;
}

export function dateBR(iso: string | number | Date | null | undefined, withTime = false): string {
  if (iso == null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" } : { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(d);
}

export function shortAddr(a?: string | null, n = 4): string {
  if (!a) return "";
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const statusLabel: Record<string, string> = {
  operacao: "Em operação",
  implantacao: "Em implantação",
  encerrada: "Oferta encerrada",
};

/* ─── Formatação por idioma (interface multilíngue) ─── */

const YEARS: Record<string, { y: (n: number) => string; ym: (y: number, m: number) => string; never: string }> = {
  pt: { y: (n) => `${n} ${n === 1 ? "ano" : "anos"}`, ym: (y, m) => `${y} anos e ${m} ${m === 1 ? "mês" : "meses"}`, never: "não se paga no horizonte" },
  en: { y: (n) => `${n} ${n === 1 ? "year" : "years"}`, ym: (y, m) => `${y} years ${m} ${m === 1 ? "month" : "months"}`, never: "no payback within the horizon" },
  es: { y: (n) => `${n} ${n === 1 ? "año" : "años"}`, ym: (y, m) => `${y} años y ${m} ${m === 1 ? "mes" : "meses"}`, never: "no se recupera en el horizonte" },
  fr: { y: (n) => `${n} ${n === 1 ? "an" : "ans"}`, ym: (y, m) => `${y} ans et ${m} mois`, never: "pas de retour sur l’horizon" },
  de: { y: (n) => `${n} ${n === 1 ? "Jahr" : "Jahre"}`, ym: (y, m) => `${y} Jahre und ${m} ${m === 1 ? "Monat" : "Monate"}`, never: "keine Amortisation im Zeitraum" },
  zh: { y: (n) => `${n} 年`, ym: (y, m) => `${y} 年 ${m} 个月`, never: "期限内无法回本" },
  ja: { y: (n) => `${n} 年`, ym: (y, m) => `${y} 年 ${m} か月`, never: "期間内に回収できません" },
};

/** Conjunto de formatadores para um idioma (números e datas no padrão local; valores em reais). */
export function makeFmt(locale: string) {
  const tag = ({ pt: "pt-BR", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", zh: "zh-CN", ja: "ja-JP" } as Record<string, string>)[locale] ?? "pt-BR";
  const yr = YEARS[locale] ?? YEARS.pt;
  const nfL = (min: number, max: number) => new Intl.NumberFormat(tag, { minimumFractionDigits: min, maximumFractionDigits: max });
  const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
  const f = {
    locale,
    tag,
    num: (v: number | null | undefined, digits = 0) => (ok(v) ? nfL(digits, digits).format(v) : "—"),
    brl: (v: number | null | undefined, digits = 2) =>
      ok(v) ? new Intl.NumberFormat(tag, { style: "currency", currency: "BRL", currencyDisplay: "symbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v) : "—",
    brlCompact: (v: number | null | undefined) => {
      if (!ok(v)) return "—";
      if (locale === "pt") return brlCompact(v);
      return new Intl.NumberFormat(tag, { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 2 }).format(v);
    },
    pct: (v: number | null | undefined, digits = 1, signed = false) => {
      if (!ok(v)) return "—";
      const s = `${nfL(digits, digits).format(v)}%`;
      return signed && v > 0 ? `+${s}` : s;
    },
    usdt: (v: number | null | undefined, digits = 2) => (ok(v) ? `${nfL(digits, digits).format(v)} USDT` : "—"),
    years: (v: number | null | undefined) => {
      if (!ok(v)) return yr.never;
      const y = Math.floor(v);
      const m = Math.round((v - y) * 12);
      if (m === 12) return yr.y(y + 1);
      return m ? yr.ym(y, m) : yr.y(y);
    },
    /** "N anos" inteiro, com plural correto */
    nYears: (n: number) => yr.y(n),
    date: (iso: string | number | Date | null | undefined, withTime = false) => {
      if (iso == null) return "—";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "—";
      // fora do português, data por extenso curta (evita a ambiguidade 4/9 × 9/4)
      const dateStyle = locale === "pt" ? "short" : "medium";
      return new Intl.DateTimeFormat(tag, withTime ? { dateStyle, timeStyle: "short", timeZone: "America/Sao_Paulo" } : { dateStyle, timeZone: "America/Sao_Paulo" }).format(d);
    },
    /** Abreviações dos meses (jan…dez) no idioma */
    months: Array.from({ length: 12 }, (_, i) =>
      locale === "pt" ? MONTHS[i] : new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 15))).replace(".", ""),
    ),
    monthYear: (d: Date) => new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit", timeZone: "UTC" }).format(d),
  };
  return f;
}
export type Fmt = ReturnType<typeof makeFmt>;
