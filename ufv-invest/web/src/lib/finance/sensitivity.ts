/**
 * Análise de sensibilidade (gráfico tornado): uma variável por vez em torno do caso-base, com a mesma
 * função de fluxo de caixa (buildCashFlows).
 *
 * Decisão de modelagem — CAPEX ±10 %: interpretado como "a mesma usina custa 10 % a mais/menos", logo a
 * CAPTAÇÃO necessária (cotas × preço) varia na mesma proporção, mantida a taxa de estruturação; o
 * seguro (% do CAPEX) e a reposição de inversores acompanham. É a leitura natural para o cotista: um
 * estouro de obra significa pagar mais pelo mesmo fluxo de caixa.
 * OPEX ±20 % aplica-se a O&M, seguro e arrendamento (a taxa de gestão e os tributos seguem a receita).
 * Taxa de desconto ±2 p.p. afeta só o VPL (a TIR não depende dela).
 * Fio B: estresse regulatório com cobrança de 100 % do Fio B a partir de 2026 (inclusive para usinas
 * com direito adquirido), frente à regra da Lei 14.300/2022 do caso-base.
 */

import type { Plant, SensitivityRow } from "@/lib/types";
import { buildCashFlows, type ScenarioParams } from "./cashflow";
import { irr, npv } from "./metrics";

export const FIOB_STRESS_FROM_YEAR = 2026;

export function runSensitivity(plant: Plant, base: ScenarioParams): SensitivityRow[] {
  const evalScenario = (patch: Partial<ScenarioParams>) => {
    const s = { ...base, ...patch };
    const cf = buildCashFlows(plant, s);
    return { irr: irr(cf.flows) ?? NaN, npv: npv(s.discountRatePct, cf.flows) };
  };
  const row = (variable: string, lowLabel: string, highLabel: string, low: Partial<ScenarioParams>, high: Partial<ScenarioParams>): SensitivityRow => {
    const a = evalScenario(low);
    const b = evalScenario(high);
    return { variable, lowLabel, highLabel, irrLowPct: a.irr, irrHighPct: b.irr, npvLowBRL: a.npv, npvHighBRL: b.npv };
  };
  const scaleEnergy = (k: number) => base.energyMWh.map((e) => e * k);

  const rows: SensitivityRow[] = [
    row("Geração de energia", "−10 %", "+10 %", { energyMWh: scaleEnergy(0.9) }, { energyMWh: scaleEnergy(1.1) }),
    row("Tarifa de energia (nível tarifário)", "−10 %", "+10 %", { tariffMult: base.tariffMult * 0.9 }, { tariffMult: base.tariffMult * 1.1 }),
    row("CAPEX (captação necessária)", "−10 %", "+10 %", { capexMult: base.capexMult * 0.9 }, { capexMult: base.capexMult * 1.1 }),
    row("OPEX (O&M, seguro, arrendamento)", "−20 %", "+20 %", { opexMult: base.opexMult * 0.8 }, { opexMult: base.opexMult * 1.2 }),
    row("Taxa de desconto", "−2 p.p.", "+2 p.p.", { discountRatePct: base.discountRatePct - 2 }, { discountRatePct: base.discountRatePct + 2 }),
    row(
      "Desconto ao assinante",
      "−5 p.p.",
      "+5 p.p.",
      { clientDiscountPct: Math.max(0, base.clientDiscountPct - 5) },
      { clientDiscountPct: base.clientDiscountPct + 5 },
    ),
  ];
  if (plant.finance.revenueModel === "gd-assinatura") {
    rows.push(row("Fio B (Lei 14.300/2022)", "Regra de transição (base)", `100 % desde ${FIOB_STRESS_FROM_YEAR}`, {}, { fioBFullFromYear: FIOB_STRESS_FROM_YEAR }));
  }
  // ordena pela amplitude do impacto (TIR; empate → VPL), como num tornado
  const swing = (r: SensitivityRow) => (Number.isFinite(r.irrHighPct - r.irrLowPct) ? Math.abs(r.irrHighPct - r.irrLowPct) : 0);
  return rows.sort((a, b) => swing(b) - swing(a) || Math.abs(b.npvHighBRL - b.npvLowBRL) - Math.abs(a.npvHighBRL - a.npvLowBRL));
}
