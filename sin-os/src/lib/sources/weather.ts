import { cached } from "../cache";
import { quantile } from "../quant/stats";
import { errMsg, fetchJson, probesOf } from "./http";
import { parseBrtDateTime } from "./time";
import { emptyQuality, type SourceResult, type Sub } from "./types";

/**
 * Open-Meteo (sem chave, CC BY 4.0): previsão determinística (modelos "best match")
 * e ensemble ECMWF IFS 0.25° (51 membros) para risco hidrológico.
 * https://open-meteo.com/en/docs · https://open-meteo.com/en/docs/ensemble-api
 */
export const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const OM_ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";

export interface Hub {
  id: string;
  name: string;
  lat: number;
  lon: number;
  role: "carga" | "eólica" | "solar" | "hidro";
  sub: Sub;
}

/** Pontos físicos que movem o preço do SIN: centros de carga, polos eólicos/solares e bacias. */
export const HUBS: Hub[] = [
  { id: "sp", name: "São Paulo", lat: -23.55, lon: -46.63, role: "carga", sub: "SE" },
  { id: "poa", name: "Porto Alegre", lat: -30.03, lon: -51.23, role: "carga", sub: "S" },
  { id: "rec", name: "Recife", lat: -8.05, lon: -34.9, role: "carga", sub: "NE" },
  { id: "bel", name: "Belém", lat: -1.46, lon: -48.49, role: "carga", sub: "N" },
  { id: "rn", name: "Parazinho/RN", lat: -5.22, lon: -35.84, role: "eólica", sub: "NE" },
  { id: "ba", name: "Caetité/BA", lat: -14.07, lon: -42.48, role: "eólica", sub: "NE" },
  { id: "mg", name: "Pirapora/MG", lat: -17.35, lon: -44.94, role: "solar", sub: "SE" },
  { id: "furnas", name: "Bacia Rio Grande (Furnas)", lat: -20.67, lon: -46.32, role: "hidro", sub: "SE" },
  { id: "itaipu", name: "Bacia Paraná (Itaipu)", lat: -25.41, lon: -54.59, role: "hidro", sub: "SE" },
  { id: "sobradinho", name: "Bacia S. Francisco (Sobradinho)", lat: -9.43, lon: -40.83, role: "hidro", sub: "NE" },
  { id: "tucurui", name: "Bacia Tocantins (Tucuruí)", lat: -3.83, lon: -49.65, role: "hidro", sub: "N" },
];

interface OmHourly {
  time: string[];
  temperature_2m?: number[];
  shortwave_radiation?: number[];
  wind_speed_100m?: number[];
  precipitation?: number[];
}
interface OmResponse {
  latitude: number;
  longitude: number;
  hourly: OmHourly;
  daily?: { time: string[]; precipitation_sum?: number[] };
}

/** Curva de potência genérica IEC classe II (cut-in 3, nominal 12, cut-out 25 m/s). */
export const windCf = (v: number) => (v < 3 || v > 25 ? 0 : v >= 12 ? 1 : ((v - 3) / 9) ** 3);
/** Fator de capacidade FV aproximado (PR = 0,8 sobre 1000 W/m² STC). */
export const solarCf = (ghi: number) => Math.min(1, Math.max(0, (ghi / 1000) * 0.8 * 1.1));

export interface HubForecast {
  hub: Hub;
  ts: number[];
  temp: number[];
  ghi: number[];
  wind100: number[];
  precip: number[];
  dailyPrecip16: { dates: string[]; mm: number[] };
}

export async function fetchWeather(): Promise<SourceResult<HubForecast[]>> {
  const quality = emptyQuality();
  try {
    const lat = HUBS.map((h) => h.lat).join(",");
    const lon = HUBS.map((h) => h.lon).join(",");
    const url =
      `${OM_FORECAST}?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,shortwave_radiation,wind_speed_100m,precipitation&daily=precipitation_sum` +
      `&wind_speed_unit=ms&forecast_days=16&timezone=America%2FSao_Paulo`;
    const { value } = await cached("om:forecast", 30 * 60_000, () => fetchJson<OmResponse | OmResponse[]>(url));
    const arr = Array.isArray(value.json) ? value.json : [value.json];
    if (arr.length !== HUBS.length) quality.schemaIssues.push(`esperava ${HUBS.length} locais, recebeu ${arr.length}`);
    const out: HubForecast[] = arr.map((r, i) => {
      const hh = r.hourly;
      if (!hh?.time) throw new Error("bloco hourly ausente");
      const n = Math.min(hh.time.length, 7 * 24);
      return {
        hub: HUBS[i],
        ts: hh.time.slice(0, n).map(parseBrtDateTime),
        temp: (hh.temperature_2m ?? []).slice(0, n),
        ghi: (hh.shortwave_radiation ?? []).slice(0, n),
        wind100: (hh.wind_speed_100m ?? []).slice(0, n),
        precip: (hh.precipitation ?? []).slice(0, n),
        dailyPrecip16: { dates: r.daily?.time ?? [], mm: r.daily?.precipitation_sum ?? [] },
      };
    });
    quality.points = out.reduce((s, h) => s + h.ts.length, 0);
    quality.latestTs = Date.now(); // previsão: frescor medido pela emissão (sempre atual quando responde)
    quality.values = out.flatMap((h) => h.temp.slice(0, 24));
    quality.range = [-20, 55];
    return { id: "open_meteo", ok: true, data: out, probes: value.probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    return { id: "open_meteo", ok: false, data: null, error: errMsg(e), probes: probesOf(e), quality, simulated: false, fetchedAt: Date.now() };
  }
}

export interface BasinEnsemble {
  hub: Hub;
  members: number;
  horizonDays: number;
  p10: number;
  p50: number;
  p90: number;
  cumulative: { day: number; p10: number; p50: number; p90: number }[];
}

/** Precipitação acumulada 15 dias por bacia a partir do ensemble ECMWF (P10/P50/P90). */
export async function fetchBasinEnsemble(): Promise<SourceResult<BasinEnsemble[]>> {
  const quality = emptyQuality();
  const basins = HUBS.filter((h) => h.role === "hidro");
  try {
    const url =
      `${OM_ENSEMBLE}?latitude=${basins.map((b) => b.lat).join(",")}&longitude=${basins.map((b) => b.lon).join(",")}` +
      `&hourly=precipitation&models=ecmwf_ifs025&forecast_days=15&timezone=America%2FSao_Paulo`;
    const { value } = await cached("om:ensemble", 60 * 60_000, () =>
      fetchJson<{ hourly: Record<string, (number | null)[]> & { time: string[] } } | { hourly: Record<string, (number | null)[]> & { time: string[] } }[]>(url, { timeoutMs: 30_000 }),
    );
    const arr = Array.isArray(value.json) ? value.json : [value.json];
    const out: BasinEnsemble[] = arr.map((r, i) => {
      const keys = Object.keys(r.hourly).filter((k) => k === "precipitation" || k.startsWith("precipitation_member"));
      if (!keys.length) throw new Error("membros de precipitação ausentes");
      const hours = r.hourly.time.length;
      const days = Math.floor(hours / 24);
      const cumByMember = keys.map((k) => {
        const s = r.hourly[k];
        const cum: number[] = [];
        let acc = 0;
        for (let d = 0; d < days; d++) {
          for (let h = 0; h < 24; h++) acc += s[d * 24 + h] ?? 0;
          cum.push(acc);
        }
        return cum;
      });
      const cumulative = Array.from({ length: days }, (_, d) => {
        const col = cumByMember.map((c) => c[d]);
        return { day: d + 1, p10: quantile(col, 0.1), p50: quantile(col, 0.5), p90: quantile(col, 0.9) };
      });
      const last = cumulative[cumulative.length - 1];
      return { hub: basins[i], members: keys.length, horizonDays: days, p10: last.p10, p50: last.p50, p90: last.p90, cumulative };
    });
    quality.points = out.length;
    quality.latestTs = Date.now();
    quality.values = out.map((b) => b.p50);
    quality.range = [0, 1500];
    return { id: "open_meteo_ens", ok: true, data: out, probes: value.probes, quality, simulated: false, fetchedAt: Date.now() };
  } catch (e) {
    return { id: "open_meteo_ens", ok: false, data: null, error: errMsg(e), probes: probesOf(e), quality, simulated: false, fetchedAt: Date.now() };
  }
}
