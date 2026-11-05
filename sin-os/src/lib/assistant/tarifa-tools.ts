import { fold } from "../gd/parse";
import type { Bandeira, ComponenteRow, Linha, TarifaVigente } from "../sources/aneel";
import { decompor, efetiva, ICMS_UF, PREMISSAS_PADRAO, simularReforma } from "../tarifa/calc";
import type { ToolDef } from "./groq";

/** Acesso às tarifas da ANEEL, injetado (a rota usa os dados abertos; os testes, fixtures). */
export interface TarifaDeps {
  agentes: () => Promise<string[]>;
  vigente: (agente: string, subgrupo: string) => Promise<TarifaVigente | null>;
  componentes: (q: { agente: string; subgrupo: string; inicio: string } & Omit<Linha, "te" | "tusd" | "classe">) => Promise<ComponenteRow[]>;
  bandeira: () => Promise<Bandeira>;
}

const SUBGRUPOS = ["B1", "B2", "B3", "A4", "A3a", "A3", "A2", "A1", "AS"];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const frac = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? (v > 1 ? v / 100 : v) : def);

export const TARIFA_TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "tarifa_vigente",
      description:
        "Tarifa homologada vigente de uma distribuidora (dados abertos da ANEEL, atualizados todo dia): resolução (REH), vigência e próxima, TE e TUSD por modalidade e posto, componentes abertos da linha principal (energia, Fio B, Fio A, perdas, encargos, subsídios) e tarifa efetiva por kWh com ICMS, PIS/Cofins e a bandeira do mês. Use para perguntas sobre tarifa, TE, TUSD, componentes, bandeira ou preço do kWh de uma distribuidora.",
      parameters: {
        type: "object",
        properties: {
          distribuidora: { type: "string", description: "Sigla ou nome da distribuidora (ex.: CPFL-PAULISTA, ELETROPAULO/Enel SP, CEMIG-D, COPEL-DIS, LIGHT)" },
          subgrupo: { type: "string", enum: SUBGRUPOS, description: "B1 residencial (padrão), B3 comercial, A4 média tensão…" },
          modalidade: { type: "string", description: "Convencional (padrão no B), Branca, Verde, Azul" },
          uf: { type: "string", description: "UF para o ICMS de referência (ex.: SP)" },
          icms: { type: "number", description: "Alíquota de ICMS em % (opcional; sobrepõe a da UF)" },
          pis: { type: "number", description: "PIS em % (opcional; padrão 1,05)" },
          cofins: { type: "number", description: "Cofins em % (opcional; padrão 4,84)" },
        },
        required: ["distribuidora"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reforma_tributaria",
      description:
        "Simula CBS e IBS (reforma tributária, EC 132/2023 e LC 214/2025) na tarifa de energia de 2026 a 2033: ano de teste, fim do PIS/Cofins em 2027, troca gradual do ICMS pelo IBS de 2029 a 2033, preço por kWh para o consumidor final e custo líquido para empresa com crédito. Aceita a tarifa sem tributos em R$/MWh ou uma distribuidora (usa a B1 residencial convencional vigente).",
      parameters: {
        type: "object",
        properties: {
          tarifa_mwh: { type: "number", description: "TE + TUSD (+ bandeira) sem tributos, em R$/MWh" },
          distribuidora: { type: "string", description: "Alternativa a tarifa_mwh" },
          icms: { type: "number", description: "ICMS atual em % (padrão 18 ou o da UF)" },
          uf: { type: "string" },
          cbs_ref: { type: "number", description: "Alíquota de referência da CBS em % (padrão 8,8, estimativa)" },
          ibs_ref: { type: "number", description: "Alíquota de referência do IBS em % (padrão 17,7, estimativa)" },
        },
        additionalProperties: false,
      },
    },
  },
];

export async function resolverAgente(q: string, agentes: string[]): Promise<string | null> {
  const n = fold(q).replace(/[^a-z0-9]/g, "");
  if (!n) return null;
  const norm = agentes.map((a) => [a, fold(a).replace(/[^a-z0-9]/g, "")] as const);
  const ALIAS: Record<string, string> = { enelsp: "eletropaulo", enelrj: "ampla", enelce: "coelce", cpfl: "cpflpaulista", copel: "copeldis", cemig: "cemigd", celesc: "celescdis", light: "lightsesa" };
  const alvo = ALIAS[n] ?? n;
  return norm.find(([, f]) => f === alvo)?.[0] ?? norm.find(([, f]) => f.startsWith(alvo))?.[0] ?? norm.find(([, f]) => f.includes(alvo))?.[0] ?? null;
}

async function tarifaVigenteTool(args: Record<string, unknown>, deps: TarifaDeps) {
  const agentes = await deps.agentes();
  const agente = await resolverAgente(String(args.distribuidora ?? ""), agentes);
  if (!agente) return { erro: `distribuidora não encontrada na ANEEL: ${String(args.distribuidora ?? "")}`.slice(0, 160), exemplos: agentes.slice(0, 12) };
  const subgrupo = SUBGRUPOS.includes(String(args.subgrupo)) ? String(args.subgrupo) : "B1";
  const [t, b] = await Promise.all([deps.vigente(agente, subgrupo), deps.bandeira()]);
  if (!t) return { erro: `sem tarifa vigente para ${agente} ${subgrupo}` };
  const mods = [...new Set(t.linhas.map((l) => l.modalidade))];
  const want = fold(String(args.modalidade ?? ""));
  const modalidade = mods.find((m) => want && fold(m).startsWith(want)) ?? mods.find((m) => m === "Convencional") ?? mods.find((m) => m === "Verde") ?? mods[0];
  const linhas = t.linhas.filter((l) => l.modalidade === modalidade && l.detalhe === "Não se aplica");
  const energia = linhas.filter((l) => l.unidade === "MWh");
  const principal = energia.find((l) => l.subclasse === "Residencial") ?? energia.find((l) => /fora/i.test(l.posto)) ?? energia[0];
  const uf = String(args.uf ?? "").toUpperCase();
  const tributos = { icms: frac(args.icms, ICMS_UF[uf] ?? PREMISSAS_PADRAO.icms), pis: frac(args.pis, PREMISSAS_PADRAO.pis), cofins: frac(args.cofins, PREMISSAS_PADRAO.cofins) };
  let componentes = null;
  let ef = null;
  if (principal) {
    const d = decompor(await deps.componentes({ agente, subgrupo, inicio: t.inicio, modalidade: principal.modalidade, subclasse: principal.subclasse, detalhe: principal.detalhe, posto: principal.posto, unidade: principal.unidade }));
    componentes = d.grupos.length ? { grupos_rs_mwh: d.grupos.map((g) => ({ grupo: g.grupo, total: g.total, pct: g.pct })), fecha_com_tarifa: d.residuo !== null && Math.abs(d.residuo) <= 1 } : null;
    const e = efetiva(principal.te, principal.tusd, b.adicionalMwh, tributos);
    ef = { linha: `${principal.subclasse} · ${principal.posto}`, sem_tributos_kwh: e.semTributosKwh, com_tributos_kwh: e.comTributosKwh, icms_kwh: e.icmsKwh, pis_cofins_kwh: r4(e.pisKwh + e.cofinsKwh), carga_pct: e.cargaPct, premissas: { icms_pct: r4(tributos.icms * 100), pis_pct: r4(tributos.pis * 100), cofins_pct: r4(tributos.cofins * 100), icms_fonte: args.icms !== undefined ? "informado" : ICMS_UF[uf] ? `referência ${uf} (conferir lei estadual)` : "padrão 18% (informe a UF)" } };
  }
  return {
    distribuidora: agente,
    subgrupo,
    modalidade,
    reh: t.reh,
    vigencia: `${t.inicio} a ${t.fim}`,
    proxima: t.proxima,
    fonte: `ANEEL dados abertos (conjunto de ${t.geracaoAneel ?? "—"})`,
    linhas_rs: linhas.slice(0, 14).map((l) => ({ subclasse: l.subclasse, posto: l.posto, unidade: `R$/${l.unidade}`, tusd: l.tusd, te: l.te })),
    bandeira: { competencia: b.competencia, nome: b.nome, adicional_rs_mwh: b.adicionalMwh },
    componentes,
    tarifa_efetiva: ef,
    tela: "/tarifas",
  };
}

async function reformaTool(args: Record<string, unknown>, deps?: TarifaDeps) {
  let base = typeof args.tarifa_mwh === "number" && args.tarifa_mwh > 0 ? args.tarifa_mwh : null;
  let origem = "informada";
  if (!base && args.distribuidora && deps) {
    const agente = await resolverAgente(String(args.distribuidora), await deps.agentes());
    const t = agente ? await deps.vigente(agente, "B1") : null;
    const l = t?.linhas.find((x) => x.modalidade === "Convencional" && x.subclasse === "Residencial" && x.detalhe === "Não se aplica" && x.unidade === "MWh");
    if (l && t) {
      base = l.te + l.tusd;
      origem = `${agente} B1 residencial convencional (${t.reh})`;
    }
  }
  if (!base) return { erro: "informe tarifa_mwh (TE+TUSD sem tributos, R$/MWh) ou uma distribuidora" };
  const uf = String(args.uf ?? "").toUpperCase();
  const p = { ...PREMISSAS_PADRAO, icms: frac(args.icms, ICMS_UF[uf] ?? PREMISSAS_PADRAO.icms), cbsRef: frac(args.cbs_ref, PREMISSAS_PADRAO.cbsRef), ibsRef: frac(args.ibs_ref, PREMISSAS_PADRAO.ibsRef) };
  const anos = simularReforma(base, p);
  return {
    tarifa_sem_tributos_mwh: r4(base),
    origem,
    premissas: { icms_pct: r4(p.icms * 100), pis_cofins_pct: r4((p.pis + p.cofins) * 100), cbs_ref_pct: r4(p.cbsRef * 100), ibs_ref_pct: r4(p.ibsRef * 100), alerta: "alíquotas de referência são estimativas; a definitiva sai por resolução do Senado" },
    anos: anos.map((a) => ({ ano: a.ano, total_kwh: a.totalKwh, icms: a.icmsKwh, pis_cofins: a.pisCofinsKwh, cbs: a.cbsKwh, ibs: a.ibsKwh, carga_pct: a.cargaPct, empresa_liquido_kwh: a.liquidoEmpresaKwh, nota: a.nota })),
    conferir: ["alíquotas definitivas e do IBS por estado/município", "cashback de energia para baixa renda (LC 214/2025)", "tratamento da energia compensada na GD", "base: ICMS fora da base do IBS/CBS"],
    tela: "/tarifas",
  };
}

export async function executeTarifaTool(name: string, args: Record<string, unknown>, deps?: TarifaDeps): Promise<unknown | null> {
  if (name === "reforma_tributaria") return reformaTool(args, deps);
  if (name === "tarifa_vigente") return deps ? tarifaVigenteTool(args, deps) : { erro: "tarifas da ANEEL indisponíveis neste servidor" };
  return null;
}
