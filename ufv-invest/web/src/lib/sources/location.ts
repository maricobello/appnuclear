/**
 * Dados do município da usina: IBGE Localidades (nomes e regiões), SIDRA/agregados v3
 * (população estimada e PIB) e altitude do terreno (Open-Meteo Elevation, Copernicus DEM 90 m).
 *
 *  - Localidades: /api/v1/localidades/municipios/{código} — `microrregiao` e `regiao-imediata`
 *    podem vir null (municípios recentes); a UF é lida de qualquer um dos dois ramos.
 *    Código inexistente ⇒ a API devolve `[]` com HTTP 200 ⇒ tratado como formato inesperado.
 *  - População: agregado 6579, variável 9324, últimos 6 períodos (usa o mais recente e escolhe o
 *    ano mais próximo do PIB para o per capita).
 *  - PIB: agregado 5938, variável 37. Se a unidade for "Mil Reais" (PIB total), o per capita é
 *    calculado como PIB × 1000 ÷ população do ano mais próximo; se vier em "Reais", usa direto.
 *
 * Falha nos nomes ⇒ cadastro da usina + tabela de UFs (status "fallback"); falha em população,
 * PIB ou altitude ⇒ campo omitido e procedência com status "error".
 */
import { z } from "zod";
import type { LocationInfo, Plant, Provenance } from "@/lib/types";
import { UF_INFO } from "./defaults";
import { DAY_SEC, SourceError, describeError, fetchJson, provenance, provenanceFromResult, warnSource, type SourceOptions } from "./http";
import { fmtCoord, parseDecimal, round } from "./units";

export const LOCATION_REVALIDATE_SEC = 30 * DAY_SEC;
const IBGE_TIMEOUT_MS = 8_000;
const IBGE_BASE = "https://servicodados.ibge.gov.br/api";

export function ibgeMunicipioUrl(code: number): string {
  return `${IBGE_BASE}/v1/localidades/municipios/${code}`;
}
export function sidraPopulationUrl(code: number): string {
  return `${IBGE_BASE}/v3/agregados/6579/periodos/-6/variaveis/9324?localidades=N6[${code}]`;
}
export function sidraPibUrl(code: number): string {
  return `${IBGE_BASE}/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6[${code}]`;
}
export function elevationUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/elevation?latitude=${fmtCoord(lat)}&longitude=${fmtCoord(lon)}`;
}

// ─── Localidades ────────────────────────────────────────────────────────────────────────────

const optStr = z.string().nullish().catch(undefined);
const ufSchema = z
  .looseObject({ sigla: z.string(), nome: z.string(), regiao: z.looseObject({ nome: optStr }).nullish().catch(undefined) })
  .nullish()
  .catch(undefined);

const municipioObject = z.looseObject({
  id: z.union([z.number(), z.string()]),
  nome: z.string(),
  microrregiao: z
    .looseObject({ mesorregiao: z.looseObject({ UF: ufSchema }).nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
  "regiao-imediata": z
    .looseObject({
      nome: optStr,
      "regiao-intermediaria": z.looseObject({ nome: optStr, UF: ufSchema }).nullish().catch(undefined),
    })
    .nullish()
    .catch(undefined),
});

/** Aceita o objeto ou um array com exatamente 1 município; `[]` (código inexistente) é rejeitado */
export const ibgeMunicipioSchema = z.preprocess((v) => (Array.isArray(v) && v.length === 1 ? v[0] : v), municipioObject);
export type IbgeMunicipio = z.infer<typeof municipioObject>;

export interface ParsedMunicipio {
  municipio: string;
  uf?: string;
  ufNome?: string;
  regiao?: string;
  regiaoImediata?: string;
  regiaoIntermediaria?: string;
}

export function parseMunicipio(m: IbgeMunicipio): ParsedMunicipio {
  const imediata = m["regiao-imediata"];
  const intermediaria = imediata?.["regiao-intermediaria"];
  const uf = m.microrregiao?.mesorregiao?.UF ?? intermediaria?.UF ?? undefined;
  const out: ParsedMunicipio = { municipio: m.nome };
  if (uf?.sigla) out.uf = uf.sigla;
  if (uf?.nome) out.ufNome = uf.nome;
  if (uf?.regiao?.nome) out.regiao = uf.regiao.nome;
  if (imediata?.nome) out.regiaoImediata = imediata.nome;
  if (intermediaria?.nome) out.regiaoIntermediaria = intermediaria.nome;
  return out;
}

// ─── SIDRA (agregados v3) ───────────────────────────────────────────────────────────────────

export const sidraSchema = z
  .array(
    z.looseObject({
      variavel: z.string().optional().catch(undefined),
      unidade: z.string().optional().catch(undefined),
      resultados: z
        .array(
          z.looseObject({
            series: z.array(z.looseObject({ serie: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) })),
          }),
        )
        .min(1),
    }),
  )
  .min(1);
export type SidraResponse = z.infer<typeof sidraSchema>;

/** Pontos (ano, valor) da primeira série, em ordem; "-", "...", "X" (sigilo) são descartados */
export function parseSidraSeries(json: SidraResponse): { unit?: string; variable?: string; points: { year: number; value: number }[] } {
  const v = json[0];
  const serie = v.resultados[0]?.series[0]?.serie;
  if (!serie) throw new SourceError("schema", "SIDRA sem série para a localidade");
  const points = Object.entries(serie)
    .map(([period, raw]) => ({ year: Number(period.slice(0, 4)), value: parseDecimal(raw) }))
    .filter((p): p is { year: number; value: number } => Number.isInteger(p.year) && p.value !== undefined)
    .sort((a, b) => a.year - b.year);
  if (points.length === 0) throw new SourceError("schema", "SIDRA sem valor numérico (dado ausente ou sigiloso)");
  return { unit: v.unidade, variable: v.variavel, points };
}

/** PIB per capita (R$) a partir do PIB do SIDRA e da série de população */
export function pibPerCapita(
  pib: { unit?: string; points: { year: number; value: number }[] },
  population?: { year: number; value: number }[],
): { valueBRL: number; year: number; note: string } | undefined {
  const last = pib.points[pib.points.length - 1];
  const unit = pib.unit ?? "Mil Reais"; // metadado da variável 37
  if (!/mil/i.test(unit)) {
    return { valueBRL: round(last.value, 2), year: last.year, note: `PIB per capita ${last.year} (${unit})` };
  }
  if (!population?.length) return undefined;
  const pop = [...population].sort((a, b) => Math.abs(a.year - last.year) - Math.abs(b.year - last.year) || b.year - a.year)[0];
  if (!(pop.value > 0)) return undefined;
  return {
    valueBRL: round((last.value * 1000) / pop.value, 2),
    year: last.year,
    note: `PIB ${last.year} (${unit}) × 1000 ÷ população estimada ${pop.year}${pop.year === last.year ? "" : " (ano mais próximo disponível)"}`,
  };
}

// ─── Altitude ───────────────────────────────────────────────────────────────────────────────

export const elevationSchema = z.looseObject({ elevation: z.array(z.number().nullable()).min(1) });

// ─── Função pública ─────────────────────────────────────────────────────────────────────────

export async function getLocationInfo(plant: Plant, opts: SourceOptions = {}): Promise<LocationInfo> {
  const { ibgeCode, lat, lon } = plant.location;
  const nowIso = (opts.now ? opts.now() : new Date()).toISOString();
  const common = { timeoutMs: IBGE_TIMEOUT_MS, revalidateSec: LOCATION_REVALIDATE_SEC, ...opts };

  const [munR, popR, pibR, elevR] = await Promise.allSettled([
    fetchJson(ibgeMunicipioUrl(ibgeCode), ibgeMunicipioSchema, common),
    fetchJson(sidraPopulationUrl(ibgeCode), sidraSchema, common).then((res) => ({ res, parsed: parseSidraSeries(res.data) })),
    fetchJson(sidraPibUrl(ibgeCode), sidraSchema, common).then((res) => ({ res, parsed: parseSidraSeries(res.data) })),
    fetchJson(elevationUrl(lat, lon), elevationSchema, common),
  ]);

  const info: LocationInfo = {
    municipio: plant.location.municipio,
    uf: plant.location.uf,
    ibgeCode,
    provenance: [],
  };
  const prov: Provenance[] = [];

  // Nomes e regiões
  if (munR.status === "fulfilled") {
    const m = parseMunicipio(munR.value.data);
    info.municipio = m.municipio;
    info.uf = m.uf ?? plant.location.uf;
    const ufFb = UF_INFO[info.uf];
    info.ufNome = m.ufNome ?? ufFb?.nome;
    info.regiao = m.regiao ?? ufFb?.regiao;
    if (m.regiaoImediata) info.regiaoImediata = m.regiaoImediata;
    if (m.regiaoIntermediaria) info.regiaoIntermediaria = m.regiaoIntermediaria;
    const missing = [!m.uf && "UF", !m.regiaoImediata && "região imediata", !m.regiaoIntermediaria && "região intermediária"].filter(Boolean);
    prov.push(
      provenanceFromResult(
        "ibge-localidades",
        "IBGE — Localidades (município, UF e regiões geográficas)",
        munR.value,
        missing.length ? `campos nulos na API: ${missing.join(", ")}${!m.uf ? " (UF do cadastro da usina)" : ""}` : undefined,
      ),
    );
  } else {
    const reason = describeError(munR.reason);
    warnSource(`IBGE Localidades (${plant.slug}): ${reason}`);
    const ufFb = UF_INFO[plant.location.uf];
    if (ufFb) {
      info.ufNome = ufFb.nome;
      info.regiao = ufFb.regiao;
    }
    prov.push(
      provenance(
        "ibge-localidades",
        "Cadastro da usina + tabela de UFs (IBGE)",
        ibgeMunicipioUrl(ibgeCode),
        "fallback",
        `IBGE Localidades indisponível (${reason}); nomes do cadastro da usina`,
        nowIso,
      ),
    );
  }

  // População
  const popPoints = popR.status === "fulfilled" ? popR.value.parsed.points : undefined;
  if (popR.status === "fulfilled" && popPoints) {
    const last = popPoints[popPoints.length - 1];
    info.populacao = Math.round(last.value);
    info.populacaoAno = last.year;
    prov.push(
      provenanceFromResult("ibge-sidra-6579", `IBGE — população residente estimada ${last.year} (SIDRA 6579)`, popR.value.res, popR.value.parsed.unit ? `unidade: ${popR.value.parsed.unit}` : undefined),
    );
  } else if (popR.status === "rejected") {
    prov.push(
      provenance("ibge-sidra-6579", "IBGE — população residente estimada (SIDRA 6579)", sidraPopulationUrl(ibgeCode), "error", `indisponível (${describeError(popR.reason)}); campo omitido`, nowIso),
    );
  }

  // PIB per capita
  if (pibR.status === "fulfilled") {
    const pc = pibPerCapita(pibR.value.parsed, popPoints);
    if (pc) {
      info.pibPerCapitaBRL = pc.valueBRL;
      info.pibAno = pc.year;
      prov.push(provenanceFromResult("ibge-sidra-5938", `IBGE — PIB dos Municípios ${pc.year} (SIDRA 5938)`, pibR.value.res, pc.note));
    } else {
      prov.push(
        provenance("ibge-sidra-5938", "IBGE — PIB dos Municípios (SIDRA 5938)", pibR.value.res.url, "error", "PIB total sem população para calcular o per capita; campo omitido", nowIso),
      );
    }
  } else {
    prov.push(
      provenance("ibge-sidra-5938", "IBGE — PIB dos Municípios (SIDRA 5938)", sidraPibUrl(ibgeCode), "error", `indisponível (${describeError(pibR.reason)}); campo omitido`, nowIso),
    );
  }

  // Altitude
  const elev = elevR.status === "fulfilled" ? elevR.value.data.elevation[0] : null;
  if (elevR.status === "fulfilled" && typeof elev === "number" && Number.isFinite(elev)) {
    info.elevationM = round(elev, 0);
    prov.push(provenanceFromResult("open-meteo-elevation", "Open-Meteo Elevation API (Copernicus DEM GLO-90)", elevR.value));
  } else {
    const reason = elevR.status === "rejected" ? describeError(elevR.reason) : "valor nulo";
    prov.push(
      provenance("open-meteo-elevation", "Open-Meteo Elevation API (Copernicus DEM GLO-90)", elevationUrl(lat, lon), "error", `indisponível (${reason}); campo omitido`, nowIso),
    );
  }

  info.provenance = prov;
  return info;
}
