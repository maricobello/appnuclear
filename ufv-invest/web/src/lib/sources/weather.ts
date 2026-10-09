/**
 * Open-Meteo Forecast (https://open-meteo.com/en/docs) — condições atuais e previsão de 7 dias.
 *
 * Convenções de tempo (IMPORTANTE para quem calcula a posição do Sol):
 *  - Tudo em UTC (`timezone=GMT`); horários devolvidos como ISO com "Z".
 *  - Radiação horária do Open-Meteo é a MÉDIA DA HORA ANTERIOR ao carimbo (backward-averaged).
 *    `hourly[].time` mantém o CARIMBO ORIGINAL = FIM do intervalo de média (ex.: "13:00Z" = média
 *    de 12:00–13:00). Para a posição do Sol use o centro: time − 30 min (é o que
 *    `buildLive` em lib/analysis.ts já faz). Temperatura e vento são instantâneos no carimbo.
 *  - `time` (atual) = instante do bloco "current" do Open-Meteo (dados de 15 min: a radiação é a
 *    média dos 15 min anteriores ⇒ centro = time − 7,5 min), sem deslocamento.
 *  - `daily[].date` = dia UTC; `shortwave_radiation_sum` chega em MJ/m² e é convertido para kWh/m².
 *    `cloud_cover_mean` diário pode não existir em todos os modelos ⇒ média do `cloud_cover` horário.
 *
 * Falha ⇒ `null`.
 */
import { z } from "zod";
import type { Plant, Provenance } from "@/lib/types";
import { SourceError, describeError, fetchJson, joinNotes, provenanceFromResult, warnSource, type FetchJsonResult, type SourceOptions } from "./http";
import { dailyIrradiationFactorToKWh, fmtCoord, mean, round } from "./units";

export const WEATHER_REVALIDATE_SEC = 15 * 60;
const WEATHER_TIMEOUT_MS = 8_000;
const HALF_HOUR_MS = 30 * 60_000;

export interface LiveWeatherHour {
  /** UTC ISO, carimbo do Open-Meteo = FIM da hora de média da radiação (centro = time − 30 min) */
  time: string;
  ghiWm2: number;
  dhiWm2: number;
  dniWm2: number;
  tempC: number;
  windMs: number;
  cloudCoverPct?: number;
}

export interface LiveWeather {
  /** ISO UTC do bloco "current" do Open-Meteo (resolução de 15 min) */
  time: string;
  ghiWm2: number;
  dhiWm2: number;
  dniWm2: number;
  tempC: number;
  windMs: number;
  cloudCoverPct: number;
  isDay: boolean;
  /** próximos 7 dias, horário; `time` = fim do intervalo de média (ver nota acima) */
  hourly: LiveWeatherHour[];
  /** 7 dias (dia UTC) */
  daily: { date: string; ghiKWhM2: number; tempMaxC: number; cloudCoverPct: number }[];
  provenance: Provenance;
}

const CURRENT_VARS = "temperature_2m,shortwave_radiation,diffuse_radiation,direct_normal_irradiance,cloud_cover,wind_speed_10m,is_day";
const HOURLY_VARS = "shortwave_radiation,diffuse_radiation,direct_normal_irradiance,temperature_2m,wind_speed_10m,cloud_cover";

export function forecastUrl(lat: number, lon: number, withDailyCloudMean = true): string {
  const daily = `shortwave_radiation_sum,temperature_2m_max${withDailyCloudMean ? ",cloud_cover_mean" : ""}`;
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${fmtCoord(lat)}&longitude=${fmtCoord(lon)}` +
    `&current=${CURRENT_VARS}&hourly=${HOURLY_VARS}&daily=${daily}` +
    `&forecast_days=7&timezone=GMT&wind_speed_unit=ms`
  );
}

const nullableNum = z.number().nullable();
const numArray = z.array(nullableNum);

export const forecastSchema = z.looseObject({
  utc_offset_seconds: z.number().optional().catch(undefined),
  current: z.looseObject({
    time: z.string(),
    temperature_2m: nullableNum.optional(),
    shortwave_radiation: nullableNum.optional(),
    diffuse_radiation: nullableNum.optional(),
    direct_normal_irradiance: nullableNum.optional(),
    cloud_cover: nullableNum.optional(),
    wind_speed_10m: nullableNum.optional(),
    is_day: nullableNum.optional(),
  }),
  hourly: z.looseObject({
    time: z.array(z.string()).min(1),
    shortwave_radiation: numArray,
    diffuse_radiation: numArray,
    direct_normal_irradiance: numArray,
    temperature_2m: numArray,
    wind_speed_10m: numArray,
    cloud_cover: numArray.optional().catch(undefined),
  }),
  daily: z.looseObject({
    time: z.array(z.string()).min(1),
    shortwave_radiation_sum: numArray,
    temperature_2m_max: numArray,
    cloud_cover_mean: numArray.optional().catch(undefined),
  }),
  daily_units: z.looseObject({ shortwave_radiation_sum: z.string().optional().catch(undefined) }).optional().catch(undefined),
});
export type ForecastResponse = z.infer<typeof forecastSchema>;

/** "2026-10-04T15:00" (hora local do fuso pedido) → epoch ms UTC */
function toUtcMs(local: string, utcOffsetSec: number): number {
  const s = /([zZ]|[+-]\d{2}:?\d{2})$/.test(local) ? local : `${local.length === 10 ? `${local}T00:00` : local}Z`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new SourceError("schema", `horário inválido: ${local}`);
  return t - utcOffsetSec * 1000;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Converte a resposta do Open-Meteo em `LiveWeather` (sem a procedência) */
export function parseForecast(json: ForecastResponse): Omit<LiveWeather, "provenance"> & { notes: string[] } {
  const offset = json.utc_offset_seconds ?? 0;
  const H = json.hourly;
  const notes: string[] = [];

  const hourly: LiveWeatherHour[] = [];
  const hourlyStampMs: number[] = []; // fim do intervalo de média, epoch ms
  for (let i = 0; i < H.time.length; i++) {
    const ghi = H.shortwave_radiation[i];
    const dhi = H.diffuse_radiation[i];
    const dni = H.direct_normal_irradiance[i];
    const t = H.temperature_2m[i];
    const w = H.wind_speed_10m[i];
    if (![ghi, dhi, dni, t, w].every(isNum)) continue; // horizonte sem dado (null) ⇒ ignora a hora
    const stamp = toUtcMs(H.time[i], offset);
    const cc = H.cloud_cover?.[i];
    hourlyStampMs.push(stamp);
    hourly.push({
      time: new Date(stamp).toISOString(),
      ghiWm2: ghi!,
      dhiWm2: dhi!,
      dniWm2: dni!,
      tempC: t!,
      windMs: w!,
      ...(isNum(cc) ? { cloudCoverPct: cc } : {}),
    });
  }
  if (hourly.length === 0) throw new SourceError("schema", "previsão horária sem valores");

  // Atual: bloco "current"; campos nulos são completados com a hora mais próxima da série horária.
  const C = json.current;
  const curMs = toUtcMs(C.time, offset);
  let nearest = 0;
  for (let i = 1; i < hourly.length; i++) {
    if (Math.abs(hourlyStampMs[i] - HALF_HOUR_MS - curMs) < Math.abs(hourlyStampMs[nearest] - HALF_HOUR_MS - curMs)) nearest = i;
  }
  const near = hourly[nearest];
  const filled: string[] = [];
  const pick = (v: number | null | undefined, fb: number | undefined, label: string): number => {
    if (isNum(v)) return v;
    if (fb === undefined) throw new SourceError("schema", `campo atual ausente: ${label}`);
    filled.push(label);
    return fb;
  };
  const current = {
    time: new Date(curMs).toISOString(),
    ghiWm2: pick(C.shortwave_radiation, near.ghiWm2, "shortwave_radiation"),
    dhiWm2: pick(C.diffuse_radiation, near.dhiWm2, "diffuse_radiation"),
    dniWm2: pick(C.direct_normal_irradiance, near.dniWm2, "direct_normal_irradiance"),
    tempC: pick(C.temperature_2m, near.tempC, "temperature_2m"),
    windMs: pick(C.wind_speed_10m, near.windMs, "wind_speed_10m"),
    cloudCoverPct: pick(C.cloud_cover, near.cloudCoverPct, "cloud_cover"),
    isDay: isNum(C.is_day) ? C.is_day === 1 : near.ghiWm2 > 0,
  };
  if (filled.length) notes.push(`atual completado com a hora mais próxima: ${filled.join(", ")}`);

  // Diário
  const D = json.daily;
  const factor = dailyIrradiationFactorToKWh(json.daily_units?.shortwave_radiation_sum ?? "MJ/m²");
  const daily: LiveWeather["daily"] = [];
  let cloudFromHourly = false;
  for (let i = 0; i < D.time.length; i++) {
    const date = D.time[i].slice(0, 10);
    const sum = D.shortwave_radiation_sum[i];
    const tmax = D.temperature_2m_max[i];
    if (!isNum(sum) || !isNum(tmax)) continue;
    let cc = D.cloud_cover_mean?.[i];
    if (!isNum(cc)) {
      // média do cloud_cover horário do dia (carimbos originais, dia UTC)
      const vals = hourly
        .filter((_, k) => new Date(hourlyStampMs[k] - 1).toISOString().slice(0, 10) === date)
        .map((h) => h.cloudCoverPct)
        .filter(isNum);
      if (vals.length === 0) continue;
      cc = round(mean(vals), 0);
      cloudFromHourly = true;
    }
    daily.push({ date, ghiKWhM2: round(sum * factor, 3), tempMaxC: tmax, cloudCoverPct: cc });
  }
  if (cloudFromHourly) notes.push("nebulosidade diária = média da horária (cloud_cover_mean indisponível)");

  return { ...current, hourly, daily, notes };
}

export async function getLiveWeather(plant: Plant, opts: SourceOptions = {}): Promise<LiveWeather | null> {
  const { lat, lon } = plant.location;
  const common = { timeoutMs: WEATHER_TIMEOUT_MS, revalidateSec: WEATHER_REVALIDATE_SEC, ...opts };
  try {
    let res: FetchJsonResult<ForecastResponse>;
    try {
      res = await fetchJson(forecastUrl(lat, lon, true), forecastSchema, common);
    } catch (e) {
      // variável diária não suportada pelo modelo ⇒ HTTP 400; repete sem cloud_cover_mean
      if (!(e instanceof SourceError && e.status === 400)) throw e;
      res = await fetchJson(forecastUrl(lat, lon, false), forecastSchema, common);
    }
    const { notes, ...weather } = parseForecast(res.data);
    return {
      ...weather,
      provenance: provenanceFromResult(
        "open-meteo-forecast",
        "Open-Meteo — previsão de 7 dias (modelo best_match)",
        res,
        joinNotes(
          "UTC; radiação horária = média da hora anterior ao carimbo; diário por dia UTC em kWh/m² (MJ ÷ 3,6)",
          ...notes,
        ),
      ),
    };
  } catch (e) {
    warnSource(`Open-Meteo previsão (${plant.slug}): ${describeError(e)}`);
    return null;
  }
}
