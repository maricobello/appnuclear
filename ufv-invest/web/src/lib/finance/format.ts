/**
 * Formatação pt-BR determinística para os textos de premissas e método (vão para a tela e o PDF).
 * Não usa Intl de propósito: evita espaços não separáveis (U+00A0/U+202F) que algumas fontes
 * embarcadas no PDF não possuem e garante a mesma saída em qualquer runtime.
 */

/** 1234567.891 → "1.234.567,89" */
export function fmtNum(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return "—";
  const fixed = Math.abs(x).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const intSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const negative = x < 0 && Number(fixed) !== 0;
  return `${negative ? "-" : ""}${intSep}${frac ? `,${frac}` : ""}`;
}

/** "R$ 1.234,56" */
export function fmtBRL(x: number, decimals = 0): string {
  if (!Number.isFinite(x)) return "—";
  return x < 0 ? `-R$ ${fmtNum(-x, decimals)}` : `R$ ${fmtNum(x, decimals)}`;
}

/** "12,5 %" (pontos percentuais) */
export function fmtPct(x: number, decimals = 1): string {
  return `${fmtNum(x, decimals)} %`;
}
