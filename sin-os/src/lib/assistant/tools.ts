import type { AuditRun } from "../audit/types";
import { BESS_QUERY, toBessParams } from "../market/bess-params";
import type { BessParams, BessStudy } from "../market/bess-study";
import type { RenewablesReport } from "../market/renewables-report";
import { latestBySub, PLD_LIMITS } from "../market/brazil";
import { dayRow, dayStats } from "../market/pld-summary";
import type { ForecastResult } from "../market/forecast";
import { buildOpportunities, pickDay } from "../market/opportunities";
import { brtDate, brtHour } from "../sources/time";
import { SUB_NAMES, SUBS, type DailySubPanel, type SourceResult, type Sub, type SubPanel } from "../sources/types";
import type { ToolDef } from "./groq";

/**
 * Ferramentas da Iara: cada uma lê os MESMOS dados e modelos das telas (PLD, previsão,
 * estudo BESS, oportunidades, hidrologia, auditoria) e devolve números já calculados — o
 * modelo de linguagem só redige. Dado simulado nunca é repassado: a ferramenta devolve
 * erro e a Iara diz que o dado está indisponível. As dependências são injetadas para os
 * testes rodarem sem rede.
 */
export const ROUTES = {
  "/": "Sala de Comando",
  "/sin": "SIN · Brasil",
  "/renovaveis": "Renováveis & corte",
  "/previsao": "Previsão",
  "/arbitragem": "Arbitragem",
  "/bess": "BESS",
  "/carteira": "Carteira",
  "/global": "Mercados globais",
  "/clima": "Clima & hidrologia",
  "/auditoria": "Agente auditor",
  "/modelos": "Modelos & APIs",
} as const;
export type Route = keyof typeof ROUTES;

export interface AssetCtx {
  name: string;
  sub: Sub;
  pow: number;
  cap: number;
  rte: number;
  deg: number;
  lcos: number;
  wacc: number;
  life: number;
  opex: number;
  ref: number;
  maxc: number;
  days: number;
}

export type AssistantAction =
  | { type: "navigate"; href: string; label: string }
  | { type: "asset"; patch: Partial<AssetCtx>; label: string };

export interface ToolCtx {
  now: number;
  asset: AssetCtx;
}

export interface AssistantDeps {
  brazil: () => Promise<{
    pld: SourceResult<SubPanel>;
    ear: SourceResult<DailySubPanel>;
    ena: SourceResult<DailySubPanel>;
    load: SourceResult<SubPanel>;
  }>;
  forecast: (sub: Sub) => Promise<{ fc: ForecastResult; simulated: boolean; fallback: string | null }>;
  bess: (p: BessParams) => Promise<{ study: BessStudy; pld: SourceResult<SubPanel> }>;
  latestAudit: () => Promise<AuditRun | null>;
  trust: () => Promise<{ totalRevisions30d: number; windowDays: number; seals: { source: string; name: string; monitored: boolean; level: string; revisions30d: number; reasons: string[] }[] }>;
  renewables: (days: number) => Promise<RenewablesReport>;
  dataMode: () => string;
}

export interface ToolOutcome {
  result: unknown;
  actions?: AssistantAction[];
}

export const SIM_REFUSAL = "dado simulado — a Iara não usa dado simulado; informe que o dado real está indisponível agora";

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const stamp = (ts: number) => `${brtDate(ts)} ${String(brtHour(ts)).padStart(2, "0")}:00`;

/** Estado do dado em linguagem de mesa: oficial, calculado pelo CMO, persistido etc. */
export function sourceLabel(r: Pick<SourceResult<unknown>, "ok" | "simulated" | "fallback" | "note" | "error">): string {
  if (r.simulated) return "SIMULADO";
  if (!r.ok) return `indisponível (${(r.error ?? "erro").slice(0, 120)})`;
  if (r.note) return r.note;
  if (r.fallback) return r.fallback.slice(0, 200);
  return "ao vivo";
}

const SUB_ENUM = { type: "string", enum: [...SUBS], description: "Submercado: SE (Sudeste/Centro-Oeste), S (Sul), NE (Nordeste), N (Norte)" };

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "pld_agora",
      description: "PLD horário real (R$/MWh) por submercado: valor da hora atual (ou o último publicado), média/mín./máx. de hoje com as horas, média de amanhã se já publicada, limites regulatórios e o estado da fonte (oficial CCEE ou calculado pelo CMO do ONS).",
      parameters: { type: "object", properties: { sub: SUB_ENUM }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "previsao_pld",
      description: "Previsão do PLD para os próximos 7 dias de um submercado (modelo LEAR combinado com ingênuo semanal, bandas calibradas): média diária prevista com faixa p05–p95, horas mais caras/baratas das próximas 24 h e o desempenho do modelo no backtest.",
      parameters: { type: "object", properties: { sub: SUB_ENUM }, required: ["sub"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "estudo_bess",
      description: "Estudo de uma bateria (BESS) no PLD real: despacho ótimo diário, receita, ciclos, preços médios de compra/venda e modelo financeiro (CAPEX implícito, VPL, TIR, payback, LCOS de equilíbrio) com cenários. Parâmetros omitidos usam o ativo selecionado pelo usuário.",
      parameters: {
        type: "object",
        properties: {
          sub: SUB_ENUM,
          pow: { type: "number", description: "potência em MW (1–2000)" },
          cap: { type: "number", description: "energia em MWh (1–8000)" },
          rte: { type: "number", description: "eficiência ida-volta em % (50–99)" },
          lcos: { type: "number", description: "custo nivelado em R$/MWh" },
          maxc: { type: "number", description: "máximo de ciclos por dia (0,25–3)" },
          days: { type: "integer", description: "janela de PLD realizado em dias (30–365)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "oportunidades",
      description: "Scanner de oportunidades calculado no PLD publicado (amanhã, hoje ou último dia completo) para o ativo selecionado: BESS intraday por submercado, captura de ponta, deslocamento de carga e armazenamento de excedente no piso, com margem bruta em R$/MW·dia e se cobre o custo nivelado.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reservatorios",
      description: "Hidrologia e carga do SIN (ONS): energia armazenada (EAR, % da capacidade) com variação em 30 dias, afluência (ENA, % da MLT) e carga horária mais recente por submercado.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "saude_dados",
      description: "Saúde das fontes de dados segundo o agente auditor: score geral, fontes fora do ar ou degradadas com o erro, modo de dados (live = nunca simula) e o estado do PLD.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "confianca_dados",
      description: "Confiança nos dados abertos (ONS e CCEE): se alguma fonte republicou dias passados com valores diferentes nos últimos 30 dias (revisão retroativa), se há dias incompletos nos últimos 10 dias, e o selo (alta/média/baixa) de cada fonte. Use quando perguntarem se um dado é confiável, se foi revisado ou se a base mudou.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "renovaveis_corte",
      description: "Corte (curtailment / constrained-off) de eólica e solar pelo ONS nos últimos dias fechados: GWh cortados por fonte, submercado e razão (sobra de energia, rede, confiabilidade), % do potencial, faixa oficial × limitada à disponibilidade, horas com PLD no piso e valor a PLD, curva do pato (rampa da noite). Use para perguntas sobre curtailment, energia desperdiçada, carga líquida ou oportunidade de armazenamento.",
      parameters: {
        type: "object",
        properties: { dias: { type: "integer", minimum: 3, maximum: 31, description: "janela de dias fechados (padrão 14)" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navegar",
      description: "Abre uma tela do SIN OS para o usuário. Use quando ele pedir para abrir, mostrar ou ir para uma tela.",
      parameters: {
        type: "object",
        properties: {
          rota: { type: "string", enum: Object.keys(ROUTES), description: Object.entries(ROUTES).map(([k, v]) => `${k} = ${v}`).join("; ") },
          sub: SUB_ENUM,
        },
        required: ["rota"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configurar_ativo",
      description: "Altera o ativo BESS selecionado do usuário (vale para a Sala de Comando e a tela BESS) e, se pedido, abre a tela BESS com o novo ativo. Use quando o usuário pedir para simular ou configurar uma bateria específica.",
      parameters: {
        type: "object",
        properties: {
          sub: SUB_ENUM,
          pow: { type: "number", description: "potência em MW" },
          cap: { type: "number", description: "energia em MWh" },
          rte: { type: "number", description: "eficiência ida-volta em %" },
          lcos: { type: "number", description: "custo nivelado em R$/MWh" },
          nome: { type: "string", description: "nome curto do ativo" },
          abrir_bess: { type: "boolean", description: "abrir a tela BESS depois de configurar" },
        },
        additionalProperties: false,
      },
    },
  },
];

const asSub = (v: unknown): Sub | null => (typeof v === "string" && (SUBS as readonly string[]).includes(v.toUpperCase()) ? (v.toUpperCase() as Sub) : null);

async function pldAgora(args: Record<string, unknown>, ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const { pld } = await deps.brazil();
  if (pld.simulated) return { result: { erro: SIM_REFUSAL } };
  if (!pld.data) return { result: { erro: `PLD indisponível: ${pld.error ?? "fonte fora do ar"}` } };
  const today = brtDate(ctx.now);
  const tomorrow = brtDate(ctx.now + 86400_000);
  const latest = latestBySub(pld.data, ctx.now);
  const rowToday = dayRow(pld.data, today);
  const rowTomorrow = dayRow(pld.data, tomorrow);
  const only = asSub(args.sub);
  const subs = only ? [only] : [...SUBS];
  return {
    result: {
      agora_brt: stamp(ctx.now),
      fonte: sourceLabel(pld),
      limites_2026: { piso: PLD_LIMITS.min, teto_horario: PLD_LIMITS.maxHourly, teto_estrutural_media_diaria: PLD_LIMITS.maxStructural },
      submercados: subs.map((s) => {
        const tm = dayStats(rowTomorrow[s]);
        return {
          sub: s,
          nome: SUB_NAMES[s],
          pld_ultima_hora: latest[s] ? { valor: r2(latest[s]!.value), hora_brt: stamp(latest[s]!.ts) } : null,
          hoje: dayStats(rowToday[s]),
          amanha: tm && tm.horas >= 20 ? tm : null,
        };
      }),
      observacao: "PLD de hoje só aparece depois da publicação; se 'hoje' vier nulo, use pld_ultima_hora e diga a data/hora dela.",
    },
  };
}

async function previsaoPld(args: Record<string, unknown>, ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const sub = asSub(args.sub) ?? ctx.asset.sub;
  const { fc, simulated, fallback } = await deps.forecast(sub);
  if (simulated) return { result: { erro: SIM_REFUSAL } };
  const next = fc.horizon.ts.map((t, i) => [t, fc.horizon.point[i]] as const).filter(([t]) => t > ctx.now).slice(0, 24);
  const lo = next.length ? next.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
  const hi = next.length ? next.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  return {
    result: {
      sub,
      nome: SUB_NAMES[sub],
      ultimo_dia_observado: fc.lastObservedDate,
      primeiro_dia_previsto: fc.firstForecastDate,
      base_de_dados: fallback ? fallback.slice(0, 160) : "PLD real",
      media_diaria_prevista: fc.horizon.dailyMean.map((d) => ({ data: d.date, previsto: r2(d.point), p05: r2(d.p05), p95: r2(d.p95) })),
      proximas_24h: lo && hi ? { mais_barata: { hora_brt: stamp(lo[0]), valor: r2(lo[1]) }, mais_cara: { hora_brt: stamp(hi[0]), valor: r2(hi[1]) } } : null,
      backtest: {
        dias: fc.backtest.days,
        mae_rs_mwh: r2(fc.backtest.maeModel),
        rmae_vs_ingenuo: r2(fc.backtest.rmae),
        cobertura_banda: r2(fc.backtest.aci.coverage),
      },
      avisos: fc.warnings.slice(0, 3),
    },
  };
}

function bessQuery(args: Record<string, unknown>, asset: AssetCtx) {
  const pick = (k: keyof AssetCtx) => (typeof args[k] === "number" && Number.isFinite(args[k]) ? (args[k] as number) : asset[k]);
  return BESS_QUERY.parse({
    pow: pick("pow"),
    cap: pick("cap"),
    rte: pick("rte"),
    deg: asset.deg,
    lcos: pick("lcos"),
    wacc: asset.wacc,
    life: asset.life,
    opex: asset.opex,
    ref: asset.ref,
    maxc: pick("maxc"),
    days: pick("days"),
  });
}

async function estudoBess(args: Record<string, unknown>, ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const sub = asSub(args.sub) ?? ctx.asset.sub;
  const q = bessQuery(args, ctx.asset);
  const { study: s, pld } = await deps.bess(toBessParams(sub, q));
  if (pld.simulated) return { result: { erro: SIM_REFUSAL } };
  const f = s.finance;
  return {
    result: {
      ativo: { sub, nome: SUB_NAMES[sub], potencia_mw: q.pow, energia_mwh: q.cap, eficiencia_pct: q.rte, lcos_rs_mwh: q.lcos, ciclos_max_dia: q.maxc },
      janela: s.window,
      fonte_pld: sourceLabel(pld),
      ultimos_30_dias: { receita_rs: r2(s.last30.revenue), receita_media_dia_rs: r2(s.last30.revenuePerDay), ciclos_dia: r2(s.last30.cyclesPerDay), compra_media_rs_mwh: r2(s.last30.avgBuy), venda_media_rs_mwh: r2(s.last30.avgSell) },
      janela_completa: { dias: s.full.days, receita_rs: r2(s.full.revenue), ciclos_dia: r2(s.full.cyclesPerDay) },
      margem: { spread_rs_mwh: r2(s.margin.spread), spread_liquido_rs_mwh: r2(s.margin.netSpread), margem_liquida_rs_mwh: r2(s.margin.netMargin) },
      financeiro: {
        receita_ano1_rs: r2(f.revenueYear1),
        capex_implicito_rs: r2(f.capex),
        capex_rs_kwh: r2(f.capexPerKWh),
        vpl_rs: r2(f.npv),
        tir_pct: f.irr === null ? null : r2(f.irr * 100),
        payback_anos: r2(f.paybackYears),
        roi_pct: r2(f.roi * 100),
        lcos_equilibrio_rs_mwh: r2(f.breakevenLcos),
        lcos_efetivo_rs_mwh: r2(f.effectiveLcos),
      },
      cenarios: s.scenarios.map((c) => ({ nome: c.name, receita_ano_rs: r2(c.revenueYear), tir_pct: c.irr === null ? null : r2(c.irr * 100), payback_anos: r2(c.paybackYears) })),
      notas: s.notes.slice(0, 3),
    },
  };
}

async function oportunidades(_args: Record<string, unknown>, ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const { pld } = await deps.brazil();
  if (pld.simulated) return { result: { erro: SIM_REFUSAL } };
  if (!pld.data) return { result: { erro: `PLD indisponível: ${pld.error ?? "fonte fora do ar"}` } };
  const day = pickDay(pld.data.ts, pld.data.values, brtDate(ctx.now), brtDate, brtHour);
  if (!day) return { result: { erro: "nenhum dia completo de PLD disponível" } };
  const rows = buildOpportunities({ day, floor: PLD_LIMITS.min, asset: { pow: ctx.asset.pow, cap: ctx.asset.cap, rte: ctx.asset.rte, lcos: ctx.asset.lcos } });
  return {
    result: {
      dia: { data: day.date, rotulo: day.label, publicado: day.published },
      ativo: `${ctx.asset.pow} MW / ${ctx.asset.cap} MWh, eficiência ${ctx.asset.rte}%, LCOS R$ ${ctx.asset.lcos}/MWh`,
      fonte: sourceLabel(pld),
      linhas: rows.slice(0, 6).map((o) => ({
        estrategia: o.strategy,
        mercado: o.market,
        spread_rs_mwh: r2(o.spread),
        margem_bruta_rs_mw_dia: r2(o.margin),
        custo_nivelado_rs_mw_dia: r2(o.costPerMWDay),
        cobre_custo: o.margin !== null && o.costPerMWDay !== null ? o.margin >= o.costPerMWDay : null,
        detalhe: o.detail,
      })),
    },
  };
}

function lastDaily(p: DailySubPanel | null, s: Sub, back = 0) {
  if (!p) return null;
  const idx = p.values[s].map((v, i) => [i, v] as const).filter(([, v]) => v !== null);
  const at = idx[idx.length - 1 - back];
  return at ? { data: p.dates[at[0]], valor: r2(at[1]) } : null;
}

async function reservatorios(_args: Record<string, unknown>, _ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const { ear, ena, load } = await deps.brazil();
  if (ear.simulated || ena.simulated || load.simulated) return { result: { erro: SIM_REFUSAL } };
  const lastLoad = load.data ? latestBySub(load.data) : null;
  return {
    result: {
      fontes: { ear: sourceLabel(ear), ena: sourceLabel(ena), carga: sourceLabel(load) },
      submercados: SUBS.map((s) => {
        const e = lastDaily(ear.data, s);
        const e30 = lastDaily(ear.data, s, 30);
        return {
          sub: s,
          nome: SUB_NAMES[s],
          ear_pct: e,
          ear_variacao_30d_pp: e && e30 && e.valor !== null && e30.valor !== null ? r2(e.valor - e30.valor) : null,
          ena_pct_mlt: lastDaily(ena.data, s),
          carga_mwmed: lastLoad?.[s] ? { valor: Math.round(lastLoad[s]!.value), hora_brt: stamp(lastLoad[s]!.ts) } : null,
        };
      }),
    },
  };
}

async function saudeDados(_args: Record<string, unknown>, _ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const [run, br] = await Promise.all([deps.latestAudit(), deps.brazil()]);
  return {
    result: {
      modo_dados: deps.dataMode(),
      pld: sourceLabel(br.pld),
      auditoria: run
        ? {
            em_brt: stamp(run.startedAt),
            score: run.overallScore,
            contagem: run.counts,
            problemas: run.sources
              .filter((s) => s.status === "down" || s.status === "degraded")
              .map((s) => ({ fonte: s.name, status: s.status, erro: (s.error ?? "").slice(0, 160), idade_h: r2(s.ageHours) })),
          }
        : null,
    },
  };
}

async function confiancaDados(_args: Record<string, unknown>, _ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const t = await deps.trust();
  return {
    result: {
      janela_completude_dias: t.windowDays,
      revisoes_retroativas_30d: t.totalRevisions30d,
      fontes: t.seals.map((s) => ({ fonte: s.name, monitorada: s.monitored, selo: s.monitored ? s.level : "sem dado real nesta leitura", revisoes_30d: s.revisions30d, observacoes: s.reasons })),
      nota: "O selo mostra que o dado mudou ou veio incompleto; não diz qual versão está correta.",
    },
  };
}

async function renovaveisCorte(args: Record<string, unknown>, _ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  const n = Number(args.dias ?? 14);
  const days = Number.isFinite(n) ? Math.min(31, Math.max(3, Math.round(n))) : 14;
  const r = await deps.renewables(days);
  const c = r.curtailment;
  if (!c) return { result: { erro: `corte do ONS indisponível agora: ${r.meta.curtailment.error ?? "sem dados"}` } };
  const g = (mwh: number) => Math.round(mwh / 100) / 10;
  return {
    result: {
      janela: `${c.from} a ${c.to} (${c.days} dias fechados)`,
      eolica_cortada_gwh: g(c.totals.eolicaMWh),
      solar_cortada_gwh: g(c.totals.solarMWh),
      percentual_do_potencial: c.curtailedSharePct,
      faixa_gwh: { piso_limitado_a_disponibilidade: g(c.totals.cappedMWh), oficial_ons: g(c.totals.eolicaMWh + c.totals.solarMWh) },
      por_razao_gwh: Object.fromEntries(Object.entries(c.totals.byReason).map(([k, v]) => [r.reasonLabel[k as keyof typeof r.reasonLabel], g(v)])),
      por_submercado_gwh: Object.fromEntries(Object.entries(c.totals.bySub).map(([k, v]) => [k, g(v)])),
      corte_x_pld: r.vsPld?.map((x) => ({ sub: x.sub, horas_com_corte: x.hours, pct_com_pld_no_piso: x.sharePct, pld_medio_no_corte: x.avgPld, valor_a_pld_reais: x.valueBRL })) ?? "PLD indisponível",
      pld_oficial: r.pldOfficial,
      carga_liquida: r.netLoad ? { rampa_noite_mw_3h: r.netLoad.eveningRampMW, hora_do_minimo: r.netLoad.minHour, participacao_eolica_solar_pct: r.netLoad.renewableSharePct } : "indisponível",
      observacoes: r.notes,
    },
  };
}

function navegar(args: Record<string, unknown>): ToolOutcome {
  const rota = typeof args.rota === "string" && args.rota in ROUTES ? (args.rota as Route) : null;
  if (!rota) return { result: { erro: `rota desconhecida; use uma de ${Object.keys(ROUTES).join(", ")}` } };
  const sub = asSub(args.sub);
  const href = sub && (rota === "/bess" || rota === "/previsao") ? `${rota}?sub=${sub}` : rota;
  return { result: { ok: true, abrindo: ROUTES[rota] }, actions: [{ type: "navigate", href, label: ROUTES[rota] }] };
}

function configurarAtivo(args: Record<string, unknown>, ctx: ToolCtx): ToolOutcome {
  const patch: Partial<AssetCtx> = {};
  const errors: string[] = [];
  for (const k of ["pow", "cap", "rte", "lcos"] as const) {
    if (args[k] === undefined) continue;
    const r = BESS_QUERY.shape[k].safeParse(args[k]);
    if (r.success) patch[k] = r.data;
    else errors.push(`${k} fora da faixa`);
  }
  const sub = asSub(args.sub);
  if (sub) patch.sub = sub;
  if (typeof args.nome === "string" && args.nome.trim()) patch.name = args.nome.trim().slice(0, 60);
  else if (patch.pow || patch.cap) patch.name = `BESS ${patch.pow ?? ctx.asset.pow} MW / ${patch.cap ?? ctx.asset.cap} MWh`;
  if (!Object.keys(patch).length) return { result: { erro: errors.join("; ") || "nenhum parâmetro válido" } };
  const merged = { ...ctx.asset, ...patch };
  const actions: AssistantAction[] = [{ type: "asset", patch, label: `${merged.pow} MW / ${merged.cap} MWh · ${merged.sub}` }];
  if (args.abrir_bess === true) actions.push({ type: "navigate", href: `/bess?sub=${merged.sub}`, label: "BESS" });
  return { result: { ok: true, ativo: merged, avisos: errors }, actions };
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolCtx, deps: AssistantDeps): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "pld_agora":
        return await pldAgora(args, ctx, deps);
      case "previsao_pld":
        return await previsaoPld(args, ctx, deps);
      case "estudo_bess":
        return await estudoBess(args, ctx, deps);
      case "oportunidades":
        return await oportunidades(args, ctx, deps);
      case "reservatorios":
        return await reservatorios(args, ctx, deps);
      case "saude_dados":
        return await saudeDados(args, ctx, deps);
      case "confianca_dados":
        return await confiancaDados(args, ctx, deps);
      case "renovaveis_corte":
        return await renovaveisCorte(args, ctx, deps);
      case "navegar":
        return navegar(args);
      case "configurar_ativo":
        return configurarAtivo(args, ctx);
      default:
        return { result: { erro: `ferramenta desconhecida: ${name}` } };
    }
  } catch (e) {
    return { result: { erro: e instanceof Error ? e.message.slice(0, 300) : String(e) } };
  }
}
