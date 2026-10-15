"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartFrame } from "@/components/EChart";
import {
  BessMini,
  buildKpis,
  DaySummary,
  earOption,
  EnaRow,
  fanOption,
  OpportunitiesTable,
  pldMainOption,
  SystemStats,
  type Mode,
  type Range,
} from "@/components/home/panels";
import { Appear } from "@/components/motion";
import { Kpi, PageHeader, Panel, Segmented, SimBanner } from "@/components/ui";
import type { ArbitragemResp, AuditoriaResp, BessResp, BrasilResp, ClimaResp, PrevisaoResp, RenovaveisResp, AlertasResp } from "@/lib/apiTypes";
import { assetQuery, useAsset } from "@/lib/asset";
import { buildOpportunities, pickDay } from "@/lib/market/opportunities";
import { brtDate, brtHour } from "@/lib/sources/time";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";
import { useNow } from "@/lib/useNow";

const RANGES: { value: Range; label: string }[] = [
  { value: "24H", label: "24 h" },
  { value: "7D", label: "7 dias" },
  { value: "30D", label: "30 dias" },
];
const MODES: { value: Mode; label: string }[] = [
  { value: "real", label: "Realizado" },
  { value: "prev", label: "Previsão" },
];

const more = (href: string, label = "Ver mais") => (
  <Link href={href} className="text-[13px] font-medium text-accent hover:underline">
    {label}
  </Link>
);

const today = (now: number) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" }).format(new Date(now));

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
  const renov = useApi<RenovaveisResp>("/api/renovaveis?dias=14", 30 * 60_000);
  const alertas = useApi<AlertasResp>("/api/alertas", 10 * 60_000);
  const d = br.data;

  const kpis = useMemo(() => buildKpis(d, clima.data, renov.data, now || undefined), [d, clima.data, renov.data, now]);
  const pldKpis = kpis.filter((k) => k.key.startsWith("pld-"));
  const systemKpis = kpis.filter((k) => !k.key.startsWith("pld-"));
  const forecasts = useMemo(() => ({ SE: fcSE.data, S: fcS.data, NE: fcNE.data, N: fcN.data }) as Partial<Record<Sub, PrevisaoResp>>, [fcSE.data, fcS.data, fcNE.data, fcN.data]);
  const mainOpt = useMemo(() => (d && now ? pldMainOption(d, range, mode, forecasts, now) : null), [d, range, mode, forecasts, now]);
  const earOpt = useMemo(() => (d ? earOption(d) : null), [d]);
  const fanOpt = useMemo(() => (fcSE.data ? fanOption(fcSE.data) : null), [fcSE.data]);

  const curtEvidence = useMemo(() => {
    const c = renov.data?.curtailment;
    if (!c || !c.days) return null;
    return Object.fromEntries(
      SUBS.map((s) => [s, { mwhPerDay: c.daily.reduce((a, x) => a + x.eolica[s] + x.solar[s], 0) / c.days, floorSharePct: renov.data!.vsPld?.find((v) => v.sub === s)?.sharePct ?? null, days: c.days }]),
    ) as Record<Sub, { mwhPerDay: number; floorSharePct: number | null; days: number }>;
  }, [renov.data]);
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
      curtailment: curtEvidence,
    });
  }, [d, arb.data, asset, now, curtEvidence]);
  const oppDay = d?.pld && now ? pickDay(d.pld.ts, d.pld.values, brtDate(now), brtDate, brtHour) : null;
  const shown = opps.filter((o) => o.margin === null || o.margin > 0);
  const hidden = opps.length - shown.length;
  const fcLoading = mode === "prev" && (fcS.isLoading || fcNE.isLoading || fcN.isLoading);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Sala de Comando" subtitle={now ? `PLD por submercado agora, ${today(now)}.` : "PLD por submercado agora."} />
      <SimBanner metas={[d?.meta.pld, d?.meta.cmo, d?.meta.ear, d?.meta.ena, d?.meta.load]} label="PLD" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {pldKpis.map(({ key, ...k }, i) => (
          <Appear key={key} delay={i * 0.03}>
            <Kpi {...k} />
          </Appear>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="PLD por hora"
          subtitle={range === "30D" ? "Últimos 31 dias" : range === "7D" ? "Últimos 7 dias e amanhã, quando publicado" : "Últimas 24 horas e amanhã, quando publicado"}
          right={
            <>
              <Segmented label="Janela" value={range} options={RANGES} onChange={setRange} size="xs" />
              <Segmented label="Modo" value={mode} options={MODES} onChange={setMode} size="xs" />
            </>
          }
        >
          <ChartFrame option={mainOpt} loading={br.isLoading} error={br.error} onRetry={() => br.mutate()} height={330} label="PLD horário por submercado" dim={(br.isValidating && !!d) || fcLoading} />
          <p className="mt-2 text-[12px] text-muted">Faixa amarela: horário de ponta (18h–21h). Pinça ou ctrl + rolagem para dar zoom.</p>
        </Panel>
        <Panel title="Hoje">
          <DaySummary br={d} fc={fcSE.data} audit={audit.data} alerts={alertas.data} now={now} />
        </Panel>
      </div>

      <Panel title="Sistema" subtitle="Operação, reservatórios e clima" right={more("/sin", "SIN · Brasil")}>
        <SystemStats items={systemKpis} />
      </Panel>

      <Panel
        title="Oportunidades"
        subtitle={oppDay ? `PLD de ${oppDay.label} para o ativo de ${asset.pow} MW / ${asset.cap} MWh. Verde cobre o custo nivelado; amarelo não cobre.` : "Aguardando um dia completo de PLD"}
        right={more("/arbitragem", "Arbitragem")}
        bodyClassName="px-2 pb-3 pt-1"
      >
        <OpportunitiesTable rows={shown} />
        {hidden > 0 ? <p className="px-3 pt-2 text-[12px] text-muted">{hidden === 1 ? "1 estratégia sem margem hoje não aparece." : `${hidden} estratégias sem margem hoje não aparecem.`}</p> : null}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Previsão SE · 7 dias" subtitle={fcSE.data ? `Erra ${Math.round(100 * Math.abs(1 - fcSE.data.backtest.rmae))}% ${fcSE.data.backtest.rmae <= 1 ? "menos" : "mais"} que o ingênuo em ${fcSE.data.backtest.days} dias` : "Calibrando modelos…"} right={more("/previsao", "Previsão")}>
          <ChartFrame option={fanOpt} loading={fcSE.isLoading} error={fcSE.error} height={210} label="Leque de previsão do PLD SE" />
        </Panel>
        <Panel title="Bateria" subtitle="Despacho ótimo no PLD real" right={more("/bess", "BESS")}>
          <BessMini bess={bess.data} asset={asset} loading={bess.isLoading} error={bess.error} />
        </Panel>
        <Panel title="Reservatórios" subtitle="% da capacidade máxima" right={more("/clima", "Clima")}>
          <ChartFrame option={earOpt} loading={br.isLoading} error={br.error} height={170} label="Energia armazenada por submercado" />
          <EnaRow br={d} />
        </Panel>
      </div>
      <p className="px-1 text-[12px] text-muted">Fontes públicas: CCEE, ONS, Open-Meteo, BCB e Energy-Charts. Não é recomendação de investimento.</p>
    </div>
  );
}
