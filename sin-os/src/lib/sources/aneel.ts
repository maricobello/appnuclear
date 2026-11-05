import "server-only";
import { cached } from "../cache";
import { errMsg, fetchJson, probesOf } from "./http";
import { decompor, num } from "../tarifa/calc";
import { VALID_RANGES } from "./ranges";
import { emptyQuality, type Probe, type SourceResult } from "./types";

/**
 * Dados abertos da ANEEL (CKAN, datastore_search): tarifas homologadas de todas as
 * distribuidoras, componentes tarifários (TE e TUSD abertas) e bandeiras. A ANEEL
 * regenera os conjuntos todo dia; o app consulta filtrado (nada de baixar CSV de 1 GB) e
 * guarda em cache.
 */
const BASE = "https://dadosabertos.aneel.gov.br/api/3/action";
const RES_TARIFAS = "fcf2906c-7c32-4b9b-a637-054e7a5234f4";
const RES_BAND_ADIC = "5879ca80-b3bd-45b1-a135-d9b77c1d5b36";
const RES_BAND_ACION = "0591b8f6-fe54-437b-b72b-1aa2efd46e42";
/** INDGER dados comerciais: CNPJ da distribuidora × município IBGE atendido. */
const RES_INDGER_COM = "fd10c9d4-cb76-4020-a322-e79afb13eaf7";
/** Prefixo do código IBGE do município → UF. */
const UF_IBGE: Record<string, string> = { "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF" };
/** Componentes por ano de início de vigência (a ANEEL publica um arquivo por ano). */
const RES_COMP_FALLBACK: Record<number, string> = { 2025: "a4060165-3a0c-404f-926c-83901088b67c", 2026: "e8717aa8-2521-453f-bf16-fbb9a16eea39" };

async function ckan<T>(action: string, params: Record<string, string>): Promise<T> {
  const { json: j } = await fetchJson<{ success?: boolean; result?: T; error?: unknown }>(`${BASE}/${action}?${new URLSearchParams(params)}`, { timeoutMs: 25_000, retries: 1 });
  if (!j.success || !j.result) throw new Error(`ANEEL ${action}: ${JSON.stringify(j.error ?? "sem resultado").slice(0, 160)}`);
  return j.result;
}

interface Search<R> {
  records: R[];
  total?: number;
}
const search = <R,>(resource: string, params: Record<string, string>) => ckan<Search<R>>("datastore_search", { resource_id: resource, ...params });

export interface TarifaRow {
  SigAgente: string;
  DscREH: string;
  DatInicioVigencia: string;
  DatFimVigencia: string;
  DscSubGrupo: string;
  DscModalidadeTarifaria: string;
  DscClasse: string;
  DscSubClasse: string;
  DscDetalhe: string;
  NomPostoTarifario: string;
  DscUnidadeTerciaria: string;
  VlrTUSD: string;
  VlrTE: string;
  DatGeracaoConjuntoDados?: string;
}

export interface Linha {
  modalidade: string;
  classe: string;
  subclasse: string;
  detalhe: string;
  posto: string;
  unidade: string;
  tusd: number;
  te: number;
}

export interface TarifaVigente {
  agente: string;
  subgrupo: string;
  reh: string;
  inicio: string;
  fim: string;
  linhas: Linha[];
  proxima: { inicio: string; reh: string } | null;
  /** Data em que a ANEEL regenerou o conjunto (AAAA-MM-DD). */
  geracaoAneel: string | null;
  geradoEm: number;
}

const SIX_H = 6 * 3600_000;
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export async function distribuidoras(): Promise<string[]> {
  const { value } = await cached(
    "aneel:agentes",
    24 * 3600_000,
    async () => {
      const r = await search<{ SigAgente: string }>(RES_TARIFAS, { fields: "SigAgente", distinct: "true", limit: "1000", filters: JSON.stringify({ DscBaseTarifaria: "Tarifa de Aplicação", DscSubGrupo: "B1" }) });
      return [...new Set(r.records.map((x) => x.SigAgente).filter((x) => x && x !== "Não Informado"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    },
    { staleIfErrorMs: 7 * 24 * 3600_000 },
  );
  return value;
}

/**
 * UF de cada distribuidora, pelos dados da própria ANEEL: o CNPJ da tarifa homologada casa com
 * os municípios atendidos no INDGER; vale a UF com mais municípios (quem atende dois estados
 * fica com o principal). Sem casamento (agente antigo/incorporado), a distribuidora fica sem UF.
 */
export async function ufDistribuidoras(): Promise<Record<string, string>> {
  const { value } = await cached(
    "aneel:uf-agentes",
    7 * 24 * 3600_000,
    async () => {
      const [cnpjs, munis] = await Promise.all([
        search<{ SigAgente: string; NumCNPJDistribuidora: string }>(RES_TARIFAS, { fields: "SigAgente,NumCNPJDistribuidora", distinct: "true", limit: "2000", filters: JSON.stringify({ DscBaseTarifaria: "Tarifa de Aplicação" }) }),
        search<{ NumCNPJ: string; CodMunicipioIBGE: string }>(RES_INDGER_COM, { fields: "NumCNPJ,CodMunicipioIBGE", distinct: "true", limit: "32000" }),
      ]);
      const porCnpj = new Map<string, Map<string, number>>();
      for (const m of munis.records) {
        const uf = UF_IBGE[String(m.CodMunicipioIBGE ?? "").slice(0, 2)];
        if (!uf) continue;
        const c = porCnpj.get(m.NumCNPJ) ?? new Map<string, number>();
        c.set(uf, (c.get(uf) ?? 0) + 1);
        porCnpj.set(m.NumCNPJ, c);
      }
      // agentes antigos/incorporados que não constam mais do INDGER (área de concessão conhecida)
      const out: Record<string, string> = { CERR: "RR", CFLO: "PR", CNEE: "SP", "CPFL LESTE PAULI": "SP", "CPFL MOCOCA": "SP", "CPFL SANTA CRUZ": "SP", "CPFL SUL PAULIST": "SP", EBO: "PB", EDEVP: "SP", EEB: "SP", ENF: "RJ" };
      for (const r of cnpjs.records) {
        const c = porCnpj.get(r.NumCNPJDistribuidora);
        if (!c) continue;
        out[r.SigAgente] = [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      return out;
    },
    { staleIfErrorMs: 30 * 24 * 3600_000 },
  );
  return value;
}

export async function tarifaVigente(agente: string, subgrupo: string, dia = hoje()): Promise<TarifaVigente | null> {
  const { value } = await cached(
    `aneel:tarifa:${agente}:${subgrupo}`,
    SIX_H,
    async () => {
      const r = await search<TarifaRow>(RES_TARIFAS, { limit: "2000", sort: "DatInicioVigencia desc", filters: JSON.stringify({ SigAgente: agente, DscSubGrupo: subgrupo, DscBaseTarifaria: "Tarifa de Aplicação" }) });
      const inicios = [...new Set(r.records.map((x) => x.DatInicioVigencia))].sort().reverse();
      const vig = inicios.find((i) => i <= dia && r.records.some((x) => x.DatInicioVigencia === i && x.DatFimVigencia >= dia)) ?? inicios.find((i) => i <= dia) ?? inicios.at(-1);
      if (!vig) return null;
      const rows = r.records.filter((x) => x.DatInicioVigencia === vig);
      const seen = new Set<string>();
      const linhas: Linha[] = [];
      for (const x of rows) {
        const l = { modalidade: x.DscModalidadeTarifaria, classe: x.DscClasse, subclasse: x.DscSubClasse, detalhe: x.DscDetalhe, posto: x.NomPostoTarifario, unidade: x.DscUnidadeTerciaria, tusd: num(x.VlrTUSD), te: num(x.VlrTE) };
        const k = JSON.stringify(l);
        if (!seen.has(k)) {
          seen.add(k);
          linhas.push(l);
        }
      }
      const futura = inicios.find((i) => i > dia);
      const fr = futura ? r.records.find((x) => x.DatInicioVigencia === futura) : undefined;
      return { agente, subgrupo, reh: rows[0].DscREH, inicio: vig, fim: rows[0].DatFimVigencia, linhas, proxima: fr ? { inicio: futura!, reh: fr.DscREH } : null, geracaoAneel: r.records.map((x) => x.DatGeracaoConjuntoDados ?? "").sort().at(-1) || null, geradoEm: Date.now() } satisfies TarifaVigente;
    },
    { staleIfErrorMs: 7 * 24 * 3600_000 },
  );
  return value;
}

async function recursoComponentes(ano: number): Promise<string | null> {
  const { value } = await cached(
    `aneel:comp-res:${ano}`,
    24 * 3600_000,
    async () => {
      const p = await ckan<{ resources: { id: string; name: string; format?: string }[] }>("package_show", { id: "componentes-tarifarias" });
      return p.resources.find((r) => r.name === `componentes-tarifarias-${ano}.csv`)?.id ?? RES_COMP_FALLBACK[ano] ?? null;
    },
    { staleIfErrorMs: 30 * 24 * 3600_000 },
  ).catch(() => ({ value: RES_COMP_FALLBACK[ano] ?? null }));
  return value;
}

export interface ComponenteRow {
  DscComponenteTarifario: string;
  VlrComponenteTarifario: string;
  DscModalidadeTarifaria: string;
  DscSubClasseConsumidor: string;
  DscDetalheConsumidor: string;
  DscPostoTarifario: string;
  DscUnidade: string;
  SigNomeAgenteAcessante: string;
  DatInicioVigencia: string;
}

/** Componentes da combinação escolhida, na vigência informada. */
export async function componentes(q: { agente: string; subgrupo: string; inicio: string; modalidade: string; subclasse: string; detalhe: string; posto: string; unidade: string }): Promise<ComponenteRow[]> {
  const ano = Number(q.inicio.slice(0, 4));
  const res = await recursoComponentes(ano);
  if (!res) return [];
  const { value } = await cached(
    `aneel:comp:${JSON.stringify(q)}`,
    SIX_H,
    async () => {
      const r = await search<ComponenteRow>(res, {
        limit: "1000",
        filters: JSON.stringify({ SigNomeAgente: q.agente, DscSubGrupoTarifario: q.subgrupo, DscBaseTarifaria: "Tarifa de Aplicação", DscModalidadeTarifaria: q.modalidade, DscSubClasseConsumidor: q.subclasse, DscDetalheConsumidor: q.detalhe, DscPostoTarifario: q.posto, DscUnidade: q.unidade.startsWith("R$") ? q.unidade : `R$/${q.unidade}` }),
      });
      return r.records.filter((x) => x.DatInicioVigencia === q.inicio && (x.SigNomeAgenteAcessante === "Não se aplica" || !x.SigNomeAgenteAcessante));
    },
    { staleIfErrorMs: 7 * 24 * 3600_000 },
  );
  return value;
}

export interface Bandeira {
  competencia: string;
  nome: string;
  adicionalMwh: number;
  tabela: { nome: string; adicionalMwh: number; desde: string; norma: string }[];
}

export async function bandeiraVigente(): Promise<Bandeira> {
  const { value } = await cached(
    "aneel:bandeira",
    SIX_H,
    async () => {
      const [ac, ad] = await Promise.all([
        search<{ DatCompetencia: string; NomBandeiraAcionada: string; VlrAdicionalBandeira: string }>(RES_BAND_ACION, { limit: "3", sort: "DatCompetencia desc" }),
        search<{ DatVigencia: string; NomBandeiraAcionada: string; VlrAdicionalBandeiraRSMWh: string; DscResolucao: string }>(RES_BAND_ADIC, { limit: "12", sort: "DatVigencia desc" }),
      ]);
      const tabela: Bandeira["tabela"] = [];
      for (const x of ad.records) if (!tabela.some((t) => t.nome === x.NomBandeiraAcionada)) tabela.push({ nome: x.NomBandeiraAcionada, adicionalMwh: num(x.VlrAdicionalBandeiraRSMWh), desde: x.DatVigencia, norma: x.DscResolucao });
      const a = ac.records[0];
      return { competencia: a.DatCompetencia.slice(0, 7), nome: a.NomBandeiraAcionada, adicionalMwh: num(a.VlrAdicionalBandeira), tabela } satisfies Bandeira;
    },
    { staleIfErrorMs: 31 * 24 * 3600_000 },
  );
  return value;
}

/**
 * Sonda do auditor: tarifa vigente de uma distribuidora de referência, os componentes que a
 * compõem (devem somar a TE e a TUSD publicadas) e a bandeira do mês.
 */
export async function fetchAneelTarifas(agente = "CPFL-PAULISTA"): Promise<SourceResult<{ agente: string; reh: string; inicio: string; residuoMwh: number | null; bandeira: string }>> {
  const quality = emptyQuality();
  const probes: Probe[] = [];
  try {
    const t = await tarifaVigente(agente, "B1");
    if (!t) throw new Error(`sem tarifa vigente para ${agente}`);
    const base = t.linhas.find((l) => l.modalidade === "Convencional" && l.subclasse === "Residencial" && l.detalhe === "Não se aplica");
    if (!base) quality.schemaIssues.push("linha B1 Convencional Residencial ausente");
    const comp = base ? await componentes({ agente, subgrupo: "B1", inicio: t.inicio, ...base }) : [];
    const d = decompor(comp);
    if (base && (d.residuo === null || Math.abs(d.residuo) > 1)) quality.schemaIssues.push(d.residuo === null ? "componentes sem TE/TUSD de referência" : `componentes não fecham com a tarifa (resíduo R$ ${d.residuo.toFixed(2)}/MWh)`);
    const b = await bandeiraVigente();
    quality.points = t.linhas.length + comp.length;
    quality.invalid = t.linhas.filter((l) => !Number.isFinite(l.te + l.tusd)).length;
    quality.latestTs = t.geracaoAneel ? Date.parse(`${t.geracaoAneel}T12:00:00-03:00`) : null;
    quality.values = t.linhas.filter((l) => l.unidade === "MWh").map((l) => l.te + l.tusd);
    quality.range = [...VALID_RANGES.aneel_tarifas.range];
    return { id: "aneel_tarifas", ok: true, data: { agente, reh: t.reh, inicio: t.inicio, residuoMwh: d.residuo, bandeira: `${b.competencia} ${b.nome}` }, probes, quality, simulated: false, note: `${t.reh} · bandeira ${b.competencia}: ${b.nome}`, fetchedAt: Date.now() };
  } catch (e) {
    probes.push(...probesOf(e));
    return { id: "aneel_tarifas", ok: false, data: null, error: errMsg(e), probes, quality, simulated: false, fetchedAt: Date.now() };
  }
}
