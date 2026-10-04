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
  captacao: "Em captação",
  construcao: "Em construção",
  operacao: "Em operação",
};
