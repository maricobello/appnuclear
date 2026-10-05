/**
 * Regras regulatórias da geração distribuída — Lei 14.300/2022 (Marco Legal da Microgeração e
 * Minigeração Distribuída), publicada em 07/01/2022.
 *
 *  - Art. 26: unidades existentes ou com solicitação de acesso protocolada em até 12 meses da
 *    publicação (até 07/01/2023) mantêm a compensação integral, sem cobrança da TUSD Fio B, até
 *    31/12/2045. Granularidade anual aqui: accessRequestYear ≤ 2022 ⇒ direito adquirido.
 *  - Art. 27: demais unidades pagam, sobre a energia compensada, um percentual crescente das
 *    componentes de remuneração, depreciação e O&M da distribuição (TUSD Fio B): 15 % em 2023,
 *    30 % em 2024, 45 % em 2025, 60 % em 2026, 75 % em 2027, 90 % em 2028 e, a partir de 2029, a regra
 *    do art. 17 (valoração pela ANEEL dos custos e benefícios da GD).
 *
 * PREMISSAS (declaradas nas premissas da análise):
 *  - a partir de 2029 a valoração da ANEEL mantém a cobrança em 100 % do Fio B (cenário conservador,
 *    sem crédito pelos benefícios da GD);
 *  - anos-calendário anteriores ao ano da solicitação seguem o calendário do art. 27 (a tabela é por
 *    ano-calendário, não por idade da usina);
 *  - o §1º do art. 27 (minigeração > 500 kW em autoconsumo remoto ou geração compartilhada com um
 *    titular ≥ 25 % dos créditos: 100 % do Fio B, 40 % do Fio A, TFSEE e P&D até 2028) NÃO se aplica:
 *    assume-se carteira pulverizada de assinantes, nenhum com ≥ 25 % dos créditos.
 */

const ART27_SCHEDULE: Record<number, number> = { 2023: 15, 2024: 30, 2025: 45, 2026: 60, 2027: 75, 2028: 90 };

/** último ano do direito adquirido (art. 26) */
export const GRANDFATHER_UNTIL_YEAR = 2045;

/** Percentual do Fio B cobrado sobre a energia compensada no ano-calendário, % */
export function fioBChargedPct(accessRequestYear: number, calendarYear: number): number {
  if (accessRequestYear <= 2022) return calendarYear <= GRANDFATHER_UNTIL_YEAR ? 0 : 100;
  if (calendarYear < 2023) return 0;
  if (calendarYear >= 2029) return 100;
  return ART27_SCHEDULE[calendarYear];
}
