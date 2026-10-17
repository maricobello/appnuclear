import { z } from "zod";
import { PAIRS } from "../market/interchange";

/**
 * Relatório do planejamento (planning/run.py, no GitHub Actions): o NovoModelo — o SDDP oficial
 * de ONS, CCEE e EPE — rodado sobre um caso do SIN montado só com dados abertos do ONS. O esquema
 * é o contrato com o worker: campo fora dele é descartado, valor fora de faixa reprova.
 */
const n = z.number().finite();
const nn = n.nullable();
const int = z.number().int();
const text = (max: number) => z.string().max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ym = z.string().regex(/^\d{4}-\d{2}$/);
const bySub = <T extends z.ZodTypeAny>(t: T) => z.object({ SE: t, S: t, NE: t, N: t });

/** Média e quantis entre os cenários simulados. */
export const QuantSchema = z.object({ mean: nn, p10: nn, p50: nn, p90: nn });
export type Quant = z.infer<typeof QuantSchema>;

const MonthSchema = z.object({
  mes: ym,
  cobertura: n.min(0).max(1.001),
  cmo: bySub(QuantSchema),
  /** PLD do SDDP: CMO de cada patamar entre piso e teto. */
  pld: bySub(QuantSchema),
  /** PLD com ponta: CMO do estágio + desvios horários recentes do DESSEM, entre piso e teto (a manchete). */
  pld_ponta: bySub(QuantSchema).optional(),
  /** Faixa publicada: a mais larga entre a do modelo e a da retroanálise (conformal). */
  pld_faixa: bySub(z.object({ p10: nn, p90: nn, calibrada: z.boolean() })).optional(),
});
const Pld12Schema = z.union([bySub(QuantSchema), z.object({}).strict()]);

export const PlanReportSchema = z.object({
  v: z.literal(1),
  generatedAt: text(40),
  asof: day,
  start: day,
  solver: z.object({
    nome: text(120),
    versao: text(40),
    metodo: text(200),
    iterations: int.min(1),
    lower_bound: n,
    upper_bound: nn,
    seconds: n,
    lb_variacao_ultimas_10: nn,
    lb_trajetoria: z.array(n).max(80),
    segundos_total: n,
  }),
  params: z.object({
    deficit_cost: n,
    cvar_alpha: n.min(0).max(1),
    cvar_lambda: n.min(0).max(1),
    discount_rate: n.min(0).max(1),
    horizon_months: int.min(1).max(240),
    openings: int.min(1),
    forward_passes: int.min(1),
    iterations: int.min(1),
    sim_scenarios: int.min(1),
    max_order: int,
    order_selection: text(30),
    seed: int,
    spill_cost: n,
    curtail_cost: n,
    exchange_cost: n,
    inflow_mult: n,
    load_mult: n,
    ncs_mult: n,
    pld_limites: z.record(text(4), z.object({ min: n, max_h: n, max_est: n })),
  }),
  caso: z.object({
    aproveitamento_ena: bySub(
      z.object({ k: n, k_bruto: n, dias: int, geracao_mwmed: n, vertimento_mwmed: n, delta_ear_mwmed: n, ena_mwmed: n }),
    ),
    /** REEs a fio d'água (turbináveis, sem estoque) e a conferência da soma por REE contra o subsistema. */
    fio_dagua: z
      .object({
        rees: bySub(z.array(text(30)).max(12)),
        tabela: z
          .array(
            z.object({
              ree: text(30),
              sub: text(2).nullable(),
              ena_armazenavel_mwmed: n,
              ear_max_mwmes: n,
              meses_de_estoque: nn,
              fio_dagua: z.boolean(),
            }),
          )
          .max(30),
        erro_soma_ree: n,
        fracao_media: bySub(n),
      })
      .nullable()
      .optional(),
    armazenamento: bySub(z.object({ max_mwmes: n, cur_mwmes: n, pct: n })),
    hidro_disponivel_mw: bySub(n),
    /** Defluência mínima agregada (MW) dos subsistemas sem fio d'água. */
    vazao_minima_mw: z.record(text(2), n).optional(),
    intercambio: z.array(z.object({ pair: z.enum(PAIRS), from: text(2), to: text(2), direct_mw: n, reverse_mw: n, mean_mw: n })).length(4),
    intercambio_liquido: bySub(z.object({ exporta_mw: n, recebe_mw: n })),
    /** Mínimo e máximo de EAR (% do máximo) já operados em cada mês do ano ("1" a "12"). */
    envelope: bySub(z.record(z.string().regex(/^(?:[1-9]|1[0-2])$/), z.object({ min: n, max: n }))),
    termicas: z.object({
      usinas: int,
      pmo: text(80),
      fonte_disponibilidade: text(40),
      disponivel_mw: bySub(n),
      inflexivel_mw: bySub(n),
      cvu_faixa: z.array(n).length(3),
    }),
    crescimento_12m: bySub(z.object({ carga: n, eolica: n, solar: n })),
    estagios: int,
    fim: day,
    patamares: z.array(text(20)).max(5),
    fontes_nao_controlaveis: int,
    carga_liquida_mw: bySub(z.array(n).max(13)),
    par: z.object({
      metodo: text(20),
      ordem_max: int,
      tentativas: z.array(z.object({ metodo: text(20), ordem_max: int, erro: text(300) })).max(10),
      ordens: z.record(text(3), z.object({ min: int, max: int, media: n })),
    }),
  }),
  resultado: z.object({
    meses: z.array(MonthSchema).min(1).max(13),
    estagios: z
      .array(
        z.object({
          inicio: day,
          fim: day,
          ear_fim_pct: bySub(QuantSchema),
          risco_deficit: bySub(n.min(0).max(1)),
          deficit_esperado_mw: bySub(n),
          termica_mw: bySub(QuantSchema),
          corte_renovavel_mw: bySub(n),
          valor_agua: bySub(QuantSchema),
        }),
      )
      .min(1)
      .max(13),
    primeiro_estagio_patamares: bySub(z.record(text(20), QuantSchema)),
    pld_12m: Pld12Schema,
    pld_12m_ponta: Pld12Schema.optional(),
    cenarios: int.min(1),
  }),
  calibracao: z
    .object({
      /** Quantis do erro da retroanálise por horizonte h (mês M+h previsto no dia 1º de M). */
      residuo: z.record(text(2), z.array(z.object({ h: int.min(0).max(24), p10: n, p90: n, n: int })).max(24)),
      fonte: text(200),
    })
    .nullable()
    .optional(),
  /** Aversão a risco implícita: o λ do CVaR (e, se ele satura, a elevação do piso do SE) que faz o
   *  CMO do 1º estágio reproduzir o CMO recente do DESSEM. */
  calibracao_risco: z
    .object({
      lambda: n.min(0).max(1),
      piso_pp: n.min(0).max(60).optional(),
      indice: n.min(0).optional(),
      cmo: n,
      alvo: n,
      tolerancia: n,
      limite: z.enum(["piso", "teto"]).nullable(),
      tentativas: z.array(z.object({ lambda: n.min(0).max(1), piso_pp: n.min(0).max(60).optional(), cmo: n })).min(1).max(8),
      lambda_padrao: n.min(0).max(1),
      sub: z.enum(["SE", "S", "NE", "N"]),
      alvo_por_sub: bySub(n),
      alvo_fonte: text(200),
      puro: z.array(z.object({ mes: ym, pld_p50: bySub(nn) })).max(13),
      puro_pld_12m: bySub(nn),
    })
    .nullable()
    .optional(),
  ponta: z
    .object({
      janela_dias: int.min(1).max(120),
      fonte: text(120),
      desvio: bySub(z.object({ p05: n, p50: n, p95: n })),
    })
    .optional(),
  sensibilidades: z
    .array(
      z.object({
        nome: text(20),
        rotulo: text(120),
        parametros: z.record(text(30), n),
        meses: z.array(MonthSchema).max(13),
        pld_12m: Pld12Schema,
        pld_12m_ponta: Pld12Schema.optional(),
        segundos: n,
      }),
    )
    .max(6),
  validacao: z
    .object({
      metricas: z.record(
        text(2),
        z.object({
          meses: int,
          pld_mae_modelo: nn,
          pld_mae_persistencia: nn,
          pld_mae_decomp: nn,
          pld_vies_modelo: nn,
          pld_cobertura_p10_p90: nn,
          pld_mae_ponta: nn.optional(),
          pld_vies_ponta: nn.optional(),
          pld_cobertura_p10_p90_ponta: nn.optional(),
          /** Faixa publicada (calibrada), com cada mês medido pela calibração dos demais. */
          pld_cobertura_calibrada: nn.optional(),
          /** SDDP no λ padrão, sem calibração, e o CMO do DESSEM de 14 dias com a ponta (referências). */
          pld_mae_puro: nn.optional(),
          pld_mae_dessem14: nn.optional(),
          ear_mae_pp: nn,
          ear_vies_pp: nn,
          ear_cobertura_p10_p90: nn,
          horizonte: z
            .array(
              z.object({
                h: int.min(0).max(24),
                n: int,
                mae_modelo: nn,
                mae_puro: nn,
                mae_persistencia: nn,
                mae_dessem14: nn,
                vies_modelo: nn,
                cobertura_modelo: nn,
              }),
            )
            .max(24)
            .optional(),
        }),
      ),
      meses: z
        .array(
          z.object({
            mes: ym,
            lambda: nn.optional(),
            piso_pp: nn.optional(),
            sub: bySub(
              z.object({
                previsto_pld: QuantSchema,
                previsto_pld_ponta: QuantSchema.optional(),
                previsto_puro: nn.optional(),
                dessem14: nn.optional(),
                realizado_pld: nn,
                previsto_ear: QuantSchema,
                realizado_ear: nn,
                decomp: nn,
                persistencia: nn,
              }),
            ),
          }),
        )
        .max(60),
    })
    .nullable(),
  fontes: z
    .array(
      z.object({
        name: text(80),
        url: z.string().regex(/^https:\/\/ons-aws-prod-opendata\.s3\.amazonaws\.com\/dataset\/[\w./-]+$/),
        modified: text(40).nullable(),
        bytes: int.min(0),
      }),
    )
    .max(80),
});
export type PlanReport = z.infer<typeof PlanReportSchema>;

/** Resumo de cada rodada para o histórico: como a previsão do próximo mês e dos 12 meses evoluiu. */
export interface PlanSummary {
  asof: string;
  generatedAt: string;
  /** Primeiro mês civil inteiro à frente (M+1). */
  mes: string;
  m1: Record<"SE" | "S" | "NE" | "N", number | null>;
  pld12: Record<"SE" | "S" | "NE" | "N", number | null> | null;
  ear: Record<"SE" | "S" | "NE" | "N", number>;
}

export const HISTORY_RUNS = 90;
/** O worker roda uma vez por dia; acima disso o relatório está atrasado. */
export const PLAN_STALE_DAYS = 2;

/** PLD que a tela usa como manchete: com ponta quando o relatório traz, senão o do SDDP. */
export const headlinePld = (m: PlanReport["resultado"]["meses"][number]) => m.pld_ponta ?? m.pld;
/** Faixa P10–P90 publicada: a calibrada pela retroanálise quando existe, senão a do modelo. */
export const headlineBand = (m: PlanReport["resultado"]["meses"][number], s: "SE" | "S" | "NE" | "N") =>
  m.pld_faixa?.[s] ?? { p10: headlinePld(m)[s].p10, p90: headlinePld(m)[s].p90, calibrada: false };
export const headline12 = (r: Pick<PlanReport, "resultado">) => {
  const x = r.resultado.pld_12m_ponta && "SE" in r.resultado.pld_12m_ponta ? r.resultado.pld_12m_ponta : r.resultado.pld_12m;
  return "SE" in x ? x : null;
};

export function summarizePlan(r: PlanReport): PlanSummary {
  const full = r.resultado.meses.find((m) => m.cobertura >= 0.999 && m.mes > r.start.slice(0, 7)) ?? r.resultado.meses[0];
  const p12 = headline12(r);
  const subs = ["SE", "S", "NE", "N"] as const;
  return {
    asof: r.asof,
    generatedAt: r.generatedAt,
    mes: full.mes,
    m1: Object.fromEntries(subs.map((s) => [s, headlinePld(full)[s].p50])) as PlanSummary["m1"],
    pld12: p12 ? (Object.fromEntries(subs.map((s) => [s, p12[s].mean])) as NonNullable<PlanSummary["pld12"]>) : null,
    ear: Object.fromEntries(subs.map((s) => [s, r.caso.armazenamento[s].pct])) as PlanSummary["ear"],
  };
}

/** Junta o resumo novo ao histórico (uma entrada por data de referência), mais recente por último. */
export function mergePlanHistory(prev: PlanSummary[], next: PlanSummary): PlanSummary[] {
  const map = new Map(prev.map((x) => [x.asof, x]));
  map.set(next.asof, next);
  return [...map.values()].sort((a, b) => a.asof.localeCompare(b.asof)).slice(-HISTORY_RUNS);
}

export function planAgeDays(r: Pick<PlanReport, "generatedAt">, now = Date.now()): number | null {
  const t = Date.parse(r.generatedAt);
  return Number.isFinite(t) ? (now - t) / 86400_000 : null;
}
