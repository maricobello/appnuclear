import { z } from "zod";
import { PAIRS } from "../market/interchange";

/**
 * Relatório diário do modelo da rede (grid/run.py, no GitHub Actions): fluxo de potência AC
 * hora a hora no SIN montado só com os cadastros e a operação do ONS, resolvido pelo p3s, com
 * a contingência N-1 na hora de maior carga e a validação contra o intercâmbio medido.
 * O esquema é o contrato com o worker: campo fora dele é descartado, valor fora de faixa reprova.
 */
const n = z.number().finite();
const nn = n.nullable();
const int = z.number().int();
const text = (max: number) => z.string().max(max);
const hourly = z.array(nn).length(24);
const latLon = z.tuple([n.min(-40).max(10), n.min(-80).max(-30)]);

export const GRID_STATUS = ["bom", "atencao", "ruim"] as const;
export type GridStatus = (typeof GRID_STATUS)[number];

export const GridSnapshotSchema = z.object({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string().max(40),
  hours: z.array(text(20)).length(24),
  peakHour: int.min(0).max(23).nullable(),
  solver: z.object({
    nome: text(120),
    versao: text(40),
    commit: text(64),
    pandapower: text(40),
    metodo: text(200),
    segundos: nn,
  }),
  model: z.record(text(60), z.union([n, z.array(int).max(50), z.null()])),
  assumptions: z.array(text(400)).max(20),
  validation: z.object({
    converged: int.min(0).max(24),
    hours: int.min(1).max(24),
    pandapower: z.object({
      hora: int.nullable().optional(),
      convergiu: z.boolean().optional(),
      dif_max_mw: nn.optional(),
      dif_media_mw: nn.optional(),
      ok: z.boolean().optional(),
      erro: text(300).optional(),
    }),
    slack_mw: z.object({ min: nn, mean: nn, max: nn }),
    carga_media_mw: nn,
    perdas_media_mw: nn,
    perdas_pct: nn,
    cobertura_rede_basica: nn,
    geracao_mwmed_por_metodo: z.record(text(30), nn),
    usinas_sem_barra: z.array(z.object({ nome: text(120), uf: text(4).nullable(), mwmed: nn })).max(20),
    intercambio: z
      .array(
        z.object({
          par: z.enum(PAIRS),
          nome: text(60),
          modelo: hourly,
          real: hourly,
          mae_mw: nn,
          erro_rel: nn,
          correlacao: nn,
          status: z.enum(GRID_STATUS).nullable(),
        }),
      )
      .max(4),
    tensao: z.object({ hora: int.nullable(), faixa_090_110: nn, min: nn, max: nn }).nullable(),
  }),
  lines: z.array(z.object({ id: int, n: text(80), kv: int, a: latLon, b: latLon, max: nn })).max(5000),
  topLines: z
    .array(
      z.object({
        id: int,
        nome: text(120),
        kv: int,
        cap_mva: nn,
        subs: z.array(text(4).nullable()).length(2),
        max: nn,
        hora_max: int.min(0).max(23),
        carregamento: hourly,
        mw: hourly,
      }),
    )
    .max(50),
  topTrafos: z.array(z.object({ id: int, estacao: text(120), kv: text(20), mva: nn, max: nn })).max(30),
  n1: z.object({
    hora: int.min(0).max(23).optional(),
    contingencias: int.min(0).optional(),
    convergiram: int.min(0).optional(),
    com_sobrecarga: int.min(0).optional(),
    criterio: text(300),
    top: z.array(z.object({ fora: text(120), pior: text(120), carregamento: nn, cap_curta_mva: nn, sem_atendimento: int.min(0) })).max(30),
    nao_convergiram: z.array(text(120)).max(20),
  }),
  hvdc: z.object({ xingu_sudeste_mw: hourly }),
  // só arquivos do bucket público do ONS (a tela renderiza o endereço como link)
  sources: z.array(z.object({ name: text(80), url: text(300).regex(/^https:\/\/ons-aws-prod-opendata\.s3\.amazonaws\.com\/dataset\/[\w./-]+$/), modified: text(40).nullable() })).max(30),
});

export type GridSnapshot = z.infer<typeof GridSnapshotSchema>;

/** Resumo de um dia para o histórico (vai junto do relatório completo, no mesmo documento). */
export interface GridDaySummary {
  date: string;
  generatedAt: string;
  converged: number;
  hours: number;
  pandapowerOk: boolean | null;
  coverage: number | null;
  lossesPct: number | null;
  interchange: { par: string; erro_rel: number | null; status: GridStatus | null }[];
  n1: { contingencias: number | null; com_sobrecarga: number | null; nao_convergiram: number };
  top: { nome: string; max: number | null } | null;
}

export const HISTORY_DAYS = 30;
/** O worker roda 2×/dia sobre D−1: acima disso o retrato está atrasado. */
export const GRID_STALE_DAYS = 2;

export function summarize(s: GridSnapshot): GridDaySummary {
  const v = s.validation;
  return {
    date: s.date,
    generatedAt: s.generatedAt,
    converged: v.converged,
    hours: v.hours,
    pandapowerOk: v.pandapower.ok ?? null,
    coverage: v.cobertura_rede_basica,
    lossesPct: v.perdas_pct,
    interchange: v.intercambio.map((x) => ({ par: x.par, erro_rel: x.erro_rel, status: x.status })),
    n1: { contingencias: s.n1.contingencias ?? null, com_sobrecarga: s.n1.com_sobrecarga ?? null, nao_convergiram: s.n1.nao_convergiram.length },
    top: s.topLines[0] ? { nome: s.topLines[0].nome, max: s.topLines[0].max } : null,
  };
}

/** Novo resumo entra no lugar do mesmo dia (o worker reprocessa D−1 duas vezes); guarda os últimos 30 dias. */
export function mergeHistory(prev: GridDaySummary[], next: GridDaySummary): GridDaySummary[] {
  return [...prev.filter((x) => x.date !== next.date), next].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS);
}

/** Dias inteiros entre a data do retrato (BRT) e hoje (BRT). */
export function snapshotAgeDays(date: string, todayBrt: string): number {
  return Math.round((Date.parse(`${todayBrt}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400_000);
}
