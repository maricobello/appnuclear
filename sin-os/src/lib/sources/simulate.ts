/**
 * Gerador SINTÉTICO determinístico, usado SOMENTE como fallback explícito quando
 * uma fonte pública está fora do ar (ou em DATA_MODE=demo). Todo resultado que
 * passa por aqui sai com `simulated: true` e a interface exibe um alerta.
 * Estrutura estilizada: sazonalidade hidrológica, curva "pato" (solar ao meio-dia),
 * descolamento de submercados, piso/teto regulatórios, preços negativos na Europa.
 */
import { clampPld } from "../market/brazil";
import { mulberry32, quantile, randn } from "../quant/stats";
import { EU_ZONES, type ZonePrices } from "./europe";
import type { FxData } from "./fx";
import type { CarbonNow, SystemPrices } from "./uk";
import { HUBS, type BasinEnsemble, type HubForecast } from "./weather";
import { brtDate, brtHour, isoDay } from "./time";
import { SUBS, type DailySubPanel, type Sub, type SubPanel, type TimeSeries } from "./types";

const H = 3600_000;
const dayOfYear = (t: number) => Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 86400_000);

/** Fim do dia seguinte (BRT), horário — o PLD de D+1 já é publicado em D. */
function hourlyGrid(daysBack: number, includeTomorrow = true): number[] {
  const endDay = brtDate(Date.now() + (includeTomorrow ? 86400_000 : 0));
  const end = Date.parse(`${endDay}T23:00:00-03:00`);
  const start = end - daysBack * 24 * H;
  const out: number[] = [];
  for (let t = Math.floor(start / H) * H; t <= end; t += H) out.push(t);
  return out;
}

function rawPriceModel(ts: number[]) {
  const rng = mulberry32(20260925);
  // processo diário em log com reversão à média e saltos
  let dev = 0;
  let lastDay = "";
  let decouple = 0;
  const out: Record<Sub, number[]> = { SE: [], S: [], NE: [], N: [] };
  // pré-aquecimento determinístico a partir de uma âncora fixa
  const anchor = Date.UTC(2026, 0, 1);
  const warm = Math.max(0, Math.floor((ts[0] - anchor) / 86400_000));
  for (let d = 0; d < warm; d++) { dev = 0.85 * dev + 0.14 * randn(rng); if (rng() < 0.03) dev += 0.5 * randn(rng); rng(); }
  for (const t of ts) {
    const day = brtDate(t);
    if (day !== lastDay) {
      dev = 0.85 * dev + 0.14 * randn(rng);
      if (rng() < 0.03) dev += 0.5 * randn(rng);
      decouple = rng() < 0.15 ? 0.1 + 0.25 * rng() : 0;
      lastDay = day;
    }
    const doy = dayOfYear(t);
    const seasonal = Math.log(140) + 0.6 * Math.sin((2 * Math.PI * (doy - 169)) / 365);
    const h = brtHour(t);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const shape = 1 + 0.28 * Math.exp(-((h - 19.5) ** 2) / 6) - 0.32 * Math.exp(-((h - 12.5) ** 2) / 8) - (dow === 0 || dow === 6 ? 0.1 : 0);
    const se = Math.exp(seasonal + dev) * shape * (1 + 0.03 * randn(rng));
    out.SE.push(se);
    out.S.push(se * (1 + decouple) * (1 + 0.02 * randn(rng)));
    const solarDip = Math.exp(-((h - 12.5) ** 2) / 10);
    out.NE.push(se * (0.95 - 0.55 * solarDip) * (1 + 0.03 * randn(rng)));
    out.N.push(se * (0.98 - 0.3 * solarDip) * (1 + 0.02 * randn(rng)));
  }
  return out;
}

export function simPld(daysBack = 120): SubPanel {
  const full = hourlyGrid(120);
  const rawFull = rawPriceModel(full);
  const cut = Math.max(0, full.length - (daysBack + 1) * 24);
  const ts = full.slice(cut);
  const raw = Object.fromEntries(SUBS.map((s) => [s, rawFull[s].slice(cut)])) as Record<Sub, number[]>;
  return { ts, unit: "R$/MWh", values: Object.fromEntries(SUBS.map((s) => [s, raw[s].map(clampPld)])) as SubPanel["values"] };
}

/** Mesmo processo do PLD simulado (antes do piso/teto), recortado — mantém PLD = CMO limitado. */
export function simCmo(daysBack = 120): SubPanel {
  const full = hourlyGrid(120);
  const rawFull = rawPriceModel(full);
  const cut = Math.max(0, full.length - (daysBack + 1) * 24);
  const ts = full.slice(cut);
  const raw = Object.fromEntries(SUBS.map((s) => [s, rawFull[s].slice(cut)])) as Record<Sub, number[]>;
  return { ts, unit: "R$/MWh", values: Object.fromEntries(SUBS.map((s) => [s, raw[s].map((v) => Math.max(0, v))])) as SubPanel["values"] };
}

function dailyDates(n: number) {
  return Array.from({ length: n }, (_, i) => isoDay(Date.now() - (n - 1 - i) * 86400_000 - 3 * H));
}

export function simEar(n = 365): DailySubPanel {
  const rng = mulberry32(42);
  const dates = dailyDates(n);
  const base: Record<Sub, number> = { SE: 58, S: 72, NE: 55, N: 62 };
  const values = Object.fromEntries(
    SUBS.map((s) => [
      s,
      dates.map((d) => {
        const doy = dayOfYear(Date.parse(d));
        const v = base[s] + 18 * Math.cos((2 * Math.PI * (doy - 110)) / 365) + 1.5 * randn(rng);
        return Math.min(99, Math.max(8, v));
      }),
    ]),
  ) as DailySubPanel["values"];
  return { dates, values, unit: "% EARmax" };
}

export function simEna(n = 365): DailySubPanel {
  const rng = mulberry32(43);
  const dates = dailyDates(n);
  const values = Object.fromEntries(
    SUBS.map((s) => [s, dates.map((d) => Math.max(20, 85 + 25 * Math.cos((2 * Math.PI * (dayOfYear(Date.parse(d)) - 40)) / 365) + 12 * randn(rng)))]),
  ) as DailySubPanel["values"];
  return { dates, values, unit: "% MLT" };
}

export function simLoad(daysBack = 60): SubPanel {
  const rng = mulberry32(44);
  const ts = hourlyGrid(daysBack, false);
  const base: Record<Sub, number> = { SE: 43_000, S: 12_600, NE: 12_900, N: 7_700 };
  const values = Object.fromEntries(
    SUBS.map((s) => [
      s,
      ts.map((t) => {
        const h = brtHour(t);
        return base[s] * (1 + 0.14 * Math.sin((2 * Math.PI * (h - 9)) / 24) + 0.06 * Math.exp(-((h - 15) ** 2) / 8)) * (1 + 0.015 * randn(rng));
      }),
    ]),
  ) as SubPanel["values"];
  return { ts, values, unit: "MWmed" };
}

export function simEu(daysBack = 7): ZonePrices {
  const base: Record<string, [number, number]> = {
    "DE-LU": [88, 1.0], FR: [72, 0.6], NL: [90, 0.9], BE: [86, 0.7], AT: [96, 0.7], CH: [94, 0.5],
    PL: [108, 0.4], DK1: [82, 0.6], NO2: [46, 0.1], SE4: [72, 0.3], ES: [62, 1.1], "IT-North": [112, 0.6],
  };
  const out: ZonePrices = {};
  const start = Date.parse(`${isoDay(Date.now() - daysBack * 86400_000)}T00:00:00Z`);
  const end = Date.parse(`${isoDay(Date.now() + 86400_000)}T23:45:00Z`);
  EU_ZONES.forEach((z, zi) => {
    const rng = mulberry32(100 + zi);
    const [lvl, solar] = base[z.bzn];
    const ts: number[] = [];
    const values: number[] = [];
    let daily = 0;
    for (let t = start; t <= end; t += 15 * 60_000) {
      const d = new Date(t);
      const h = d.getUTCHours() + 1 + d.getUTCMinutes() / 60; // ≈ CET
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) daily = 0.7 * daily + 0.18 * randn(rng);
      const wk = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0.8 : 1;
      const shape = 1 + 0.35 * Math.exp(-((h - 8) ** 2) / 3) + 0.5 * Math.exp(-((h - 19.5) ** 2) / 4) - solar * 0.9 * Math.exp(-((h - 13) ** 2) / 6);
      ts.push(t);
      values.push(Math.round(lvl * Math.exp(daily) * wk * shape * (1 + 0.04 * randn(rng)) * 100) / 100);
    }
    out[z.bzn] = { ts, values, unit: "EUR/MWh", name: z.name };
  });
  return out;
}

export function simUkMid(daysBack = 7): TimeSeries {
  const rng = mulberry32(200);
  const ts: number[] = [];
  const values: number[] = [];
  const start = Math.floor((Date.now() - daysBack * 86400_000) / 1800_000) * 1800_000;
  for (let t = start; t <= Date.now(); t += 1800_000) {
    const h = new Date(t).getUTCHours() + 1;
    ts.push(t);
    values.push(78 * (1 + 0.3 * Math.exp(-((h - 18) ** 2) / 4) - 0.15 * Math.exp(-((h - 3) ** 2) / 6)) * (1 + 0.06 * randn(rng)));
  }
  return { ts, values, unit: "GBP/MWh" };
}

export function simUkSys(): SystemPrices {
  const mid = simUkMid(2);
  const rng = mulberry32(201);
  const sbp = mid.values.map((v) => v * (1 + 0.25 * randn(rng)) + (rng() < 0.05 ? 150 * rng() : 0));
  return { ts: mid.ts, sbp, ssp: sbp.slice(), niv: mid.ts.map(() => 300 * randn(rng)) };
}

export function simCarbon(): CarbonNow {
  const from = new Date(Math.floor(Date.now() / 1800_000) * 1800_000);
  return {
    from: from.toISOString(),
    to: new Date(from.getTime() + 1800_000).toISOString(),
    forecast: 142,
    actual: 138,
    index: "moderate",
    mix: [
      { fuel: "wind", perc: 31 }, { fuel: "gas", perc: 27 }, { fuel: "nuclear", perc: 14 }, { fuel: "imports", perc: 12 },
      { fuel: "biomass", perc: 7 }, { fuel: "solar", perc: 6 }, { fuel: "hydro", perc: 2 }, { fuel: "other", perc: 1 },
    ],
  };
}

export function simFx(): FxData {
  const mk = (rate: number, seed: number) => {
    const rng = mulberry32(seed);
    const history = Array.from({ length: 20 }, (_, i) => {
      const d = new Date(Date.now() - (19 - i) * 86400_000);
      return { date: d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), rate: rate * (1 + 0.004 * randn(rng)) };
    });
    const last = history[history.length - 1];
    return { rate: last.rate, date: last.date, ts: Date.now(), history };
  };
  return { USD: mk(5.35, 1), EUR: mk(6.25, 2), GBP: mk(7.15, 3) };
}

export function simWeather(): HubForecast[] {
  const start = Math.floor(Date.now() / H) * H;
  return HUBS.map((hub, i) => {
    const rng = mulberry32(300 + i);
    const ts = Array.from({ length: 168 }, (_, k) => start + k * H);
    const hours = ts.map(brtHour);
    return {
      hub,
      ts,
      temp: hours.map((h) => 22 + (hub.lat > -10 ? 5 : 0) + 6 * Math.sin((2 * Math.PI * (h - 9)) / 24) + randn(rng)),
      ghi: hours.map((h) => Math.max(0, 980 * Math.sin((Math.PI * (h - 6)) / 12)) * (0.8 + 0.2 * rng())),
      wind100: hours.map((h) => Math.max(0, (hub.role === "eólica" ? 9.5 : 4) + 2 * Math.sin((2 * Math.PI * (h - 20)) / 24) + randn(rng))),
      precip: hours.map(() => (rng() < (hub.sub === "S" ? 0.08 : 0.02) ? 3 * rng() : 0)),
      dailyPrecip16: {
        dates: Array.from({ length: 16 }, (_, k) => isoDay(start + k * 86400_000)),
        mm: Array.from({ length: 16 }, () => (rng() < (hub.sub === "S" ? 0.35 : 0.1) ? 12 * rng() : 0)),
      },
    };
  });
}

export function simEnsemble(): BasinEnsemble[] {
  const typical: Record<string, number> = { furnas: 22, itaipu: 85, sobradinho: 4, tucurui: 12 };
  return HUBS.filter((h) => h.role === "hidro").map((hub, i) => {
    const rng = mulberry32(400 + i);
    const members = Array.from({ length: 51 }, () => {
      const scale = typical[hub.id] ?? 20;
      let acc = 0;
      return Array.from({ length: 15 }, () => (acc += Math.max(0, (scale / 15) * (1 + 1.2 * randn(rng)))));
    });
    const cumulative = Array.from({ length: 15 }, (_, d) => {
      const col = members.map((m) => m[d]);
      return { day: d + 1, p10: quantile(col, 0.1), p50: quantile(col, 0.5), p90: quantile(col, 0.9) };
    });
    const last = cumulative[14];
    return { hub, members: 51, horizonDays: 15, p10: last.p10, p50: last.p50, p90: last.p90, cumulative };
  });
}
