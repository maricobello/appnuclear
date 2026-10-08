"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Empty, ErrorBox, Kpi, Loading, MetricRow, PageHeader, Panel, Segmented, SimBanner, SourceTag, sourceState, Table } from "@/components/ui";
import type { RenovaveisResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, SUB_COLOR, valueAxis } from "@/lib/chart";
import { brl, dayLabel, num } from "@/lib/fmt";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

type Area = Sub | "SIN";
type TechSel = "total" | "eolica" | "solar";
type DailyCut = NonNullable<RenovaveisResp["curtailment"]>["daily"][number];
const AREA_OPTS = (["SIN", ...SUBS] as Area[]).map((s) => ({ value: s, label: s }));
const TECH_OPTS: { value: TechSel; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "eolica", label: "Eólica" },
  { value: "solar", label: "Solar" },
];
const DAYS_OPTS = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "28", label: "28d" },
];
const HOURS = Array.from({ length: 24 }, (_, h) => `${h}h`);
// o ONS publica D−1: acima de ~54 h sem dado novo o painel fica STALE
const STALE_MS = 54 * 3600_000;
const gwh = (mwh: number) => mwh / 1000;

export default function RenovaveisPage() {
  const [days, setDays] = useState("14");
  const [area, setArea] = useState<Area>("NE");
  const [tech, setTech] = useState<TechSel>("total");
  const { data, error, isValidating, mutate } = useApi<RenovaveisResp>(`/api/renovaveis?dias=${days}`, 15 * 60_000);
  const c = data?.curtailment ?? null;
  const n = data?.netLoad ?? null;
  const pldProfile = data?.pldProfile ?? null;
  const pldOfficial = data?.pldOfficial ?? false;
  const state = sourceState(data?.meta.curtailment, STALE_MS);

  const daily = useMemo<ChartOption | null>(() => {
    if (!c?.daily.length) return null;
    const pick = (d: DailyCut, s: Sub) => (tech === "eolica" ? d.eolica[s] : tech === "solar" ? d.solar[s] : d.eolica[s] + d.solar[s]);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${num(v, 1)} GWh` },
      xAxis: categoryAxis(c.daily.map((d) => dayLabel(d.date))),
      yAxis: valueAxis("GWh/dia", { scale: false }),
      series: SUBS.map((s) => ({ name: s, type: "bar", stack: "corte", barMaxWidth: 28, itemStyle: { color: SUB_COLOR[s] }, data: c.daily.map((d) => Math.round(gwh(pick(d, s)) * 100) / 100) })),
    };
  }, [c, tech]);

  const hourly = useMemo<ChartOption | null>(() => {
    if (!c) return null;
    const subs = area === "SIN" ? [...SUBS] : [area];
    const mwh = HOURS.map((_, h) => subs.reduce((a, s) => a + c.hourlyProfile[s][h], 0));
    const pld = area !== "SIN" && pldProfile ? pldProfile[area] : null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" } },
      grid: { ...baseOption().grid, right: 8 },
      xAxis: categoryAxis(HOURS),
      yAxis: [valueAxis("MWh cortado/dia", { scale: false }), valueAxis("R$/MWh", { scale: false, splitLine: { show: false }, position: "right", nameTextStyle: { color: C.muted, fontSize: 10, align: "right" } })],
      series: [
        { name: `Corte médio ${area}`, type: "bar", barMaxWidth: 16, itemStyle: { color: area === "SIN" ? C.accent : SUB_COLOR[area] }, data: mwh.map((v) => Math.round(v)), tooltip: { valueFormatter: (v: number) => `${num(v, 0)} MWh` } },
        ...(pld ? [{ ...line(`PLD médio ${area}${pldOfficial ? "" : " (estimado)"}`, [], C.warning), data: pld, yAxisIndex: 1, tooltip: { valueFormatter: (v: number) => brl(v) } }] : []),
      ],
    };
  }, [c, area, pldProfile, pldOfficial]);

  const duck = useMemo<ChartOption | null>(() => {
    if (!n) return null;
    const p = n.profile[area];
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 0)} MWmed` },
      xAxis: categoryAxis(HOURS, { boundaryGap: false }),
      yAxis: valueAxis("MWmed"),
      series: [
        { ...line(`Carga ${area}`, [], C.ink2), data: p.carga },
        { ...line(`Carga líquida ${area} (− eólica − solar)`, [], C.accent2, { areaStyle: { color: C.accent2, opacity: 0.08 } }), data: p.liquida },
      ],
    };
  }, [n, area]);

  const totalMWh = c ? c.totals.eolicaMWh + c.totals.solarMWh : null;
  const value = data?.vsPld ? data.vsPld.reduce((a, x) => a + x.valueBRL, 0) : null;
  const ne = data?.vsPld?.find((x) => x.sub === "NE") ?? null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Renováveis · corte e carga líquida"
        subtitle="Energia eólica e solar que o ONS mandou não gerar (constrained-off), por que e quando — cruzada com o PLD da mesma hora e com a curva do pato. Dados abertos do ONS, dias fechados."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Janela" value={days} options={DAYS_OPTS} onChange={setDays} />
            <Segmented label="Área" value={area} options={AREA_OPTS} onChange={setArea} />
          </div>
        }
      />
      <SimBanner metas={[data?.meta.curtailment, data?.meta.balanco, data?.meta.pld]} />
      {error && !data ? <ErrorBox error={error} onRetry={() => mutate()} /> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Eólica cortada" value={c ? gwh(c.totals.eolicaMWh) : null} format={(v) => num(v, 0)} unit={`GWh · ${num(c?.curtailedSharePct.eolica, 1)}%`} state={state} at={data?.meta.curtailment.latestTs} source={c ? `% do potencial · ${dayLabel(c.from!)}–${dayLabel(c.to!)}` : undefined} />
        <Kpi label="Solar cortada" value={c ? gwh(c.totals.solarMWh) : null} format={(v) => num(v, 0)} unit={`GWh · ${num(c?.curtailedSharePct.solar, 1)}%`} state={state} at={data?.meta.curtailment.latestTs} source="% do potencial · ONS" />
        <Kpi label="Corte total" value={totalMWh !== null ? gwh(totalMWh) : null} format={(v) => num(v, 0)} unit={c ? `GWh · piso ${num(gwh(c.totals.cappedMWh), 0)}` : "GWh"} state={state} source="oficial · piso = limitado à disponibilidade" detail="Piso: referência limitada à disponibilidade do conjunto. Teto: geração não realizada apurada do ONS." />
        <Kpi label="Valor a PLD" value={value !== null ? value / 1e6 : null} format={(v) => num(v, 1)} unit="R$ mi" state={sourceState(data?.meta.pld)} source={data?.pldOfficial ? "PLD oficial" : "PLD estimado pelo CMO em parte"} />
        <Kpi label="PLD no piso · NE" value={ne?.sharePct ?? null} format={(v) => num(v, 0)} unit={`% de ${ne?.hours ?? 0} h`} state={sourceState(data?.meta.pld)} source={`horas com corte · piso ${brl(data?.pldFloor)}`} />
        <Kpi label="Rampa da noite" value={n?.eveningRampMW != null ? n.eveningRampMW / 1000 : null} format={(v) => num(v, 1)} unit="GW em 3 h" state={sourceState(data?.meta.balanco, STALE_MS)} at={data?.meta.balanco.latestTs} source={`SIN · mínimo da carga líquida às ${n?.minHour ?? "—"}h`} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Corte por dia e submercado" subtitle="GWh · geração não realizada apurada (oficial)" right={<Segmented label="Fonte" value={tech} options={TECH_OPTS} onChange={setTech} />}>
          {daily ? <EChart option={daily} height={280} label="Corte diário por submercado" dim={isValidating} /> : data ? <Empty label="Sem corte registrado na janela." height={280} /> : <Loading height={280} />}
        </Panel>
        <Panel title={`Em que hora sobra energia — ${area === "SIN" ? "SIN" : SUB_NAMES[area]}`} subtitle="Corte médio por hora do dia (barras) × PLD médio na mesma hora (linha)" right={<SourceTag meta={data?.meta.pld} label="PLD" />}>
          {hourly ? <EChart option={hourly} height={280} label="Perfil horário do corte versus PLD" dim={isValidating} /> : <Loading height={280} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={`Curva do pato — ${area}`} subtitle="Perfil médio por hora: carga e carga líquida (carga − eólica − solar). A rampa da noite é o que térmicas, hidrelétricas e baterias precisam cobrir." right={<SourceTag meta={data?.meta.balanco} label="ONS" staleAfterMs={STALE_MS} />}>
          {duck ? <EChart option={duck} height={280} label="Carga e carga líquida por hora" dim={isValidating} /> : <Loading height={280} />}
        </Panel>
        <Panel title="Por que cortou" subtitle="Razão declarada pelo ONS (MWh)">
          {c ? (
            <div className="flex flex-col">
              {(["ENE", "CNF", "REL"] as const).map((r) => (
                <MetricRow key={r} label={data!.reasonLabel[r]} hint={r} value={`${num(gwh(c.totals.byReason[r]), 1)} GWh`} />
              ))}
              <MetricRow label="Participação de eólica + solar na carga" value={`${num(n?.renewableSharePct, 1)}%`} tone="muted" />
            </div>
          ) : (
            <Loading height={140} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Corte × PLD por submercado" subtitle={`Horas com ≥ 50 MWh cortados · PLD no piso (${brl(data?.pldFloor)}) = energia sobrando · valor = MWh cortado × PLD da hora`}>
          {data?.vsPld ? (
            <Table
              head={["Submercado", "Horas com corte", "PLD no piso", "MWh cortado", "PLD médio no corte", "Valor a PLD"]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={data.vsPld.map((x) => [SUB_NAMES[x.sub], num(x.hours), x.sharePct === null ? "—" : `${num(x.sharePct, 0)}%`, num(x.mwhPriced), brl(x.avgPld), brl(x.valueBRL, 0)])}
            />
          ) : data ? (
            <Empty label="PLD indisponível para cruzar com o corte." />
          ) : (
            <Loading height={140} />
          )}
        </Panel>
        <Panel title="Qualidade dos dados" subtitle="Checagens feitas a cada leitura">
          {c ? (
            <div className="flex flex-col">
              <MetricRow label="Meias horas com restrição" value={num(c.quality.restrictedIntervals)} />
              <MetricRow label="Referência acima da disponibilidade" value={num(c.quality.refAboveAvailIntervals)} hint={`${num(c.quality.inflatedSharePct, 1)}% do MWh`} tone={c.quality.inflatedSharePct > 5 ? "warning" : undefined} />
              <MetricRow label="Método da apurada (erro médio)" value={c.quality.methodMAE === null ? "—" : `${num(c.quality.methodMAE, 2)} MW`} tone={c.quality.methodMAE !== null && c.quality.methodMAE < 1 ? "good" : "warning"} />
              <MetricRow label="Convenção de hora (início da meia hora)" value={data?.hourCheck ? (data.hourCheck.ok ? "validada" : "divergente") : "—"} tone={data?.hourCheck?.ok ? "good" : "warning"} />
              <MetricRow label="Balanço fecha (horas)" value={n ? `${num(n.quality.hours - n.quality.identityBreaks)}/${num(n.quality.hours)}` : "—"} tone={n && n.quality.identityBreaks === 0 ? "good" : "warning"} />
            </div>
          ) : (
            <Loading height={140} />
          )}
        </Panel>
      </div>

      {data?.notes.length ? (
        <Panel title="Como ler estes números" subtitle="Lições das bases do ONS, verificadas nos dados desta janela">
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12px] leading-relaxed text-ink-2">
            {data.notes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
