/**
 * Calendário do contrato: dias do horizonte, feriados nacionais e o "dia equivalente" do histórico.
 *
 * O preço e a carga de cada dia do contrato vêm de um dia real do passado com o mesmo tipo (útil,
 * sábado, domingo ou feriado) e o mesmo mês civil, o mais perto possível de 52 semanas antes (364
 * dias preservam o dia da semana). Assim o que acontece dentro do mês — fim de semana mais barato,
 * feriado com carga menor — entra no custo, em vez de uma média mês × hora.
 */

export type DayType = "util" | "sab" | "dom"; // dom = domingo ou feriado nacional

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const toUtc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fromUtc(toUtc(s) + n * 86_400_000);

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(y, month, day);
}

const holidayCache = new Map<number, Set<string>>();
/** Feriados nacionais e os dias que param o país (carnaval, Sexta-feira Santa, Corpus Christi). */
export function nationalHolidays(y: number): Set<string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"].map((md) => `${y}-${md}`);
  const e = easter(y);
  const s = new Set([...fixed, addDays(e, -48), addDays(e, -47), addDays(e, -2), addDays(e, 60)]);
  holidayCache.set(y, s);
  return s;
}

export function dayType(s: string): DayType {
  if (nationalHolidays(Number(s.slice(0, 4))).has(s)) return "dom";
  const dow = new Date(toUtc(s)).getUTCDay();
  return dow === 0 ? "dom" : dow === 6 ? "sab" : "util";
}

/** Todos os dias dos meses AAAA-MM, em ordem. */
export function daysOfMonths(months: string[]): { date: string; month: number }[] {
  const out: { date: string; month: number }[] = [];
  months.forEach((ym, mi) => {
    const y = Number(ym.slice(0, 4));
    const mo = Number(ym.slice(5, 7));
    const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    for (let d = 1; d <= n; d++) out.push({ date: isoDate(y, mo, d), month: mi });
  });
  return out;
}

/**
 * Dia do histórico equivalente a `target`: mesmo tipo de dia e mesmo mês civil, o mais perto de
 * 52·k semanas antes (k = 1, 2, 3), entre os dias em que `has` é verdadeiro. Null se não houver.
 */
export function equivalentDay(target: string, has: (d: string) => boolean, maxYears = 3): string | null {
  const type = dayType(target);
  const month = target.slice(5, 7);
  for (let k = 1; k <= maxYears; k++) {
    const base = addDays(target, -364 * k);
    for (let off = 0; off <= 21; off++) {
      for (const sgn of off === 0 ? [0] : [-1, 1]) {
        const d = addDays(base, sgn * off);
        if (d.slice(5, 7) === month && dayType(d) === type && has(d)) return d;
      }
    }
  }
  return null;
}
