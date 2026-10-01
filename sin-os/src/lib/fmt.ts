const tz = "America/Sao_Paulo";

export const nf = (d = 0) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function num(v: number | null | undefined, d = 0): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : nf(d).format(v);
}

export function brl(v: number | null | undefined, d = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `R$ ${nf(d).format(v)}`;
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function pct(v: number | null | undefined, d = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf(d).format(v)}%`;
}

export function signed(v: number | null | undefined, d = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(d).format(Math.abs(v))}`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 0) {
    const f = -s;
    return f < 3600 ? `em ${Math.round(f / 60)} min` : f < 172800 ? `em ${Math.round(f / 3600)} h` : `em ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 172800) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

export const dateTime = (ts: number | null | undefined) =>
  ts ? new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts)) : "—";

export const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
