import { fold } from "../gd/parse";
import type { CarteiraGD } from "../gd/types";
import { GD_TOOL_DEFS } from "./gd-tools";
import type { ChatMessage, ToolDef } from "./groq";
import { TOOL_DEFS } from "./tools";

/**
 * Peças do harness da Iara que economizam tokens sem perder capacidade:
 *  1. roteamento por domínio — cada pergunta leva só as ferramentas do assunto (o
 *     catálogo inteiro custa ~3 mil tokens por rodada); a meta-ferramenta
 *     "carregar_ferramentas" abre outro domínio se o modelo precisar;
 *  2. resultados compactos — números arredondados, nulos fora, listas cortadas, teto de
 *     caracteres por ferramenta;
 *  3. histórico enxuto — turnos antigos resumidos, nunca resultados de ferramenta;
 *  4. cache curto de respostas idênticas (sugestões clicadas duas vezes custam zero).
 */
export type Domain = "mercado" | "bess" | "hidro" | "dados" | "renovaveis" | "regulatorio" | "planejamento" | "rede" | "gd";

interface DomainSpec {
  label: string;
  tools: string[];
  re: RegExp;
  pages: string[];
}

export const DOMAINS: Record<Domain, DomainSpec> = {
  mercado: { label: "PLD agora, previsão e oportunidades", tools: ["pld_agora", "previsao_pld", "oportunidades"], re: /\b(pld|preco|cmo|previs|amanha|hoje|semana|spread|submercado|sudeste|nordeste|norte|sul|mais car|mais barat|arbitr|oportunidad|horario|hora)/, pages: ["/", "/previsao", "/arbitragem", "/sin", "/carteira"] },
  bess: { label: "estudo e configuração de bateria (BESS)", tools: ["estudo_bess", "configurar_ativo"], re: /(bateria|bess|armazen|ciclo|lcos|\bmwh\b.*\bmw\b|simula)/, pages: ["/bess", "/arbitragem"] },
  hidro: { label: "reservatórios, afluência e carga", tools: ["reservatorios"], re: /(reservat|chuva|hidrolog|\bear\b|\bena\b|afluen|seca|carga)/, pages: ["/clima", "/sin"] },
  dados: { label: "saúde e confiança das fontes de dados", tools: ["saude_dados", "confianca_dados"], re: /(saude|fontes? de dados|fontes? (fora|caiu|caida|offline)|fora do ar|confiab|confianca|revisa|retroativ|auditor|simulad|status)/, pages: ["/auditoria", "/modelos"] },
  renovaveis: { label: "corte de eólica e solar (curtailment)", tools: ["renovaveis_corte"], re: /(renovav|eolic|curtail|corte|constrained|desperdic|pato|carga liquida|solar.*(corte|ons))/, pages: ["/renovaveis"] },
  regulatorio: { label: "radar regulatório e mercado livre", tools: ["radar_mercado"], re: /(regula|radar|\blei\b|aneel|decreto|abertura|mercado livre|migra|leila|open energy|comercializ|portabilidade)/, pages: ["/mercado-livre"] },
  planejamento: { label: "PLD mensal de 12 meses (NovoModelo/SDDP)", tools: ["planejamento_sddp"], re: /(sddp|newave|novomodelo|planejamento|medio prazo|proximos meses|meses|ano que vem|periodo seco|deficit|valor da agua)/, pages: ["/planejamento"] },
  rede: { label: "força da rede: curto-circuito e SCR por subestação", tools: ["forca_da_rede"], re: /(rede eletrica|subesta|curto|\bscr\b|barra|conexao (de|da) usina|rede fraca|fluxo de potencia|n-1)/, pages: ["/rede"] },
  gd: {
    label: "geração distribuída: faturas, conferência, enquadramento, viabilidade, contratos e encargos",
    tools: GD_TOOL_DEFS.map((t) => t.function.name),
    re: /(\bgd\b|gd ?i|geracao distribuida|fatura|conta de (luz|energia)|compens|credito|fio ?b|injet|\buc\b|\bucs\b|unidade consumidora|assinatura|consorcio|cooperativa|aluguel|locacao|usina solar|fotovolt|placa|kwp|micro ?gera|mini ?gera|encargo|tusd|icms|pis|cofins|disponibilidade|rateio|14\.?300|1\.?059|demanda contratada|ultrapassagem|reativ|grupo [ab]\b|tarifa|bandeira|distribuidora|payback|viabil)/,
    pages: ["/gd"],
  },
};
export const DOMAIN_LIST = Object.keys(DOMAINS) as Domain[];

/** Sem pista nenhuma: o núcleo das perguntas mais comuns. */
const CORE: Domain[] = ["mercado", "hidro", "dados", "regulatorio"];

export const META_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "carregar_ferramentas",
    description: `Abre ferramentas de outro assunto quando as atuais não bastam: ${DOMAIN_LIST.map((d) => `${d} = ${DOMAINS[d].label}`).join("; ")}.`,
    parameters: { type: "object", properties: { dominio: { type: "string", enum: DOMAIN_LIST } }, required: ["dominio"], additionalProperties: false },
  },
};

const ALL: Map<string, ToolDef> = new Map([...TOOL_DEFS, ...GD_TOOL_DEFS].map((t) => [t.function.name, t]));
export const ALL_TOOL_NAMES = [...ALL.keys()];

export function routeDomains(texts: string[], page?: string, gd?: CarteiraGD): Domain[] {
  const t = fold(texts.join(" \n "));
  const hit = new Set<Domain>(DOMAIN_LIST.filter((d) => DOMAINS[d].re.test(t)));
  for (const d of DOMAIN_LIST) if (page && DOMAINS[d].pages.includes(page)) hit.add(d);
  if (gd && gd.faturas.length && /(fatura|conta|conferi|analis|resum|erro|cobran)/.test(t)) hit.add("gd");
  return hit.size ? DOMAIN_LIST.filter((d) => hit.has(d)) : [...CORE];
}

/** Ferramentas dos domínios, em ordem estável (o prefixo do prompt fica igual entre rodadas e perguntas — cache do provedor). */
export function toolsFor(domains: Domain[]): ToolDef[] {
  const names = new Set<string>();
  for (const d of DOMAIN_LIST) if (domains.includes(d)) DOMAINS[d].tools.forEach((n) => names.add(n));
  names.add("navegar");
  const out = ALL_TOOL_NAMES.filter((n) => names.has(n)).map((n) => ALL.get(n)!);
  if (domains.length < DOMAIN_LIST.length) out.push(META_TOOL);
  return out;
}

/* ------------------------------------------------------------ compactação */

function shrink(v: unknown, arr: number, strMax: number, depth = 0): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return undefined;
    const a = Math.abs(v);
    return a >= 1000 ? Math.round(v) : a >= 10 ? Math.round(v * 10) / 10 : a >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
  }
  if (typeof v === "string") return v.length > strMax ? `${v.slice(0, strMax)}…` : v;
  if (typeof v !== "object") return v;
  if (depth > 8) return "…";
  if (Array.isArray(v)) {
    const items = v.slice(0, arr).map((x) => shrink(x, arr, strMax, depth + 1)).filter((x) => x !== undefined);
    if (v.length > arr) items.push(`…+${v.length - arr}`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const y = shrink(x, arr, strMax, depth + 1);
    if (y === undefined || (Array.isArray(y) && !y.length) || y === "") continue;
    out[k] = y;
  }
  return out;
}

/** JSON enxuto de um resultado de ferramenta, sob um teto de caracteres. */
export function compact(result: unknown, budget = 3200): string {
  for (const [arr, strMax] of [
    [24, 400],
    [12, 240],
    [6, 160],
    [3, 100],
  ] as const) {
    const s = JSON.stringify(shrink(result, arr, strMax)) ?? "null";
    if (s.length <= budget) return s;
  }
  const s = JSON.stringify(shrink(result, 2, 80)) ?? "null";
  return s.length > budget ? `${s.slice(0, budget)}…(cortado)` : s;
}

/** Turnos: os 6 últimos inteiros (com teto), os anteriores resumidos; no máximo 10. */
export function compactHistory(msgs: { role: "user" | "assistant"; content: string }[]): ChatMessage[] {
  const recent = msgs.slice(-10);
  return recent.map((m, i) => {
    const old = i < recent.length - 6;
    const max = old ? (m.role === "user" ? 300 : 240) : m.role === "user" ? 2000 : 1500;
    return { role: m.role, content: m.content.length > max ? `${m.content.slice(0, max)}…` : m.content };
  });
}

/* ------------------------------------------------------------ cache de respostas */

interface CacheEntry<T> {
  at: number;
  value: T;
}
const replyCache = new Map<string, CacheEntry<unknown>>();
const REPLY_TTL = 90_000;

export function cacheKey(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${s.length}`;
}

export function cacheGet<T>(key: string, now = Date.now()): T | null {
  const e = replyCache.get(key);
  if (!e) return null;
  if (now - e.at > REPLY_TTL) {
    replyCache.delete(key);
    return null;
  }
  return e.value as T;
}

export function cachePut<T>(key: string, value: T, now = Date.now()) {
  if (replyCache.size > 300) replyCache.clear();
  replyCache.set(key, { at: now, value });
}
export const cacheClear = () => replyCache.clear();
