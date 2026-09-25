import { cached } from "../cache";
import { num } from "./csv";
import { errMsg, fetchJson, probesOf } from "./http";
import { parseBrtDateTime } from "./time";
import { emptyQuality, type Probe, type SourceResult } from "./types";

/**
 * Banco Central do Brasil — SGS (Sistema Gerenciador de Séries Temporais), sem chave.
 *  1     Dólar americano (venda), livre
 *  21619 Euro (venda)
 *  21623 Libra esterlina (venda)
 * https://dadosabertos.bcb.gov.br
 */
export const BCB = "https://api.bcb.gov.br/dados/serie";
const SERIES = { USD: 1, EUR: 21619, GBP: 21623 } as const;
export type Ccy = keyof typeof SERIES;

export interface FxQuote { rate: number; date: string; ts: number; history: { date: string; rate: number }[] }
export type FxData = Record<Ccy, FxQuote>;

export async function fetchFx(): Promise<SourceResult<FxData>> {
  const quality = emptyQuality();
  const probes: Probe[] = [];
  try {
    const out: Partial<FxData> = {};
    for (const [ccy, code] of Object.entries(SERIES) as [Ccy, number][]) {
      const { value } = await cached(`bcb:${code}`, 30 * 60_000, () =>
        fetchJson<{ data: string; valor: string }[]>(`${BCB}/bcdata.sgs.${code}/dados/ultimos/20?formato=json`),
      );
      probes.push(...value.probes);
      if (!Array.isArray(value.json) || !value.json.length) throw new Error(`série ${code} vazia`);
      const hist = value.json
        .map((r) => ({ date: r.data, rate: num(r.valor) }))
        .filter((r) => Number.isFinite(r.rate));
      quality.invalid += value.json.length - hist.length;
      const last = hist[hist.length - 1];
      out[ccy] = { rate: last.rate, date: last.date, ts: parseBrtDateTime(last.date), history: hist };
    }
    const data = out as FxData;
    quality.points = Object.values(data).reduce((s, q) => s + q.history.length, 0);
    quality.latestTs = Math.min(...Object.values(data).map((q) => q.ts));
    quality.values = Object.values(data).map((q) => q.rate);
    quality.range = [0.5, 20];
    return { id: "bcb_fx", ok: true, data, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "bcb_fx", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}
