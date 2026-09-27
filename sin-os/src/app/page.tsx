"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartFrame } from "@/components/EChart";
import {
  AssetsPanel,
  AuditorPanel,
  BessMini,
  buildKpis,
  DaySummary,
  earOption,
  EnaRow,
  fanOption,
  loadOption,
  OpportunitiesTable,
  pldMainOption,
  priceCurveOption,
  SinFlow,
  type Mode,
  type Range,
} from "@/components/home/panels";
import { Appear } from "@/components/motion";
import { Kpi, Panel, Segmented, SimBanner, SourceTag } from "@/components/ui";
import type { ArbitragemResp, AuditoriaResp, BessResp, BrasilResp, ClimaResp, PrevisaoResp } from "@/lib/apiTypes";
import { assetQuery, useAsset } from "@/lib/asset";
import { SUB_COLOR } from "@/lib/chart";
import { brl } from "@/lib/fmt";
import { buildOpportunities, pickDay } from "@/lib/market/opportunities";
import { brtDate, brtHour } from "@/lib/sources/time";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";
import { useNow } from "@/lib/useNow";

const RANGES: { value: Range; label: string }[] = [
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
];
const MODES: { value: Mode; label: string }[] = [
  { value: "real", label: "Real" },
  { value: "prev", label: "Previsão" },
];

const more = (href: string, label = "detalhes") => (
  <Link href={href} className="text-[11px] text-muted transition-colors hover:text-accent">
    {label} →
  </Link>
);

export default function Home() {
  const asset = useAsset();
  const now = useNow();
  const br = useApi<BrasilResp>("/api/brasil", 60_000);
  const arb = useApi<ArbitragemResp>("/api/arbitragem?sub=SE", 300_000);
  const audit = useApi<AuditoriaResp>("/api/auditoria", 60_000);
  const clima = useApi<ClimaResp>("/api/clima", 600_000);
  const bess = useApi<BessResp>(`/api/bess?${assetQuery(asset)}`, 900_000);
  const [range, setRange] = useState<Range>("7D");
  const [mode, setMode] = useState<Mode>("real");
  // previsão: SE sempre (resumo e leque); demais submercados só no modo previsão
  const fcSE = useApi<PrevisaoResp>("/api/previsao?sub=SE", 600_000);
  const fcS = useApi<PrevisaoResp>(mode === "prev" ? "/api/previsao?sub=S" : null, 600_000);
  const fcNE = useApi<PrevisaoResp>(mode === "prev" ? "/api/previsao?sub=NE" : null, 600_000);
  const fcN = useApi<PrevisaoResp>(mode === "prev" ? "/api/previsao?sub=N" : null, 600_000);
  const d = br.data;

  const kpis = useMemo(() => buildKpis(d, clima.data, audit.data, now || undefined), [d, clima.data, audit.data, now]);
  const forecasts = useMemo(() => ({ SE: fcSE.data, S: fcS.data, NE: fcNE.data, N: fcN.data }) as Partial<Record<Sub, PrevisaoResp>>, [fcSE.data, fcS.data, fcNE.data, fcN.data]);
  const mainOpt = useMemo(() => (d && now ? pldMainOption(d, range, mode, forecasts, now) : null), [d, range, mode, forecasts, now]);
  const curveOpt = useMemo(() => (d && now ? priceCurveOption(d, now) : null), [d, now]);
  const loadOpt = useMemo(() => (d ? loadOption(d) : null), [d]);
  const earOpt = useMemo(() => (d ? earOption(d) : null), [d]);
  const fanOpt = useMemo(() => (fcSE.data ? fanOption(fcSE.data) : null), [fcSE.data]);

  const opps = useMemo(() => {
    if (!d?.pld || !now) return [];
    const day = pickDay(d.pld.ts, d.pld.values, brtDate(now), brtDate, brtHour);
    const eu = arb.data?.eu[0];
    const lensEu = arb.data?.lens.find((l) => l.unit.includes("€") && l.localAvg > 0);
    const fx = lensEu ? lensEu.brlAvg / lensEu.localAvg : null;
    return buildOpportunities({
      day,
      floor: d.limits.min,
      asset: { pow: asset.pow, cap: asset.cap, rte: asset.rte, lcos: asset.lcos },
      spreads: arb.data?.spreads,
      intl: eu && fx ? { name: eu.name, bzn: eu.bzn, eurPerMWDay: eu.bessEurPerMWDay, spreadEur: eu.max - eu.min, fx, date: eu.date } : null,
    });
  }, [d, arb.data, asset, now]);
  const oppDay = d?.pld && now ? pickDay(d.pld.ts, d.pld.values, brtDate(now), brtDate, brtHour) : null;
  const fcLoading = mode === "prev" && (fcS.isLoading || fcNE.isLoading || fcN.isLoading);

  return (
    <div className="flex flex-col gap-3">
      <SimBanner metas={[d?.meta.pld, d?.meta.cmo, d?.meta.ear, d?.meta.ena, d?.meta.load]} />

      {/* 1 · KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 min-[1880px]:grid-cols-10">
        {kpis.map((k, i) => (
          <Appear key={k.key} delay={i * 0.025}>
            <Kpi {...k} />
          </Appear>
        ))}
      </div>

      {/* 2 · gráfico principal + resumo do dia */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-9"
          title="PLD horário por submercado"
          subtitle={
            d
              ? `${range === "30D" ? "Últimos 31 dias" : range === "7D" ? "Últimos 7 dias" : "Últimas 24 h"} + dia seguinte quando publicado · faixas: ponta 18–21h · linhas: preço atual · piso ${brl(d.limits.min)} · teto horário ${brl(d.limits.maxHourly)}`
              : "carregando…"
          }
          right={
            <>
              <Segmented label="Janela" value={range} options={RANGES} onChange={setRange} size="xs" />
              <Segmented label="Modo" value={mode} options={MODES} onChange={setMode} size="xs" />
              <SourceTag meta={d?.meta.pld} staleAfterMs={2 * 3600_000} />
            </>
          }
        >
          <ChartFrame option={mainOpt} loading={br.isLoading} error={br.error} onRetry={() => br.mutate()} height={340} label="PLD horário por submercado" dim={(br.isValidating && !!d) || fcLoading} />
        </Panel>
        <Panel className="xl:col-span-3" title="Resumo do dia" subtitle="gerado dos dados, sem texto fixo">
          <DaySummary br={d} fc={fcSE.data} audit={audit.data} now={now} />
        </Panel>
      </div>

      {/* 3 · oportunidades */}
      <Panel
        title="Oportunidades agora"
        subtitle={
          oppDay
            ? `Calculadas no PLD de ${oppDay.label} (${oppDay.date.split("-").reverse().slice(0, 2).join("/")}) para o ativo ${asset.pow} MW / ${asset.cap} MWh (η ${asset.rte}%). Margem bruta; verde = cobre o custo nivelado de R$ ${asset.lcos}/MWh, amarelo = não cobre.`
            : "aguardando um dia completo de PLD"
        }
        right={more("/arbitragem", "arbitragem")}
        bodyClassName="px-1 pb-1"
      >
        <OpportunitiesTable rows={opps} />
      </Panel>

      {/* 4 · painéis inferiores */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <Panel title="SIN Brasil · fluxo" subtitle="preço, carga e reservatório por submercado" right={more("/sin")}>
          <SinFlow br={d} now={now} />
        </Panel>
        <Panel title="Curva de preço" subtitle={d?.kpis?.some((k) => k.tomorrowAvg !== null) ? "R$/MWh · hoje (—) e amanhã publicado (- -)" : "R$/MWh · hoje, hora a hora"} right={more("/sin")}>
          <ChartFrame option={curveOpt} loading={br.isLoading} error={br.error} height={210} label="Curva do PLD de hoje e amanhã" />
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
            {SUBS.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: SUB_COLOR[s] }} aria-hidden />
                {s}
              </span>
            ))}
          </div>
        </Panel>
        <Panel title="BESS · energy arbitrage" subtitle="despacho ótimo (HiGHS) no PLD real" right={<SourceTag meta={bess.data?.meta} staleAfterMs={2 * 3600_000} />}>
          <BessMini bess={bess.data} asset={asset} loading={bess.isLoading} error={bess.error} />
        </Panel>
        <Panel title="Previsão de carga" subtitle="GW · SIN verificado (ONS) + ingênuo semanal 24 h" right={<SourceTag meta={d?.meta.load} staleAfterMs={6 * 3600_000} />}>
          <ChartFrame option={loadOpt} loading={br.isLoading} error={br.error} height={230} label="Carga do SIN e previsão ingênua" />
        </Panel>
        <Panel title="Reservatórios & afluências" subtitle="EAR (% da capacidade máx.) e ENA (% da MLT)" right={more("/clima")}>
          <ChartFrame option={earOpt} loading={br.isLoading} error={br.error} height={170} label="Energia armazenada por submercado" />
          <EnaRow br={d} />
        </Panel>
        <Panel title="Ativos & estratégias" subtitle="ativo selecionado e carteira (neste navegador)" right={more("/carteira", "carteira")}>
          <AssetsPanel asset={asset} bess={bess.data} now={now} />
        </Panel>
        <Panel title="Agente auditor" subtitle="saúde das APIs públicas" right={more("/auditoria", "auditor")}>
          <AuditorPanel audit={audit.data} />
        </Panel>
        <Panel title="Previsão PLD SE · 7 dias" subtitle={fcSE.data ? `LEAR ⊕ ingênuo · rMAE ${fcSE.data.backtest.rmae.toFixed(2).replace(".", ",")} · cobertura ${Math.round(100 * fcSE.data.backtest.aci.coverage)}%` : "calibrando modelos…"} right={more("/previsao", "modelos")}>
          <ChartFrame option={fanOpt} loading={fcSE.isLoading} error={fcSE.error} height={230} label="Leque de previsão do PLD SE" />
        </Panel>
      </div>
      <p className="px-1 text-[10.5px] text-muted">
        Fontes públicas (CCEE, ONS, Open-Meteo, BCB, Energy-Charts). Submercados {SUBS.join(" · ")}. Não é recomendação de investimento.
      </p>
    </div>
  );
}
