import { getBrazilBundle, publicMeta } from "@/lib/data";
import { PLD_LIMITS } from "@/lib/market/brazil";
import { pldSnapshot } from "@/lib/market/pld-summary";
import { errorResponse, jsonResponse } from "@/lib/services";
import { SUBS, type Sub } from "@/lib/sources/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PLD atual por submercado: hora atual (ou último valor publicado), hoje, amanhã (quando
 * publicado), último dia completo e, com ?dias=N, as médias diárias. Usa a mesma cadeia de
 * fontes do app — CCEE Dados Abertos (identificação honesta, sem se passar por navegador) →
 * PLD estimado pelo CMO/DESSEM do ONS com o piso/teto da ANEEL (pode diferir do oficial) → último dado bom —
 * e informa qual delas respondeu. Dado simulado nunca sai daqui (503).
 *
 *   GET /api/pld              todos os submercados
 *   GET /api/pld?sub=SE       SE | SUDESTE | CO | S | SUL | NE | NORDESTE | N | NORTE
 *   GET /api/pld?dias=7       + médias diárias dos últimos 7 dias completos (máx. 90)
 */
const ALIAS: Record<string, Sub> = {
  SE: "SE", "SE/CO": "SE", SUDESTE: "SE", CO: "SE",
  S: "S", SUL: "S",
  NE: "NE", NORDESTE: "NE",
  N: "N", NORTE: "N",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawSub = url.searchParams.get("sub")?.trim().toUpperCase();
  let subs: Sub[] = [...SUBS];
  if (rawSub && rawSub !== "TODOS" && rawSub !== "ALL") {
    const s = ALIAS[rawSub];
    if (!s) return Response.json({ error: `submercado inválido: use ${Object.keys(ALIAS).join(", ")} ou todos` }, { status: 400 });
    subs = [s];
  }
  const diasRaw = url.searchParams.get("dias");
  const dias = diasRaw === null ? 0 : Number(diasRaw);
  if (!Number.isInteger(dias) || dias < 0 || dias > 90) return Response.json({ error: "dias deve ser um inteiro de 0 a 90" }, { status: 400 });
  try {
    const { pld } = await getBrazilBundle();
    const meta = publicMeta(pld);
    if (!pld.data || pld.simulated) {
      return Response.json(
        { error: pld.simulated ? "dado real indisponível (a fonte só teria dado simulado)" : `PLD indisponível: ${pld.error ?? "fontes fora do ar"}`, meta },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const now = Date.now();
    const official = !meta.fallback;
    return jsonResponse(
      {
        gerado_em: new Date(now).toISOString(),
        unidade: "R$/MWh",
        fonte: {
          oficial: official,
          descricao: meta.note ?? meta.fallback ?? "CCEE Dados Abertos — PLD horário",
        },
        limites: { ano: PLD_LIMITS.year, piso: PLD_LIMITS.min, teto_horario: PLD_LIMITS.maxHourly, teto_estrutural: PLD_LIMITS.maxStructural },
        submercados: pldSnapshot(pld.data, now, subs, dias),
        meta,
      },
      60,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
