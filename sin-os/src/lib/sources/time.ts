/**
 * Horário de Brasília: UTC−3 fixo (horário de verão extinto em 2019 — Decreto 9.772/2019).
 * Todo o mercado brasileiro (PLD, CMO, carga) é publicado em hora local.
 */
export const BRT_OFFSET_H = 3;

/** Timestamp UTC (ms) do início da hora local BRT. */
export const brtToUtc = (y: number, m: number, d: number, h = 0, min = 0): number =>
  Date.UTC(y, m - 1, d, h + BRT_OFFSET_H, min);

/** Data local BRT (YYYY-MM-DD) de um instante UTC. */
export function brtDate(ts: number): string {
  return new Date(ts - BRT_OFFSET_H * 3600_000).toISOString().slice(0, 10);
}

export function brtHour(ts: number): number {
  return new Date(ts - BRT_OFFSET_H * 3600_000).getUTCHours();
}

/** Dia da semana (0=dom) no fuso BRT. */
export function brtDow(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Converte "YYYY-MM-DD HH:MM[:SS]" ou "YYYY-MM-DDTHH:MM" local BRT → UTC ms. */
export function parseBrtDateTime(s: string): number {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return brtToUtc(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  const br = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/);
  if (br) return brtToUtc(+br[3], +br[2], +br[1], br[4] ? +br[4] : 0, br[5] ? +br[5] : 0);
  return NaN;
}

export const isoDay = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

export function addDays(dateStr: string, n: number): string {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86400_000;
  return isoDay(t);
}

export const todayBrt = (): string => brtDate(Date.now());
