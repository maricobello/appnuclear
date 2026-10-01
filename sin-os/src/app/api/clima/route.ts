import { getWeatherBundle, publicMeta } from "@/lib/data";
import { mean } from "@/lib/quant/stats";
import { errorResponse, jsonResponse } from "@/lib/services";
import { solarCf, windCf } from "@/lib/sources/weather";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const w = await getWeatherBundle();
    const hubs = (w.weather.data ?? []).map((h) => {
      const d1 = (a: number[]) => a.slice(0, 24);
      const wcf = h.wind100.map(windCf);
      const scf = h.ghi.map(solarCf);
      return {
        id: h.hub.id,
        name: h.hub.name,
        role: h.hub.role,
        sub: h.hub.sub,
        next24: {
          tempAvg: mean(d1(h.temp)),
          tempMax: Math.max(...d1(h.temp)),
          windAvg: mean(d1(h.wind100)),
          windCf: mean(d1(wcf)),
          solarCf: mean(d1(scf)),
          precip: d1(h.precip).reduce((s, v) => s + v, 0),
          // graus-hora de resfriamento (>24 °C) — proxy de carga de climatização
          cdh: d1(h.temp).reduce((s, t) => s + Math.max(0, t - 24), 0),
        },
        series: {
          ts: h.ts,
          temp: h.temp,
          windCf: wcf,
          solarCf: scf,
        },
        daily16: h.dailyPrecip16,
      };
    });
    return jsonResponse(
      {
        generatedAt: Date.now(),
        meta: { weather: publicMeta(w.weather), ensemble: publicMeta(w.ensemble) },
        hubs,
        basins: w.ensemble.data ?? [],
      },
      600,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
