import { beforeEach, describe, expect, it } from "vitest";
import { getPlant } from "@/data/plants";
import { clearSourceCache } from "@/lib/sources/http";
import { forecastSchema, forecastUrl, getLiveWeather, parseForecast } from "@/lib/sources/weather";
import { clone, createMockFetch, fixture, hang, json, route, status } from "./fixtures/sources/mock-fetch";

const plant = getPlant("ufv-janauba-1")!;
const FORECAST = /api\.open-meteo\.com\/v1\/forecast/;

interface ForecastFixture {
  current: Record<string, number | string | null>;
  hourly: Record<string, (number | null)[]> & { time: string[] };
  daily: Record<string, (number | null)[] | undefined> & { time: string[] };
  daily_units: Record<string, string>;
}
const raw = () => clone(fixture<ForecastFixture>("open-meteo-forecast.json"));

beforeEach(() => clearSourceCache());

describe("URL da previsão", () => {
  it("variáveis, 7 dias, UTC e vento em m/s", () => {
    const u = new URL(forecastUrl(plant.location.lat, plant.location.lon));
    expect(u.searchParams.get("latitude")).toBe("-15.8350");
    expect(u.searchParams.get("current")).toBe(
      "temperature_2m,shortwave_radiation,diffuse_radiation,direct_normal_irradiance,cloud_cover,wind_speed_10m,is_day",
    );
    expect(u.searchParams.get("hourly")).toContain("shortwave_radiation,diffuse_radiation,direct_normal_irradiance,temperature_2m,wind_speed_10m");
    expect(u.searchParams.get("daily")).toBe("shortwave_radiation_sum,temperature_2m_max,cloud_cover_mean");
    expect(u.searchParams.get("forecast_days")).toBe("7");
    expect(u.searchParams.get("timezone")).toBe("GMT");
    expect(u.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(new URL(forecastUrl(0, 0, false)).searchParams.get("daily")).toBe("shortwave_radiation_sum,temperature_2m_max");
  });
});

describe("parseForecast", () => {
  it("atual, horário (carimbo original em UTC) e diário (MJ → kWh)", () => {
    const f = raw();
    const r = parseForecast(forecastSchema.parse(f));
    expect(r.time).toBe("2026-10-04T15:00:00.000Z");
    expect(r).toMatchObject({ ghiWm2: 892, dhiWm2: 131, dniWm2: 845.6, tempC: 30.8, windMs: 2.9, cloudCoverPct: 12, isDay: true });

    // a última hora do fixture tem null (fim do horizonte) e é descartada
    expect(r.hourly).toHaveLength(167);
    // carimbo do Open-Meteo preservado: fim da hora de média (centro = time − 30 min)
    expect(r.hourly[0].time).toBe("2026-10-04T00:00:00.000Z");
    expect(r.hourly[13]).toMatchObject({
      time: "2026-10-04T13:00:00.000Z",
      ghiWm2: f.hourly.shortwave_radiation[13],
      dhiWm2: f.hourly.diffuse_radiation[13],
      dniWm2: f.hourly.direct_normal_irradiance[13],
      tempC: f.hourly.temperature_2m[13],
      windMs: f.hourly.wind_speed_10m[13],
      cloudCoverPct: f.hourly.cloud_cover[13],
    });

    expect(r.daily).toHaveLength(7);
    expect(r.daily[0].date).toBe("2026-10-04");
    expect(r.daily[0].ghiKWhM2).toBeCloseTo((f.daily.shortwave_radiation_sum![0] as number) / 3.6, 3);
    expect(r.daily[0].tempMaxC).toBe(f.daily.temperature_2m_max![0]);
    expect(r.daily[0].cloudCoverPct).toBe(f.daily.cloud_cover_mean![0]);
    expect(r.notes).toEqual([]);
  });

  it("noite: isDay false via is_day = 0", () => {
    const f = raw();
    f.current.is_day = 0;
    expect(parseForecast(forecastSchema.parse(f)).isDay).toBe(false);
  });

  it("sem cloud_cover_mean ⇒ média do cloud_cover horário do dia UTC", () => {
    const f = raw();
    delete f.daily.cloud_cover_mean;
    const r = parseForecast(forecastSchema.parse(f));
    // dia 2026-10-04 = horas que TERMINAM entre 01:00 e 24:00 (índices 1..24)
    const cc = f.hourly.cloud_cover.slice(1, 25) as number[];
    expect(r.daily[0].cloudCoverPct).toBe(Math.round(cc.reduce((a, b) => a + b, 0) / cc.length));
    expect(r.daily).toHaveLength(7);
    expect(r.notes.join(" ")).toContain("média da horária");
  });

  it("campo atual nulo ⇒ completado com a hora mais próxima", () => {
    const f = raw();
    f.current.shortwave_radiation = null;
    const r = parseForecast(forecastSchema.parse(f));
    expect(r.ghiWm2).toBe(f.hourly.shortwave_radiation[15]);
    expect(r.notes.join(" ")).toContain("shortwave_radiation");
  });

  it("unidade diária diferente (kWh/m²) é respeitada", () => {
    const f = raw();
    f.daily_units.shortwave_radiation_sum = "kWh/m²";
    f.daily.shortwave_radiation_sum = f.daily.shortwave_radiation_sum!.map((v) => (v as number) / 3.6);
    const r = parseForecast(forecastSchema.parse(f));
    expect(r.daily[0].ghiKWhM2).toBeCloseTo((raw().daily.shortwave_radiation_sum![0] as number) / 3.6, 3);
  });

  it("utc_offset_seconds ≠ 0 é convertido para UTC", () => {
    const f = raw() as ForecastFixture & { utc_offset_seconds: number };
    f.utc_offset_seconds = -10800; // America/Sao_Paulo
    f.current.time = "2026-10-04T12:00";
    const r = parseForecast(forecastSchema.parse(f));
    expect(r.time).toBe("2026-10-04T15:00:00.000Z");
    expect(r.hourly[0].time).toBe("2026-10-04T03:00:00.000Z");
  });
});

describe("getLiveWeather", () => {
  it("ao vivo com procedência", async () => {
    const mock = createMockFetch([route(FORECAST, json(fixture("open-meteo-forecast.json")))]);
    const r = await getLiveWeather(plant, { fetchImpl: mock });
    expect(r).not.toBeNull();
    expect(r!.hourly).toHaveLength(167);
    expect(r!.daily).toHaveLength(7);
    expect(r!.provenance).toMatchObject({ id: "open-meteo-forecast", status: "live" });
    expect(r!.provenance.note).toContain("média da hora anterior");
    expect(mock.calls[0].init?.next).toEqual({ revalidate: 900 });
  });

  it("HTTP 400 por cloud_cover_mean ⇒ repete sem a variável e calcula pela horária", async () => {
    const f = raw();
    delete f.daily.cloud_cover_mean;
    const mock = createMockFetch([
      route(/cloud_cover_mean/, status(400, { error: true, reason: "Cannot initialize WeatherVariable from invalid String value cloud_cover_mean" })),
      route(FORECAST, json(f)),
    ]);
    const r = await getLiveWeather(plant, { fetchImpl: mock, backoffMs: 0 });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1].url).not.toContain("cloud_cover_mean");
    expect(r!.daily).toHaveLength(7);
    expect(r!.provenance.url).not.toContain("cloud_cover_mean");
  });

  it("HTTP 500 ⇒ null", async () => {
    const mock = createMockFetch([route(FORECAST, status(500))]);
    expect(await getLiveWeather(plant, { fetchImpl: mock, backoffMs: 0 })).toBeNull();
    expect(mock.calls).toHaveLength(2);
  });

  it("timeout ⇒ null", async () => {
    const mock = createMockFetch([route(FORECAST, hang())]);
    expect(await getLiveWeather(plant, { fetchImpl: mock, timeoutMs: 20, backoffMs: 0 })).toBeNull();
  });

  it("resposta malformada ⇒ null", async () => {
    const mock = createMockFetch([route(FORECAST, json({ latitude: -15.8, hourly: { time: [] } }))]);
    expect(await getLiveWeather(plant, { fetchImpl: mock })).toBeNull();
  });

  it("segunda chamada sai do cache", async () => {
    const mock = createMockFetch([route(FORECAST, json(fixture("open-meteo-forecast.json")))]);
    const first = await getLiveWeather(plant, { fetchImpl: mock });
    const second = await getLiveWeather(plant, { fetchImpl: mock });
    expect(mock.calls).toHaveLength(1);
    expect(second!.provenance.status).toBe("cache");
    expect(second!.provenance.fetchedAt).toBe(first!.provenance.fetchedAt);
  });
});
