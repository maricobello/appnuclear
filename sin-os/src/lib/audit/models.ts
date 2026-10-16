import type { BessDay } from "../market/bess-study";
import type { ForecastResult } from "../market/forecast";
import type { RegimeBacktestResult } from "../market/regime-backtest";
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
  trackRecord: { sub: Sub; days: number; from: string | null; to: string | null }[];
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
}

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

  const counts = { pass: 0, warn: 0, fail: 0 } as Record<ModelCheckStatus, number>;
  for (const c of checks) counts[c.status]++;
  const n = checks.length || 1;
  const score = Math.round((100 * (counts.pass + 0.5 * counts.warn)) / n);
  const trackRecord = SUBS.map((sub) => {
    const t = x.trackRecords?.[sub];
    return { sub, days: t?.days ?? 0, from: t?.from ?? null, to: t?.to ?? null };
  });
  return { generatedAt: x.now, score, counts, checks, dataNote: x.pldSource, trackRecord, trackMinDays: TRACK_MIN_DAYS };
}
