import type { GridSnapshot } from "../grid/snapshot";
import type { PlanReport } from "../planning/report";
import type { BessDay } from "../market/bess-study";
import type { ForecastResult } from "../market/forecast";
import type { RegimeBacktestResult } from "../market/regime-backtest";
import { tinyMw } from "../fmt";
import { THERMAL_CHECKS } from "../market/thermal";
import { brtDate } from "../sources/time";
import { TRACK_MIN_DAYS, type TrackRecord } from "./track-record";
import { SUBS, type Sub } from "../sources/types";

/**
 * Auditoria dos modelos sobre dados reais: cada critério tem alvo fixo e diz "aprovado",
 * "atenção" ou "reprovado". Cobre a previsão publicada (erro contra o ingênuo, significância,
 * bandas e quantis), os modelos de volatilidade e regime (GARCH, MRJD, HMM), o backtest de um ano
 * por regime, o despacho da bateria (LP), a arbitragem e o próprio auditor de APIs.
 */
export type ModelCheckStatus = "pass" | "warn" | "fail";

export interface ModelCheck {
  id: string;
  /** Modelo ou grupo ("Previsão", "Bandas", "Regimes"…). */
  model: string;
  sub: Sub | null;
  label: string;
  value: number | null;
  /** Valor formatado (pt-BR). */
  display: string;
  /** Alvo em linguagem simples ("< 1,00", "90% ± 3 p.p."). */
  target: string;
  status: ModelCheckStatus;
  detail: string;
}

export interface ModelAudit {
  generatedAt: number;
  /** 0–100: aprovado vale 1, atenção 0,5, reprovado 0. */
  score: number;
  counts: Record<ModelCheckStatus, number>;
  checks: ModelCheck[];
  /** Procedência do PLD usado (oficial ou estimado pelo CMO). */
  dataNote: string;
  /** Registro das previsões publicadas: dias já conferidos com o PLD realizado, por submercado. */
  trackRecord: { sub: Sub; logged: number; days: number; from: string | null; to: string | null }[];
  /** Dias conferidos a partir dos quais o registro entra na nota. */
  trackMinDays: number;
}

type Failed = { error: string };
const isFailed = (x: unknown): x is Failed => !!x && typeof x === "object" && "error" in x;

export interface ModelAuditInput {
  now: number;
  forecasts: Partial<Record<Sub, ForecastResult | Failed>>;
  regimes: Partial<Record<Sub, RegimeBacktestResult | Failed | null>>;
  bess: { days: BessDay[]; maxCycles: number } | Failed | null;
  arbitrage: { captureRatio: number | null } | Failed | null;
  selfEval: { precisionMacro: number; recallMacro: number; total: number } | null;
  /** PLD horário recente (todas as horas do painel). */
  pld: { ts: number[]; values: Record<Sub, (number | null)[]> } | null;
  limits: { min: number; maxHourly: number };
  pldSource: string;
  /** Previsões publicadas × PLD realizado (entra na nota a partir de TRACK_MIN_DAYS dias). */
  trackRecords?: Partial<Record<Sub, TrackRecord>>;
  /** Retrato diário do modelo da rede (fluxo AC do worker) e a idade em dias (BRT). */
  grid?: { snapshot: GridSnapshot | null; ageDays: number | null } | null;
  /** Conferências do despacho térmico por motivo × CVU (janela recente). */
  thermal?: { identityMaxGap: number | null; cvuCoverage: number | null; to: string | null } | { error: string } | null;
  /** Último relatório do planejamento (NovoModelo no worker) e a idade em dias. */
  plan?: { report: PlanReport | null; ageDays: number | null } | null;
}

/** Critérios do planejamento (SDDP do NovoModelo sobre o caso montado com dados do ONS). */
export const PLAN_CHECKS = {
  /** Dias desde a rodada: o worker roda uma vez por dia. */
  ageDays: { pass: 2, warn: 4 },
  /** Variação relativa do limite inferior nas últimas 10 iterações (com CVaR é o critério de parada útil). */
  lbStability: { pass: 0.02, warn: 0.05 },
  /** Faixa plausível do fator de aproveitamento da ENA (fora dela o balanço hídrico medido não fecha). */
  kRange: [0.7, 1.08] as const,
  /** Cobertura da faixa P10–P90 na retroanálise (nominal 80%). */
  coverage: { lo: 0.6, hi: 0.97 },
} as const;

/** Critérios do modelo da rede (fluxo de potência AC do SIN). */
export const GRID_CHECKS = {
  /** Dias desde o dia modelado: o ONS publica D−1 no fim da tarde do dia seguinte. */
  ageDays: { pass: 2, warn: 3 },
  /** |injeção extra da barra de referência| ÷ carga média: o que o despacho real não explica. */
  slackShare: { pass: 0.02, warn: 0.05 },
  coverage: { pass: 0.95, warn: 0.9 },
  n1Converged: { pass: 0.99, warn: 0.95 },
  voltageInBand: { pass: 0.95, warn: 0.9 },
  pandapowerMw: 1,
} as const;

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${f(100 * v, d)}%`);

/** Até `pass` aprovado, até `warn` atenção, acima reprovado (para métricas em que menor é melhor). */
const upTo = (v: number | null, pass: number, warn: number): ModelCheckStatus => (v === null || !Number.isFinite(v) ? "warn" : v <= pass ? "pass" : v <= warn ? "warn" : "fail");
/** p-valor de teste em que a hipótese nula é o comportamento correto (ex.: cobertura certa). */
const pTest = (p: number | null | undefined): ModelCheckStatus => (p === null || p === undefined || !Number.isFinite(p) ? "warn" : p >= 0.05 ? "pass" : p >= 0.01 ? "warn" : "fail");

export function auditModels(x: ModelAuditInput): ModelAudit {
  const checks: ModelCheck[] = [];
  const add = (c: ModelCheck) => checks.push(c);
  const today = brtDate(x.now);

  for (const sub of SUBS) {
    // registro das previsões publicadas vem antes: vale mesmo se a previsão de hoje falhar
    const tr = x.trackRecords?.[sub];
    if (tr && tr.days >= TRACK_MIN_DAYS) {
      const period = `${tr.days} dias publicados (${tr.from!.split("-").reverse().join("/")} a ${tr.to!.split("-").reverse().join("/")})`;
      add({
        id: `registro.rmae.${sub}`,
        model: "Previsões publicadas",
        sub,
        label: "Erro do que foi publicado vs. ingênuo",
        value: tr.rmae,
        display: f(tr.rmae),
        target: "< 1,00",
        status: tr.rmae === null ? "warn" : tr.rmae < 1 ? "pass" : tr.rmae <= 1.05 ? "warn" : "fail",
        detail: `${period}: MAE ${f(tr.mae)} contra ${f(tr.maeNaive)} R$/MWh do ingênuo, comparando a previsão gravada no dia em que saiu com o PLD que aconteceu.`,
      });
      add({
        id: `registro.banda.${sub}`,
        model: "Previsões publicadas",
        sub,
        label: "Banda de 90% publicada",
        value: tr.hourCoverage,
        display: pct(tr.hourCoverage),
        target: "90% ± 5 p.p.",
        status: tr.hourCoverage === null ? "warn" : upTo(Math.abs(tr.hourCoverage - 0.9), 0.05, 0.1),
        detail: `${period}: o PLD de cada hora ficou dentro da banda publicada em ${pct(tr.hourCoverage)} das horas.`,
      });
      add({
        id: `registro.media.${sub}`,
        model: "Previsões publicadas",
        sub,
        label: "Faixa de 90% da média do dia publicada",
        value: tr.dayCoverage,
        display: pct(tr.dayCoverage, 0),
        target: "90% ± 10 p.p.",
        status: tr.dayCoverage === null ? "warn" : upTo(Math.abs(tr.dayCoverage - 0.9), 0.1, 0.15),
        detail: `${period}: a média do dia ficou dentro da faixa em ${pct(tr.dayCoverage, 0)} dos dias${tr.mcDayCoverage === null ? "" : `; dentro da faixa 5–95% das trajetórias do Monte Carlo em ${pct(tr.mcDayCoverage, 0)}`}.`,
      });
    }

    const fc = x.forecasts[sub];
    if (!fc || isFailed(fc)) {
      add({ id: `prev.${sub}`, model: "Previsão", sub, label: "Previsão calculada", value: null, display: "—", target: "rodar", status: "fail", detail: fc ? `Não foi possível calcular: ${fc.error}` : "Não calculada nesta auditoria." });
      continue;
    }
    const b = fc.backtest;
    // 4 semanas têm pouco poder estatístico: perder por pouco, sem significância, é "atenção";
    // reprova se for significativamente pior (Diebold–Mariano) ou mais de 15% pior. O veredito de
    // longo prazo é o backtest de 1 ano (regime.geral).
    const dmP = b.dm.pValue;
    const worseSig = dmP > 0.95;
    add({
      id: `prev.rmae.${sub}`,
      model: "Previsão",
      sub,
      label: "Erro vs. ingênuo nas últimas semanas",
      value: b.rmae,
      display: f(b.rmae),
      target: "< 1,00",
      status: b.rmae < 1 ? "pass" : worseSig || b.rmae > 1.15 ? "fail" : "warn",
      detail: `Em ${b.days} dias fora da amostra, a previsão publicada errou ${pct(Math.abs(1 - b.rmae), 0)} ${b.rmae <= 1 ? "menos" : "mais"} que repetir a semana anterior (MAE ${f(b.maeModel)} contra ${f(b.maeNaive)} R$/MWh). ${dmP < 0.05 ? "Vantagem significativa" : worseSig ? "Desvantagem significativa" : "Diferença não significativa"} no teste de Diebold–Mariano (p = ${f(dmP, 3)}).`,
    });
    add({
      id: `prev.combo.${sub}`,
      model: "Previsão",
      sub,
      label: "Combinação ≥ LEAR sozinho",
      value: b.rmae - b.rmaeLear,
      display: `${f(b.rmae)} vs ${f(b.rmaeLear)}`,
      target: "combinação ≤ LEAR",
      status: b.rmae <= b.rmaeLear + 0.005 ? "pass" : "warn",
      detail: b.rmae <= b.rmaeLear + 0.005 ? "Combinar o LEAR com o ingênuo reduz (ou mantém) o erro." : "O LEAR sozinho erra menos que a combinação publicada neste período.",
    });
    const cov = b.aci.coverage;
    add({
      id: `banda.cob.${sub}`,
      model: "Bandas",
      sub,
      label: "Cobertura da banda de 90%",
      value: cov,
      display: pct(cov),
      target: "90% ± 3 p.p.",
      status: upTo(Math.abs(cov - 0.9), 0.03, 0.07),
      detail: `O preço realizado ficou dentro da banda publicada em ${pct(cov)} das horas do teste.`,
    });
    add({
      id: `banda.kupiec.${sub}`,
      model: "Bandas",
      sub,
      label: "Teste de Kupiec (cobertura)",
      value: b.aci.kupiecP,
      display: `p = ${f(b.aci.kupiecP, 3)}`,
      target: "p ≥ 0,05",
      status: pTest(b.aci.kupiecP),
      detail: "Testa se a taxa de horas fora da banda é a esperada (10%), com correção para horas do mesmo dia.",
    });
    add({
      id: `banda.chr.${sub}`,
      model: "Bandas",
      sub,
      label: "Erros independentes (Christoffersen)",
      value: b.aci.christoffersenP,
      display: `p = ${f(b.aci.christoffersenP, 3)}`,
      target: "p ≥ 0,05",
      status: pTest(b.aci.christoffersenP),
      detail: `Testa se as horas fora da banda aparecem agrupadas. Depois de uma hora fora, a mesma hora do dia seguinte saiu de novo em ${pct(b.aci.pi11, 0)} das vezes (${pct(b.aci.pi01, 0)} depois de uma hora dentro). A banda que se adapta à volatilidade recente foi testada em 365 dias de PLD real: corrige o agrupamento mas piora o interval score em 1–22%, então ficou a banda atual.`,
    });
    add({
      id: `qra.${sub}`,
      model: "Quantis D+1 (QRA)",
      sub,
      label: "Cobertura 5–95% fora da amostra",
      value: b.qraCoverage90,
      display: pct(b.qraCoverage90),
      target: "90% ± 5 p.p.",
      status: upTo(Math.abs(b.qraCoverage90 - 0.9), 0.05, 0.1),
      detail: `CRPS ${f(b.qraCrps)} R$/MWh. Ajustado na 1ª metade do backtest, medido na 2ª.`,
    });
    const h1 = b.horizonErrors.find((h) => h.day === 1)?.mae ?? null;
    const h7 = b.horizonErrors.find((h) => h.day === 7)?.mae ?? null;
    const ratio = h1 && h7 ? h7 / h1 : null;
    add({
      id: `prev.horiz.${sub}`,
      model: "Previsão",
      sub,
      label: "Erro cresce com o horizonte",
      value: ratio,
      display: ratio === null ? "—" : `D+7 / D+1 = ${f(ratio)}`,
      target: "≥ 0,90",
      status: ratio === null ? "warn" : ratio >= 0.9 ? "pass" : "warn",
      detail: ratio === null ? "Sem erro medido em D+1 e D+7." : "Prever mais longe deve errar mais; um D+7 bem melhor que o D+1 indicaria vazamento de informação.",
    });
    // α ≈ 0: sem agrupamento de volatilidade nos retornos diários, a variância condicional fica
    // constante — resultado válido (e α+β ≈ 1 aí não é IGARCH, é β sem efeito).
    const g = fc.garch;
    const flat = !!g && g.alpha < 0.01;
    add({
      id: `garch.${sub}`,
      model: "Volatilidade (GARCH)",
      sub,
      label: "Modelo estacionário",
      value: g?.persistence ?? null,
      display: !g ? "—" : flat ? "α ≈ 0 · constante" : `α+β = ${f(g.persistence, 3)}`,
      target: "< 0,99",
      status: !g ? "warn" : flat || g.persistence < 0.99 ? "pass" : g.persistence < 1 ? "warn" : "fail",
      detail: !g
        ? "GARCH não calibrado nesta série (poucos dias com variação de preço)."
        : flat
          ? `Os retornos diários não mostram agrupamento de volatilidade, então o modelo a trata como constante (${f(g.dailyVolPct, 1)}% ao dia). É um resultado válido, não um defeito.`
          : `Volatilidade diária ${f(g.dailyVolPct, 1)}%; choques perdem metade do efeito em ${f(g.halfLifeDays, 1)} dias.`,
    });
    // MRJD de dois fatores só dá a DEPENDÊNCIA entre horas e dias (cópula); as margens vêm do erro
    // real. O que importa é a calibração no erro de D+1: quanto as horas do dia andam juntas e a
    // rugosidade hora a hora, simuladas iguais às reais. κ e a meia-vida são parâmetros de suavidade.
    const m = fc.mrjd;
    const fit = m?.fit;
    if (m && fit && fit.depReal > 0 && fit.tvReal > 0 && Number.isFinite(fit.depSim) && Number.isFinite(fit.tvSim)) {
      const eDep = Math.abs(fit.depSim / fit.depReal - 1);
      const eTv = Math.abs(fit.tvSim / fit.tvReal - 1);
      const e = Math.max(eDep, eTv);
      add({
        id: `mrjd.${sub}`,
        model: "Cenários (MRJD)",
        sub,
        label: "Cenários calibrados ao erro real",
        value: e,
        display: `desvio ${pct(e, 0)}`,
        target: "≤ 15%",
        status: upTo(e, 0.15, 0.3),
        detail: `Quanto as horas do mesmo dia erram juntas (1 = juntas, 0,04 = independentes): real ${f(fit.depReal)}, simulado ${f(fit.depSim)}. Oscilação do erro hora a hora (mediana): real ${f(fit.tvReal, 0)}, simulada ${f(fit.tvSim, 0)} R$/MWh. O modelo de dois fatores com saltos dá a dependência; a distribuição de cada hora vem do erro real da previsão, separada por previsão no piso ou fora dele.`,
      });
    } else {
      const sane = !!m && m.kappaPerHour > 0 && m.sigma > 0 && m.jumpsPerDay < 24;
      add({
        id: `mrjd.${sub}`,
        model: "Cenários (MRJD)",
        sub,
        label: "Cenários calibrados ao erro real",
        value: null,
        display: m ? "calibração de reserva" : "—",
        target: "cópula empírica",
        status: sane ? "warn" : "fail",
        detail: m ? `Calibrado nos ${m.calibratedOn}: sem erros de backtest suficientes para a calibração principal.${sane ? "" : " Parâmetros fora do plausível."}` : "Sem MRJD: o Monte Carlo usa uma trajetória só.",
      });
    }
    const r = fc.regime;
    const rowErr = r ? Math.max(...r.transition.map((row) => Math.abs(row.reduce((s, v) => s + v, 0) - 1))) : null;
    const probErr = r ? Math.abs(r.current.reduce((s, v) => s + v, 0) - 1) : null;
    add({
      id: `hmm.${sub}`,
      model: "Regimes (HMM)",
      sub,
      label: "Probabilidades consistentes",
      value: rowErr === null || probErr === null ? null : Math.max(rowErr, probErr),
      display: r ? `${r.labels.length} regimes` : "—",
      target: "somas = 1",
      status: !r ? "warn" : Math.max(rowErr!, probErr!) <= 1e-6 ? "pass" : "fail",
      detail: r ? `Regime mais provável agora: ${r.labels[r.current.indexOf(Math.max(...r.current))]} (${pct(Math.max(...r.current), 0)}).` : "HMM não calibrado nesta série.",
    });
    const lagDays = Math.round((Date.parse(`${today}T12:00:00-03:00`) - Date.parse(`${fc.lastObservedDate}T12:00:00-03:00`)) / 86400_000);
    add({
      id: `dados.fresco.${sub}`,
      model: "Dados",
      sub,
      label: "Último dia completo de PLD",
      value: lagDays,
      display: fc.lastObservedDate.split("-").reverse().join("/"),
      target: "ontem ou hoje",
      status: lagDays <= 1 ? "pass" : lagDays <= 3 ? "warn" : "fail",
      detail: lagDays <= 1 ? "A previsão parte do dado mais recente." : `A previsão parte de um dado com ${lagDays} dias.`,
    });
    const dq = fc.dataQuality;
    if (dq) {
      const share = dq.windowDays ? dq.imputedDays / dq.windowDays : 0;
      add({
        id: `dados.lacunas.${sub}`,
        model: "Dados",
        sub,
        label: `Dias faltando na fonte (últimos ${dq.windowDays})`,
        value: share,
        display: `${dq.imputedDays} dia(s)`,
        target: "≤ 3%",
        status: upTo(share, 0.03, 0.1),
        detail: dq.imputedDays ? `Preenchidos por interpolação e deixados fora das métricas. Últimos: ${dq.recentImputed.map((d) => d.split("-").reverse().join("/")).join(", ")}.` : "Nenhum dia faltando.",
      });
    }

    const rg = x.regimes[sub];
    if (rg && !isFailed(rg)) {
      const r = rg.overall.rmae;
      const p = rg.dm?.pValue ?? null;
      add({
        id: `regime.geral.${sub}`,
        model: "Backtest de 1 ano",
        sub,
        label: "D+1 contra o ingênuo",
        value: r,
        display: `${f(r)}${p === null ? "" : ` · p = ${f(p, 3)}`}`,
        target: "< 1,00 e p < 0,05",
        status: r === null ? "warn" : r < 1 && (p === null || p < 0.05) ? "pass" : r > 1.05 || (p !== null && p > 0.95) ? "fail" : "warn",
        detail: `Walk-forward de ${rg.days} dias (${rg.from.split("-").reverse().join("/")} a ${rg.to.split("-").reverse().join("/")}), re-estimado a cada dia: a previsão errou ${r === null ? "—" : `${pct(Math.abs(1 - r), 0)} ${r <= 1 ? "menos" : "mais"}`} que o ingênuo.${p === null ? "" : p < 0.05 ? " Vantagem significativa (Diebold–Mariano com correção HAC)." : p > 0.95 ? " Desvantagem significativa." : " Diferença não significativa."}`,
      });
      // só regimes conhecidos ANTES de prever (estação, reservatório, piso recente): separar pela
      // faixa do PLD realizado favorece quem aposta no extremo (dilema do previsor)
      const exAnte = rg.buckets.filter((k) => k.group !== "faixa_pld" && !k.smallSample && k.rmae !== null).sort((a, b) => b.rmae! - a.rmae!);
      const bad = exAnte[0];
      const realizedFloor = rg.buckets.find((k) => k.group === "faixa_pld" && k.key === "piso");
      if (bad)
        add({
          id: `regime.pior.${sub}`,
          model: "Backtest de 1 ano",
          sub,
          label: "Pior regime (conhecido antes de prever)",
          value: bad.rmae,
          display: `${f(bad.rmae)} · ${bad.label}`,
          target: "≤ 1,05",
          status: upTo(bad.rmae, 1.05, 1.2),
          detail: `${bad.rmae! <= 1.05 ? "Em nenhuma estação, faixa de reservatório ou situação de piso o modelo perde do ingênuo de forma relevante." : `Em "${bad.label}" (${bad.hours} h) o modelo erra mais que o ingênuo: vale desconfiar da previsão nessa situação.`}${realizedFloor?.rmae != null ? ` Nas horas em que o PLD acabou no piso, ${f(realizedFloor.rmae)}: recorte pelo resultado, que favorece o ingênuo e por isso não entra na nota.` : ""}`,
        });
    } else if (rg) {
      add({ id: `regime.geral.${sub}`, model: "Backtest de 1 ano", sub, label: "D+1 contra o ingênuo", value: null, display: "—", target: "rodar", status: "warn", detail: `Não foi possível calcular agora: ${rg.error}` });
    }
  }

  // PLD: limites regulatórios e horas completas nos dias fechados
  if (x.pld) {
    let out = 0;
    let missing = 0;
    let total = 0;
    x.pld.ts.forEach((t, i) => {
      const closed = brtDate(t) < today;
      for (const s of SUBS) {
        const v = x.pld!.values[s][i];
        if (v === null || v === undefined || !Number.isFinite(v)) {
          if (closed) missing++;
        } else if (v < x.limits.min - 0.01 || v > x.limits.maxHourly + 0.01) out++;
        if (closed) total++;
      }
    });
    add({
      id: "pld.limites",
      model: "Dados",
      sub: null,
      label: "PLD dentro do piso e do teto da ANEEL",
      value: out,
      display: out ? `${out} hora(s) fora` : "todas dentro",
      target: `${f(x.limits.min)} a ${f(x.limits.maxHourly)} R$/MWh`,
      status: out ? "fail" : "pass",
      detail: `${x.pldSource}. Conferidas ${x.pld.ts.length} horas × 4 submercados.`,
    });
    const share = total ? missing / total : 0;
    add({
      id: "pld.completo",
      model: "Dados",
      sub: null,
      label: "Horas faltando nos dias fechados",
      value: share,
      display: pct(share, 2),
      target: "< 1%",
      status: share < 0.01 ? "pass" : share < 0.05 ? "warn" : "fail",
      detail: missing ? `${missing} hora(s)×submercado sem valor.` : "Nenhuma hora faltando.",
    });
  }

  if (x.bess && !isFailed(x.bess)) {
    const worse = x.bess.days.filter((d) => d.revenue + 1 < d.naive);
    add({
      id: "bess.otimo",
      model: "Bateria (LP)",
      sub: null,
      label: "Despacho ótimo ≥ regra simples, todo dia",
      value: worse.length,
      display: worse.length ? `${worse.length} dia(s) abaixo` : `${x.bess.days.length} dias ok`,
      target: "0 dias abaixo",
      status: worse.length ? "fail" : "pass",
      detail: worse.length ? `O otimizador rendeu menos que a regra simples em ${worse.map((d) => d.date).slice(0, 3).join(", ")}: o LP não está achando o ótimo.` : "O otimizador (HiGHS) nunca rende menos que carregar nas horas baratas e descarregar nas caras.",
    });
    const maxCyc = Math.max(0, ...x.bess.days.map((d) => d.cycles));
    add({
      id: "bess.ciclos",
      model: "Bateria (LP)",
      sub: null,
      label: "Ciclos dentro do limite",
      value: maxCyc,
      display: `máx. ${f(maxCyc)} ciclo/dia`,
      target: `≤ ${f(x.bess.maxCycles)}`,
      status: maxCyc <= x.bess.maxCycles + 1e-6 ? "pass" : "fail",
      detail: "O despacho respeita a garantia de ciclos por dia do fabricante.",
    });
  } else if (x.bess) {
    add({ id: "bess.otimo", model: "Bateria (LP)", sub: null, label: "Despacho ótimo calculado", value: null, display: "—", target: "rodar", status: "warn", detail: `Não foi possível calcular agora: ${x.bess.error}` });
  }

  if (x.arbitrage && !isFailed(x.arbitrage)) {
    const c = x.arbitrage.captureRatio;
    add({
      id: "arb.captura",
      model: "Arbitragem",
      sub: "SE",
      label: "Captura da regra simples vs. ótimo",
      value: c,
      display: pct(c, 0),
      target: "entre 0% e 100%",
      status: c === null ? "warn" : c >= 0 && c <= 1 + 1e-9 ? "pass" : "fail",
      detail: c === null ? "Sem dias realizados suficientes." : "Acima de 100% indicaria que o ótimo não é ótimo; abaixo de 0%, perda na regra simples.",
    });
  }

  if (x.selfEval) {
    const v = Math.min(x.selfEval.precisionMacro, x.selfEval.recallMacro);
    add({
      id: "auditor.autoavaliacao",
      model: "Auditor de APIs",
      sub: null,
      label: "Detecta falhas injetadas",
      value: v,
      display: pct(v, 0),
      target: "≥ 90%",
      status: v >= 0.9 ? "pass" : "fail",
      detail: `${x.selfEval.total} cenários de falha conhecidos (fora do ar, atrasada, esquema mudou…): precisão ${pct(x.selfEval.precisionMacro, 0)}, recall ${pct(x.selfEval.recallMacro, 0)}.`,
    });
  }

  if (x.grid !== undefined) gridChecks(x.grid, add);
  if (x.thermal !== undefined) thermalChecks(x.thermal, add);
  if (x.plan !== undefined) planChecks(x.plan, add);

  const counts = { pass: 0, warn: 0, fail: 0 } as Record<ModelCheckStatus, number>;
  for (const c of checks) counts[c.status]++;
  const n = checks.length || 1;
  const score = Math.round((100 * (counts.pass + 0.5 * counts.warn)) / n);
  const trackRecord = SUBS.map((sub) => {
    const t = x.trackRecords?.[sub];
    return { sub, logged: t?.logged ?? 0, days: t?.days ?? 0, from: t?.from ?? null, to: t?.to ?? null };
  });
  return { generatedAt: x.now, score, counts, checks, dataNote: x.pldSource, trackRecord, trackMinDays: TRACK_MIN_DAYS };
}

const PAIR_HINT: Record<string, string> = {
  "N-SE": " A compensação série das linhas Norte–Sul não está no cadastro do ONS: no modelo o corredor fica mais \"pesado\" e parte do fluxo desvia pelo Nordeste.",
  "NE-SE": " Parte do erro vem do corredor Norte–Sul, que no modelo empurra fluxo pelo Nordeste.",
};

function gridChecks(g: ModelAuditInput["grid"], add: (c: ModelCheck) => void) {
  const model = "Rede elétrica";
  if (!g) {
    add({ id: "rede.frescor", model, sub: null, label: "Retrato diário da rede lido", value: null, display: "—", target: "ler", status: "warn", detail: "Não foi possível ler o retrato guardado agora (armazenamento indisponível)." });
    return;
  }
  const s = g.snapshot;
  if (!s) {
    add({ id: "rede.frescor", model, sub: null, label: "Retrato diário da rede recebido", value: null, display: "—", target: `≤ ${GRID_CHECKS.ageDays.pass} dias`, status: "warn", detail: "O worker do GitHub Actions (.github/workflows/rede.yml) ainda não enviou o relatório: confira o segredo ADMIN_KEY no GitHub (mesmo valor da Vercel)." });
    return;
  }
  const day = s.date.split("-").reverse().join("/");
  const age = g.ageDays;
  add({
    id: "rede.frescor",
    model,
    sub: null,
    label: "Retrato diário da rede em dia",
    value: age,
    display: age === null ? "—" : `${age} dia(s)`,
    target: `≤ ${GRID_CHECKS.ageDays.pass} dias`,
    status: age === null ? "warn" : age <= GRID_CHECKS.ageDays.pass ? "pass" : age <= GRID_CHECKS.ageDays.warn ? "warn" : "fail",
    detail: `Último dia modelado: ${day} (o ONS publica a operação de um dia no fim da tarde do dia seguinte).`,
  });
  const v = s.validation;
  add({
    id: "rede.convergencia",
    model,
    sub: null,
    label: "Fluxo de potência AC fecha nas 24 horas",
    value: v.converged,
    display: `${v.converged}/${v.hours} h`,
    target: "24/24",
    status: v.converged === v.hours && v.hours === 24 ? "pass" : v.converged >= 22 ? "warn" : "fail",
    detail: `Newton-Raphson em lote (p3s, C++/KLU) sobre ${s.model.barras_ilha_principal ?? "—"} barras e ${s.model.linhas ?? "—"} linhas do cadastro do ONS, com o despacho real de ${day}.`,
  });
  const pp = v.pandapower;
  add({
    id: "rede.pandapower",
    model,
    sub: null,
    label: "Mesmo resultado do pandapower",
    value: pp.dif_max_mw ?? null,
    display: pp.convergiu === false ? "não convergiu" : tinyMw(pp.dif_max_mw),
    target: `< ${GRID_CHECKS.pandapowerMw} MW`,
    status: pp.ok ? "pass" : "fail",
    detail: pp.convergiu === false ? `O solver de referência não fechou na hora ${pp.hora}: ${pp.erro ?? ""}` : `Na hora de maior carga (${pp.hora}h) o fluxo de cada linha no p3s difere do runpp do pandapower em no máximo ${tinyMw(pp.dif_max_mw)}.`,
  });
  const load = v.carga_media_mw;
  const slack = Math.max(Math.abs(v.slack_mw.min ?? 0), Math.abs(v.slack_mw.max ?? 0));
  const share = load ? slack / load : null;
  add({
    id: "rede.balanco",
    model,
    sub: null,
    label: "Despacho real fecha o balanço",
    value: share,
    display: `${f(slack, 0)} MW`,
    target: `≤ ${pct(GRID_CHECKS.slackShare.pass, 0)} da carga`,
    status: upTo(share, GRID_CHECKS.slackShare.pass, GRID_CHECKS.slackShare.warn),
    detail: `A barra de referência (Itaipu 60 Hz) precisou injetar entre ${f(v.slack_mw.min, 0)} e ${f(v.slack_mw.max, 0)} MW além da própria geração, com carga média de ${f(load, 0)} MW e perdas de ${f(v.perdas_pct, 2)}%.`,
  });
  add({
    id: "rede.cobertura",
    model,
    sub: null,
    label: "Usinas da rede básica com barra",
    value: v.cobertura_rede_basica,
    display: pct(v.cobertura_rede_basica),
    target: `≥ ${pct(GRID_CHECKS.coverage.pass, 0)}`,
    status: v.cobertura_rede_basica === null ? "warn" : v.cobertura_rede_basica >= GRID_CHECKS.coverage.pass ? "pass" : v.cobertura_rede_basica >= GRID_CHECKS.coverage.warn ? "warn" : "fail",
    detail: `Geração das usinas despachadas pelo ONS ligada a uma barra do cadastro (por código, conjunto, ponto de conexão ou nome). A que sobra abate a carga do próprio estado${v.usinas_sem_barra[0] ? `; maior sem barra: ${v.usinas_sem_barra[0].nome} (${f(v.usinas_sem_barra[0].mwmed, 0)} MWmed)` : ""}.`,
  });
  for (const x of v.intercambio) {
    add({
      id: `rede.intercambio.${x.par}`,
      model,
      sub: null,
      label: `Intercâmbio ${x.nome} vs. medido`,
      value: x.erro_rel,
      display: x.erro_rel === null ? "—" : pct(x.erro_rel),
      target: "erro ≤ 15% do fluxo",
      status: x.status === "bom" ? "pass" : x.status === "atencao" ? "warn" : x.status === "ruim" ? "fail" : "warn",
      detail: `Fluxo calculado nas linhas da fronteira contra o intercâmbio medido pelo ONS em ${day}: erro médio de ${f(x.mae_mw, 0)} MW, correlação horária ${f(x.correlacao, 3)} (até 15% "aprovado", até 30% "atenção").${PAIR_HINT[x.par] ?? ""}`,
    });
  }
  const tot = s.n1.contingencias ?? 0;
  const conv = s.n1.convergiram ?? 0;
  const share1 = tot ? conv / tot : null;
  add({
    id: "rede.n1",
    model,
    sub: null,
    label: "Contingências N-1 resolvidas",
    value: share1,
    display: `${conv}/${tot}`,
    target: `≥ ${pct(GRID_CHECKS.n1Converged.pass, 0)}`,
    status: share1 === null ? "warn" : share1 >= GRID_CHECKS.n1Converged.pass ? "pass" : share1 >= GRID_CHECKS.n1Converged.warn ? "warn" : "fail",
    detail: `${s.n1.criterio} (${s.n1.hora ?? "—"}h). ${s.n1.com_sobrecarga ?? 0} com sobrecarga${s.n1.nao_convergiram.length ? `; sem solução: ${s.n1.nao_convergiram.slice(0, 3).join(", ")}` : ""}.`,
  });
  if (v.tensao) {
    add({
      id: "rede.tensao",
      model,
      sub: null,
      label: "Tensões plausíveis (0,90–1,10 pu)",
      value: v.tensao.faixa_090_110,
      display: pct(v.tensao.faixa_090_110),
      target: `≥ ${pct(GRID_CHECKS.voltageInBand.pass, 0)} das barras`,
      status: v.tensao.faixa_090_110 === null ? "warn" : v.tensao.faixa_090_110 >= GRID_CHECKS.voltageInBand.pass ? "pass" : v.tensao.faixa_090_110 >= GRID_CHECKS.voltageInBand.warn ? "warn" : "fail",
      detail: `Só plausibilidade: o ONS não publica tensões medidas. Às ${v.tensao.hora}h a menor foi ${f(v.tensao.min, 3)} e a maior ${f(v.tensao.max, 3)} pu (reatores e capacitores manobráveis não estão no modelo).`,
    });
  }
}

function thermalChecks(t: ModelAuditInput["thermal"], add: (c: ModelCheck) => void) {
  const model = "Térmicas e ESS";
  if (!t || isFailed(t)) {
    add({ id: "termicas.dados", model, sub: null, label: "Despacho térmico por motivo lido", value: null, display: "—", target: "ler", status: "warn", detail: t ? `Não foi possível ler agora: ${t.error}` : "Não lido nesta auditoria." });
    return;
  }
  const gap = t.identityMaxGap;
  add({
    id: "termicas.identidade",
    model,
    sub: null,
    label: "Motivos do despacho somam a geração",
    value: gap,
    display: gap === null ? "—" : pct(gap, 2),
    target: `≤ ${pct(THERMAL_CHECKS.identityTol, 0)}`,
    status: gap === null ? "warn" : upTo(gap, THERMAL_CHECKS.identityTol, 3 * THERMAL_CHECKS.identityTol),
    detail: `Pior dia da janela até ${t.to ? t.to.split("-").reverse().join("/") : "—"}: a soma de mérito, inflexibilidade, unit commitment, restrição elétrica, segurança energética e demais motivos contra a geração verificada de cada usina (ONS).`,
  });
  const cov = t.cvuCoverage;
  add({
    id: "termicas.cvu",
    model,
    sub: null,
    label: "Geração com CVU da semana operativa",
    value: cov,
    display: pct(cov),
    target: `≥ ${pct(THERMAL_CHECKS.cvuCoverageMin, 0)}`,
    status: cov === null ? "warn" : cov >= THERMAL_CHECKS.cvuCoverageMin ? "pass" : cov >= 0.95 ? "warn" : "fail",
    detail: "Usina sem CVU no PMO da semana fica fora da estimativa do ESS e da pilha de mérito.",
  });
}

function planChecks(pl: ModelAuditInput["plan"], add: (c: ModelCheck) => void) {
  const model = "Planejamento (SDDP)";
  if (!pl) {
    add({ id: "planejamento.frescor", model, sub: null, label: "Relatório do planejamento lido", value: null, display: "—", target: "ler", status: "warn", detail: "Não foi possível ler o relatório guardado agora (armazenamento indisponível)." });
    return;
  }
  const r = pl.report;
  if (!r) {
    add({ id: "planejamento.frescor", model, sub: null, label: "Relatório do planejamento recebido", value: null, display: "—", target: `≤ ${PLAN_CHECKS.ageDays.pass} dias`, status: "warn", detail: "O worker do GitHub Actions (.github/workflows/planejamento.yml) ainda não enviou o relatório: confira o segredo ADMIN_KEY no GitHub (mesmo valor da Vercel)." });
    return;
  }
  const age = pl.ageDays;
  add({
    id: "planejamento.frescor",
    model,
    sub: null,
    label: "Planejamento rodado em dia",
    value: age,
    display: age === null ? "—" : `${f(age, 1)} dia(s)`,
    target: `≤ ${PLAN_CHECKS.ageDays.pass} dias`,
    status: age === null ? "warn" : age <= PLAN_CHECKS.ageDays.pass ? "pass" : age <= PLAN_CHECKS.ageDays.warn ? "warn" : "fail",
    detail: `Caso com dados do ONS até ${r.asof.split("-").reverse().join("/")}, ${r.caso.estagios} estágios mensais, ${r.resultado.cenarios} cenários simulados.`,
  });
  const lb = r.solver.lb_variacao_ultimas_10;
  add({
    id: "planejamento.convergencia",
    model,
    sub: null,
    label: "Política do SDDP estabilizada",
    value: lb,
    display: lb === null ? "—" : pct(lb, 2),
    target: `≤ ${pct(PLAN_CHECKS.lbStability.pass, 0)} nas últimas 10 iterações`,
    status: lb === null ? "warn" : upTo(lb, PLAN_CHECKS.lbStability.pass, PLAN_CHECKS.lbStability.warn),
    detail: `${r.solver.iterations} iterações com ${r.params.forward_passes} passes forward e ${r.params.openings} aberturas por estágio. Com CVaR o limite inferior mede o risco e o "superior" amostral é custo esperado, então o gap clássico não se aplica.`,
  });
  const ks = SUBS.map((s) => r.caso.aproveitamento_ena[s]);
  const raw = ks.map((k) => k.k_bruto);
  const inRange = raw.every((k) => k >= PLAN_CHECKS.kRange[0] && k <= PLAN_CHECKS.kRange[1]);
  add({
    id: "planejamento.balanco_hidrico",
    model,
    sub: null,
    label: "Balanço hídrico medido fecha",
    value: Math.min(...raw),
    display: SUBS.map((s, i) => `${s} ${f(raw[i], 2)}`).join(" · "),
    target: `k entre ${f(PLAN_CHECKS.kRange[0], 2)} e ${f(PLAN_CHECKS.kRange[1], 2)}`,
    status: inRange ? "pass" : "warn",
    detail: "k = (geração + energia vertida turbinável + variação da EAR) ÷ ENA armazenável, usina a usina nos últimos 24 meses (ONS). Fora da faixa, algum arquivo veio incompleto ou mudou de critério.",
  });
  const cal = r.calibracao_risco ?? null;
  if (cal) {
    const gap = Math.abs(cal.cmo - cal.alvo);
    add({
      id: "planejamento.calibracao_risco",
      model,
      sub: cal.sub,
      label: "Valor da água calibrado no CMO do DESSEM",
      value: gap,
      display: `λ ${f(cal.lambda, 2)}${cal.piso_pp ? ` + piso ${f(cal.piso_pp, 0)} p.p.` : ""} · CMO ${f(cal.cmo, 0)} × alvo ${f(cal.alvo, 0)}`,
      target: `|CMO − alvo| ≤ ${f(cal.tolerancia, 0)} R$/MWh`,
      status: !cal.limite && gap <= cal.tolerancia ? "pass" : "warn",
      detail: cal.limite
        ? `A busca ficou no ${cal.limite} do caminho: nem ${cal.limite === "teto" ? "a aversão máxima (λ 0,99 com o piso do SE +40 p.p.)" : "o valor esperado puro (λ 0)"} leva o CMO do 1º estágio ao do DESSEM (${cal.alvo_fonte}). O preço publicado fica ${cal.limite === "teto" ? "abaixo" : "acima"} do nível oficial.`
        : `O λ do CVaR${cal.piso_pp ? ` (saturado) e a elevação do piso do SE em ${f(cal.piso_pp, 1)} p.p.` : ""} que fazem o CMO do 1º estágio (mediana, ${cal.sub}) reproduzir o ${cal.alvo_fonte}, em ${cal.tentativas.length} rodadas do SDDP. O padrão da CPAMP é λ ${f(cal.lambda_padrao, 2)} sem piso extra.`,
    });
  }
  const m = r.validacao?.metricas ?? null;
  if (!m || !Object.keys(m).length) {
    add({ id: "planejamento.retroanalise", model, sub: null, label: "Retroanálise publicada", value: null, display: "—", target: "publicada", status: "warn", detail: "Ainda não há retroanálise (planning/hindcast.py) no relatório." });
    return;
  }
  for (const s of SUBS) {
    const x = m[s];
    if (!x) continue;
    // O publicado é a combinação (SDDP calibrado + DESSEM de 14 dias) e a faixa dela; as métricas antigas
    // valem para relatórios sem a combinação.
    const mae = x.pld_mae_combinado ?? x.pld_mae_ponta ?? x.pld_mae_modelo;
    const better = mae !== null && x.pld_mae_persistencia !== null ? mae / Math.max(1e-9, x.pld_mae_persistencia) : null;
    add({
      id: `planejamento.pld.${s}`,
      model,
      sub: s,
      label: "PLD do mês seguinte vs. persistência",
      value: better,
      display: better === null ? "—" : `${f(mae, 1)} × ${f(x.pld_mae_persistencia, 1)} R$/MWh`,
      target: "erro ≤ persistência",
      status: better === null ? "warn" : better <= 1 ? "pass" : better <= 1.25 ? "warn" : "fail",
      detail: `Erro médio absoluto do PLD mensal ${x.pld_mae_combinado != null ? "publicado (combinação com pesos calibrados sem o mês avaliado)" : `previsto (P50${x.pld_mae_ponta != null ? ", com a ponta horária" : ""})`} no 1º dia de cada mês contra o realizado, em ${x.meses} meses; persistência = repetir o PLD do mês anterior.${x.pld_mae_dessem14 != null ? ` DESSEM de 14 dias: ${f(x.pld_mae_dessem14, 1)} R$/MWh.` : ""} CMO do DECOMP no mesmo período: ${f(x.pld_mae_decomp, 1)} R$/MWh.`,
    });
    const cov = x.pld_cobertura_combinado ?? x.pld_cobertura_calibrada ?? x.pld_cobertura_p10_p90_ponta ?? x.pld_cobertura_p10_p90;
    add({
      id: `planejamento.faixa.${s}`,
      model,
      sub: s,
      label: "PLD realizado dentro da faixa P10–P90",
      value: cov,
      display: pct(cov, 0),
      target: `${pct(PLAN_CHECKS.coverage.lo, 0)}–${pct(PLAN_CHECKS.coverage.hi, 0)}`,
      status: cov === null ? "warn" : cov >= PLAN_CHECKS.coverage.lo && cov <= PLAN_CHECKS.coverage.hi ? "pass" : cov >= PLAN_CHECKS.coverage.lo - 0.15 ? "warn" : "fail",
      detail: `Faixa nominal de 80%${(x.pld_cobertura_combinado ?? x.pld_cobertura_calibrada) != null ? ` (a publicada, calibrada pelos erros dos outros meses; só a dos cenários do SDDP: ${pct(x.pld_cobertura_p10_p90_ponta ?? x.pld_cobertura_p10_p90, 0)})` : ""}. Armazenamento: erro médio de ${f(x.ear_mae_pp, 1)} p.p. na EAR do fim do mês, ${pct(x.ear_cobertura_p10_p90, 0)} dentro da faixa.`,
    });
  }
}
