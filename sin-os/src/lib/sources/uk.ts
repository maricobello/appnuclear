import { cached } from "../cache";
import { errMsg, fetchJson, probesOf } from "./http";
import { isoDay } from "./time";
import { emptyQuality, type Probe, type SourceResult, type TimeSeries } from "./types";

/**
 * Elexon BMRS Insights API (Reino Unido) — sem chave.
 *  - Market Index Data (APXMIDP): preço de referência de curto prazo por período de 30 min.
 *  - System Buy/Sell Price (imbalance/cash-out) por período de liquidação.
 * https://data.elexon.co.uk/bmrs/api/v1
 * National Energy System Operator — Carbon Intensity API: https://api.carbonintensity.org.uk
 */
export const ELEXON = "https://data.elexon.co.uk/bmrs/api/v1";
export const CARBON = "https://api.carbonintensity.org.uk";

interface MidRow { startTime: string; dataProvider?: string; price: number; volume?: number }
interface SysRow { startTime: string; settlementPeriod: number; systemSellPrice: number; systemBuyPrice: number; netImbalanceVolume?: number }

export async function fetchUkMid(daysBack = 7): Promise<SourceResult<TimeSeries>> {
  const quality = emptyQuality();
  try {
    const from = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 16) + "Z";
    const to = new Date(Date.now() + 86400_000).toISOString().slice(0, 16) + "Z";
    const { value } = await cached(`elexon:mid:${from.slice(0, 13)}`, 2 * 60_000, () =>
      fetchJson<{ data: MidRow[] }>(`${ELEXON}/balancing/pricing/market-index?from=${from}&to=${to}&dataProviders=APXMIDP&format=json`),
    );
    const rows = value.json?.data;
    if (!Array.isArray(rows)) throw new Error("campo data ausente");
    const map = new Map<number, number>();
    for (const r of rows) {
      const t = Date.parse(r.startTime);
      if (!Number.isFinite(t) || !Number.isFinite(r.price)) { quality.invalid++; continue; }
      if (r.volume === 0 && r.price === 0) continue; // período sem negociação
      if (map.has(t)) quality.duplicates++;
      map.set(t, r.price);
    }
    const ts = [...map.keys()].sort((a, b) => a - b);
    const values = ts.map((t) => map.get(t)!);
    quality.points = ts.length;
    quality.latestTs = ts[ts.length - 1] ?? null;
    quality.values = values.slice(-96);
    quality.range = [-1000, 6000];
    return { id: "elexon_mid", ok: ts.length > 0, data: { ts, values, unit: "GBP/MWh" }, probes: value.probes, quality, simulated: false, fetchedAt: Date.now(), error: ts.length ? undefined : "sem períodos com preço" };
  } catch (e) {
    return { id: "elexon_mid", ok: false, data: null, error: errMsg(e), probes: probesOf(e), quality, simulated: false, fetchedAt: Date.now() };
  }
}

export interface SystemPrices { ts: number[]; sbp: number[]; ssp: number[]; niv: number[] }

export async function fetchUkSystemPrices(): Promise<SourceResult<SystemPrices>> {
  const quality = emptyQuality();
  const probes: Probe[] = [];
  try {
    const days = [isoDay(Date.now() - 86400_000), isoDay(Date.now())];
    const rows: SysRow[] = [];
    for (const d of days) {
      const { value } = await cached(`elexon:sys:${d}`, 2 * 60_000, () =>
        fetchJson<{ data: SysRow[] }>(`${ELEXON}/balancing/settlement/system-prices/${d}?format=json`),
      );
      probes.push(...value.probes);
      if (!Array.isArray(value.json?.data)) throw new Error("campo data ausente");
      rows.push(...value.json.data);
    }
    const byT = new Map<number, SysRow>();
    for (const r of rows) {
      const t = Date.parse(r.startTime);
      if (!Number.isFinite(t) || !Number.isFinite(r.systemBuyPrice)) { quality.invalid++; continue; }
      if (byT.has(t)) quality.duplicates++;
      byT.set(t, r);
    }
    const ts = [...byT.keys()].sort((a, b) => a - b);
    const data: SystemPrices = {
      ts,
      sbp: ts.map((t) => byT.get(t)!.systemBuyPrice),
      ssp: ts.map((t) => byT.get(t)!.systemSellPrice),
      niv: ts.map((t) => byT.get(t)!.netImbalanceVolume ?? 0),
    };
    quality.points = ts.length;
    quality.latestTs = ts[ts.length - 1] ?? null;
    quality.values = data.sbp.slice(-48);
    quality.range = [-1000, 10000];
    return { id: "elexon_sysprice", ok: ts.length > 0, data, probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "elexon_sysprice", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}

export interface CarbonNow {
  from: string;
  to: string;
  forecast: number;
  actual: number | null;
  index: string;
  mix: { fuel: string; perc: number }[];
}

export async function fetchUkCarbon(): Promise<SourceResult<CarbonNow>> {
  const quality = emptyQuality();
  const probes: Probe[] = [];
  try {
    const { value: i } = await cached("carbon:intensity", 5 * 60_000, () =>
      fetchJson<{ data: { from: string; to: string; intensity: { forecast: number; actual: number | null; index: string } }[] }>(`${CARBON}/intensity`),
    );
    probes.push(...i.probes);
    const { value: g } = await cached("carbon:generation", 5 * 60_000, () =>
      fetchJson<{ data: { from: string; to: string; generationmix: { fuel: string; perc: number }[] } }>(`${CARBON}/generation`),
    );
    probes.push(...g.probes);
    const row = i.json?.data?.[0];
    if (!row?.intensity) throw new Error("campo intensity ausente");
    quality.points = 1;
    quality.latestTs = Date.parse(row.from);
    quality.values = [row.intensity.forecast];
    quality.range = [0, 800];
    return {
      id: "uk_carbon",
      ok: true,
      data: { from: row.from, to: row.to, ...row.intensity, mix: g.json?.data?.generationmix ?? [] },
      probes,
      quality,
      simulated: false,
      fetchedAt: Date.now(),
    };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "uk_carbon", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}
