import { PLD_LIMITS } from "../market/brazil";
import type { SourceId } from "./types";

/**
 * Faixas plausíveis/regulatórias por fonte: valor fora delas reprova a checagem de validade do
 * auditor. Ficam num lugar só para a página de metodologia mostrar exatamente o que é aplicado.
 */
const PLD_RANGE = { range: [PLD_LIMITS.min - 0.5, PLD_LIMITS.maxHourly + 0.5] as [number, number], unit: "R$/MWh", why: "piso e teto horário da ANEEL (± R$ 0,50 de arredondamento)" };

export const VALID_RANGES: Record<SourceId, { range: [number, number]; unit: string; why: string }> = {
  ccee_pld: PLD_RANGE,
  ccee_pi: PLD_RANGE,
  ons_cmo: { range: [-1, 5000] as [number, number], unit: "R$/MWh", why: "CMO não é limitado pelo piso/teto; acima de R$ 5.000 é suspeito" },
  ons_ear: { range: [0, 100.5] as [number, number], unit: "% EARmax", why: "percentual da capacidade (tolerância de arredondamento)" },
  ons_ena: { range: [0, 1000] as [number, number], unit: "% MLT", why: "cheias extremas passam de 200% da MLT; 1000% indica erro" },
  ons_carga: { range: [0, 120_000] as [number, number], unit: "MWmed", why: "carga horária de um submercado" },
  ons_curtailment: { range: [0, 1_000_000] as [number, number], unit: "MWh/dia", why: "corte diário total" },
  ons_balanco: { range: [0, 120_000] as [number, number], unit: "MWmed", why: "carga horária no balanço" },
  energy_charts: { range: [-500, 4000] as [number, number], unit: "€/MWh", why: "preço mínimo e máximo harmonizados do SDAC" },
  elexon_mid: { range: [-1000, 6000] as [number, number], unit: "£/MWh", why: "faixa observada do índice de mercado" },
  elexon_sysprice: { range: [-1000, 10000] as [number, number], unit: "£/MWh", why: "preço de desequilíbrio pode disparar" },
  uk_carbon: { range: [0, 800] as [number, number], unit: "gCO₂/kWh", why: "intensidade de carbono do sistema britânico" },
  open_meteo: { range: [-20, 55] as [number, number], unit: "°C", why: "temperatura nos hubs do SIN" },
  open_meteo_ens: { range: [0, 1500] as [number, number], unit: "mm/15 dias", why: "chuva acumulada nas bacias" },
  bcb_fx: { range: [0.5, 20] as [number, number], unit: "R$ por moeda", why: "câmbio USD, EUR e GBP" },
  eia: { range: [0, 300] as [number, number], unit: "US$", why: "Henry Hub e Brent" },
};
