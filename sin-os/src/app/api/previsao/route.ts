import { csvResponse, toCsv } from "@/lib/csv";
import { publicForecast } from "@/lib/market/forecast";
import { errorResponse, getForecast, jsonResponse, SUB_PARAM } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Série de previsão do PLD. `?format=csv` devolve a curva horária (LEAR, banda conformal
 * e quantis Monte Carlo) pronta para o profissional plugar no próprio modelo/Excel.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sub = SUB_PARAM(url.searchParams.get("sub"));
    const { fc, simulated, fallback } = await getForecast(sub);

    if (url.searchParams.get("format") === "csv") {
      const h = fc.horizon;
      const header = ["timestamp_utc", "hora_brt", "previsao_rs_mwh", "lear_rs_mwh", "banda_inf_90", "banda_sup_90", "mc_p05", "mc_p50", "mc_p95"];
      const rows = h.ts.map((t, i) => [
        new Date(t).toISOString(),
        new Date(t - 3 * 3600_000).toISOString().slice(0, 13) + "h",
        h.point[i], h.lear[i], h.aciLo[i], h.aciHi[i], h.mc.p05[i], h.mc.p50[i], h.mc.p95[i],
      ]);
      const comment = `SIN OS - previsao PLD ${sub}${simulated ? " (SIMULADO)" : fallback ? ` (${fallback})` : ""}; gerado ${new Date().toISOString()}`;
      return csvResponse(toCsv(header, rows, comment), `previsao-${sub}`);
    }

    return jsonResponse({ ...publicForecast(fc), simulated, fallback }, 600);
  } catch (e) {
    return errorResponse(e);
  }
}
