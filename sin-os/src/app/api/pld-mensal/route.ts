import { getBrazilBundle, getPld, publicMeta } from "@/lib/data";
import { csvResponse, toCsv } from "@/lib/csv";
import { monthlyPldFromPanel, type MonthlyPld } from "@/lib/market/book";
import { SUBS } from "@/lib/sources/types";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PLD médio mensal por submercado — base da liquidação da carteira. Puxa uma janela longa
 * (padrão ~2 anos) para que PPAs anuais liquidem o período realizado inteiro, não só os
 * meses recentes; a fonte é o CMO do ONS pela regra da ANEEL (mesmo do resto do app).
 * `?format=csv` devolve a tabela mês × submercado.
 */
function respond(req: Request, m: MonthlyPld, rest: { simulated: boolean; fallback: string | null; meta: ReturnType<typeof publicMeta> }) {
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const rows = m.months.map((month) => [month, ...SUBS.map((s) => { const v = m.byMonth[month]?.[s]; return v === undefined ? "" : v.toFixed(2); })]);
    const origin = rest.simulated ? "SIMULADO" : rest.fallback ?? "PLD";
    return csvResponse(toCsv(["mes", ...SUBS.map((s) => `pld_medio_${s}_rs_mwh`)], rows, `SIN OS - PLD medio mensal por submercado (${origin}); gerado ${new Date().toISOString()}`), "pld-mensal");
  }
  return jsonResponse({ ...m, ...rest }, 600);
}

export async function GET(req: Request) {
  try {
    const days = Math.min(1460, Math.max(120, Number(new URL(req.url).searchParams.get("days")) || 760));
    const pld = await getPld(days);
    if (!pld.data) {
      const br = await getBrazilBundle(); // fallback para o bundle padrão
      if (!br.pld.data) throw new Error(pld.error ?? "PLD indisponível");
      return respond(req, monthlyPldFromPanel(br.pld.data), { meta: publicMeta(br.pld), simulated: br.pld.simulated, fallback: br.pld.fallback ?? null });
    }
    return respond(req, monthlyPldFromPanel(pld.data), { meta: publicMeta(pld), simulated: pld.simulated, fallback: pld.fallback ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
