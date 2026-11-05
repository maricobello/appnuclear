import { bandeiraVigente, componentes, distribuidoras, tarifaVigente } from "@/lib/sources/aneel";
import { decompor } from "@/lib/tarifa/calc";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUBGRUPOS = new Set(["B1", "B2", "B3", "B4", "A1", "A2", "A3", "A3a", "A4", "AS"]);
const txt = (v: string | null, max = 120) => (v ?? "").trim().slice(0, max);

/**
 * Tarifas da ANEEL (dados abertos, em cache no servidor):
 *  - sem parâmetros: lista de distribuidoras e a bandeira do mês;
 *  - ?agente=&subgrupo=: tarifa vigente (todas as linhas TE/TUSD) e bandeira;
 *  - + modalidade, subclasse, detalhe, posto, unidade: componentes abertos daquela linha.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const agente = txt(q.get("agente"));
    if (!agente) {
      const [agentes, bandeira] = await Promise.all([distribuidoras(), bandeiraVigente()]);
      return jsonResponse({ agentes, bandeira }, 3600);
    }
    const subgrupo = txt(q.get("subgrupo"), 4) || "B1";
    if (!SUBGRUPOS.has(subgrupo)) return errorResponse(new Error("subgrupo inválido"), 400);
    if (!(await distribuidoras()).includes(agente)) return errorResponse(new Error("distribuidora não encontrada na ANEEL"), 404);
    const [tarifa, bandeira] = await Promise.all([tarifaVigente(agente, subgrupo), bandeiraVigente()]);
    if (!tarifa) return errorResponse(new Error(`sem tarifa vigente para ${agente} ${subgrupo}`), 404);
    const modalidade = txt(q.get("modalidade"));
    let decomposicao = null;
    if (modalidade) {
      const linha = { modalidade, subclasse: txt(q.get("subclasse")), detalhe: txt(q.get("detalhe")) || "Não se aplica", posto: txt(q.get("posto")) || "Não se aplica", unidade: txt(q.get("unidade"), 8) || "MWh" };
      decomposicao = decompor(await componentes({ agente, subgrupo, inicio: tarifa.inicio, ...linha }));
    }
    return jsonResponse({ tarifa, bandeira, decomposicao }, 1800);
  } catch (e) {
    return errorResponse(e);
  }
}
