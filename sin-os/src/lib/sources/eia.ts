import { cached } from "../cache";
import { errMsg, fetchJson, probesOf } from "./http";
import { emptyQuality, type Probe, type SourceResult, type TimeSeries } from "./types";

/**
 * U.S. EIA Open Data API v2 (chave gratuita: https://www.eia.gov/opendata/register.php).
 * Henry Hub spot (RNGWHHD, US$/MMBtu) e Brent spot (RBRTE, US$/bbl) — custo marginal
 * de térmicas a gás/óleo, âncora do CVU no Brasil e do preço marginal na Europa.
 * Opcional: só roda com EIA_API_KEY definida.
 */
export const EIA = "https://api.eia.gov/v2";

interface EiaResp { response?: { data?: { period: string; value: number | string }[] } }

export async function fetchEia(): Promise<SourceResult<{ henryHub: TimeSeries; brent: TimeSeries }>> {
  const key = process.env.EIA_API_KEY;
  const quality = emptyQuality();
  if (!key) {
    return { id: "eia", ok: false, data: null, error: "EIA_API_KEY não configurada (opcional)", probes: [], quality, simulated: false, fetchedAt: Date.now() };
  }
  const probes: Probe[] = [];
  try {
    const get = async (route: string, series: string, unit: string): Promise<TimeSeries> => {
      const url =
        `${EIA}/${route}/data/?api_key=${key}&frequency=daily&data[0]=value&facets[series][]=${series}` +
        `&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=90`;
      const { value } = await cached(`eia:${series}`, 6 * 3600_000, () => fetchJson<EiaResp>(url));
      probes.push(...value.probes);
      const rows = value.json.response?.data;
      if (!Array.isArray(rows)) throw new Error(`EIA ${series}: response.data ausente`);
      const clean = rows.map((r) => ({ t: Date.parse(r.period), v: Number(r.value) })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v));
      clean.sort((a, b) => a.t - b.t);
      return { ts: clean.map((r) => r.t), values: clean.map((r) => r.v), unit };
    };
    const henryHub = await get("natural-gas/pri/fut", "RNGWHHD", "US$/MMBtu");
    const brent = await get("petroleum/pri/spt", "RBRTE", "US$/bbl");
    quality.points = henryHub.values.length + brent.values.length;
    quality.latestTs = Math.min(henryHub.ts[henryHub.ts.length - 1] ?? 0, brent.ts[brent.ts.length - 1] ?? 0);
    quality.values = [...henryHub.values.slice(-10), ...brent.values.slice(-10)];
    quality.range = [0, 300];
    return { id: "eia", ok: true, data: { henryHub, brent }, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "eia", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}
