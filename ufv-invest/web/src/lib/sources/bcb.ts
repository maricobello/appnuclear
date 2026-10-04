/**
 * Banco Central do Brasil — séries do SGS e expectativas do Relatório Focus (API Olinda/OData).
 *
 *  - SGS: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados/ultimos/1?formato=json
 *    ⇒ [{ "data": "dd/mm/aaaa", "valor": "14.90" }] — o valor pode vir com vírgula ou ponto.
 *  - Focus: ExpectativasMercadoAnuais (IPCA) ⇒ mediana para o ano de referência mais distante.
 */
import { z } from "zod";
import type { Provenance } from "@/lib/types";
import { SourceError, describeError, fetchJson, provenanceFromResult, type SourceOptions } from "./http";
import { brDateToIso, parseDecimal, round } from "./units";

export const BCB_REVALIDATE_SEC = 3_600;
const BCB_TIMEOUT_MS = 8_000;

export const SGS_SERIES = {
  selic: { code: 432, name: "Banco Central — SGS 432: meta Selic (% a.a.)" },
  cdi: { code: 4389, name: "Banco Central — SGS 4389: CDI anualizado base 252 (% a.a.)" },
  ipca12m: { code: 13522, name: "Banco Central — SGS 13522: IPCA acumulado em 12 meses (%)" },
  usdBrl: { code: 1, name: "Banco Central — SGS 1: dólar comercial venda PTAX (R$/US$)" },
} as const;
export type SgsKey = keyof typeof SGS_SERIES;

export function sgsUrl(code: number): string {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`;
}

export const sgsSchema = z
  .array(z.looseObject({ data: z.string(), valor: z.union([z.string(), z.number()]) }))
  .min(1);

/** Último ponto da série (o array vem em ordem cronológica) */
export function parseSgsLatest(rows: z.infer<typeof sgsSchema>): { value: number; date: string } {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = parseDecimal(rows[i].valor);
    if (v !== undefined) return { value: v, date: brDateToIso(rows[i].data) };
  }
  throw new SourceError("schema", "série SGS sem valor numérico");
}

export type SourcedValue =
  | { ok: true; value: number; provenance: Provenance; refDate?: string }
  | { ok: false; reason: string; url: string };

export async function fetchSgs(key: SgsKey, opts: SourceOptions = {}): Promise<SourcedValue> {
  const { code, name } = SGS_SERIES[key];
  const url = sgsUrl(code);
  try {
    const res = await fetchJson(url, sgsSchema, { timeoutMs: BCB_TIMEOUT_MS, revalidateSec: BCB_REVALIDATE_SEC, ...opts });
    const { value, date } = parseSgsLatest(res.data);
    return { ok: true, value, refDate: date, provenance: provenanceFromResult(`bcb-sgs-${code}`, name, res, `referência ${date}`) };
  } catch (e) {
    return { ok: false, reason: describeError(e), url };
  }
}

// ─── Focus ──────────────────────────────────────────────────────────────────────────────────

/** Últimas expectativas anuais de IPCA (várias datas de referência; ordenado da pesquisa mais recente) */
export const FOCUS_IPCA_URL =
  "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais" +
  "?$top=40&$filter=Indicador%20eq%20'IPCA'&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana";

export const focusSchema = z.looseObject({
  value: z.array(
    z.looseObject({
      Indicador: z.string().optional().catch(undefined),
      Data: z.string(),
      DataReferencia: z.union([z.string(), z.number()]),
      Mediana: z.union([z.number(), z.string(), z.null()]),
    }),
  ),
});

/**
 * Mediana de IPCA para o ano de referência mais distante disponível, na pesquisa mais recente
 * desse ano. Linhas duplicadas (bases de cálculo 30 e 4 dias) na mesma data são promediadas.
 */
export function pickLongTermIpca(json: z.infer<typeof focusSchema>): { value: number; refYear: number; surveyDate: string } {
  const rows = json.value
    .filter((r) => r.Indicador === undefined || r.Indicador === "IPCA")
    .map((r) => ({ date: r.Data.slice(0, 10), year: Number(String(r.DataReferencia).slice(0, 4)), median: parseDecimal(r.Mediana) }))
    .filter((r): r is { date: string; year: number; median: number } => Number.isInteger(r.year) && r.median !== undefined);
  if (rows.length === 0) throw new SourceError("schema", "Focus sem medianas de IPCA");
  const refYear = Math.max(...rows.map((r) => r.year));
  const ofYear = rows.filter((r) => r.year === refYear);
  const surveyDate = ofYear.map((r) => r.date).sort().at(-1)!;
  const medians = ofYear.filter((r) => r.date === surveyDate).map((r) => r.median);
  return { value: round(medians.reduce((a, b) => a + b, 0) / medians.length, 2), refYear, surveyDate };
}

export async function fetchFocusLongTermIpca(opts: SourceOptions = {}): Promise<SourcedValue> {
  try {
    const res = await fetchJson(FOCUS_IPCA_URL, focusSchema, { timeoutMs: BCB_TIMEOUT_MS, revalidateSec: BCB_REVALIDATE_SEC, ...opts });
    const { value, refYear, surveyDate } = pickLongTermIpca(res.data);
    return {
      ok: true,
      value,
      refDate: surveyDate,
      provenance: provenanceFromResult(
        "bcb-focus-ipca",
        `Banco Central — Focus: mediana de IPCA para ${refYear}`,
        res,
        `pesquisa de ${surveyDate}; ano de referência mais distante disponível (${refYear})`,
      ),
    };
  } catch (e) {
    return { ok: false, reason: describeError(e), url: FOCUS_IPCA_URL };
  }
}
