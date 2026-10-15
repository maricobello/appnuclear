"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { SinFlow } from "@/components/home/panels";
import { Disclosure, ErrorBox, Loading, PageHeader, Panel, Segmented, SimBanner, Table } from "@/components/ui";
import { useNow } from "@/lib/useNow";
import type { BrasilResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { brl, dayLabel, num } from "@/lib/fmt";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));

function heatmap(d: BrasilResp, sub: Sub): ChartOption {
  const a = d.aggregates!;
  const rows = a.heat[sub];
  const data: [number, number, number | null][] = [];
  rows.forEach((r, di) => r.forEach((v, h) => data.push([h, di, v === null ? null : Math.round(v * 100) / 100])));
  const vals = data.map((x) => x[2]).filter((v): v is number => v !== null);
  return {
    ...baseOption(),
    tooltip: {
      ...baseOption().tooltip,
      trigger: "item",
      formatter: (p: { value: [number, number, number | null] }) => `${a.heatDates[p.value[1]]} · ${String(p.value[0]).padStart(2, "0")}h<br/><b>${brl(p.value[2])}</b>`,
    },
    grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
    xAxis: categoryAxis(Array.from({ length: 24 }, (_, h) => `${h}h`), { splitArea: { show: false } }),
    yAxis: categoryAxis(a.heatDates.map(dayLabel), { inverse: true }),
    visualMap: {
      min: Math.min(...vals),
      max: Math.max(...vals),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 160,
      itemWidth: 10,
      textStyle: { color: C.muted, fontSize: 10 },
      inRange: { color: C.seq },
      formatter: (v: number) => num(v, 0),
    },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: C.surface, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1 } } }],
  };
}

const dailyLines = (dates: string[], values: Record<Sub, (number | null)[]>, unit: string, fmt: (v: number) => string): ChartOption => ({
  ...baseOption(),
  tooltip: { ...baseOption().tooltip, valueFormatter: fmt },
  xAxis: timeAxis({ axisLabel: { color: C.muted, fontSize: 10, hideOverlap: true, formatter: (v: number) => new Date(v).toISOString().slice(5, 10).split("-").reverse().join("/") } }),
  yAxis: valueAxis(unit),
  series: SUBS.map((s) => line(s, dates.map((d, i) => [Date.parse(`${d}T12:00:00-03:00`), values[s][i]]), SUB_COLOR[s])),
});

export default function SinPage() {
  const { data, error, isValidating } = useApi<BrasilResp>("/api/brasil", 60_000);
  const now = useNow();
  const [sub, setSub] = useState<Sub>("SE");

  const heat = useMemo(() => (data?.aggregates ? heatmap(data, sub) : null), [data, sub]);
  const daily = useMemo(() => (data?.aggregates ? dailyLines(data.aggregates.dates, data.aggregates.daily, "R$/MWh", (v) => brl(v)) : null), [data]);
  const cmoVsPld = useMemo<ChartOption | null>(() => {
    if (!data?.cmo || !data.pld) return null;
    const from = data.cmo.ts[0];
    const pIdx = data.pld.ts.map((t, i) => [t, i] as const).filter(([t]) => t >= from);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
      xAxis: timeAxis(),
      yAxis: valueAxis("R$/MWh"),
      series: [
        line(`CMO ${sub} (ONS/DESSEM)`, data.cmo.ts.map((t, i) => [t, data.cmo!.values[sub][i]]), C.series[6]),
        line(`PLD ${sub} (CCEE)`, pIdx.map(([t, i]) => [t, data.pld!.values[sub][i]]), SUB_COLOR[sub]),
      ],
    };
  }, [data, sub]);
  const ear = useMemo(() => (data?.ear ? dailyLines(data.ear.dates, data.ear.values, "% EARmax", (v) => `${num(v, 1)}%`) : null), [data]);
  const ena = useMemo(() => (data?.ena ? dailyLines(data.ena.dates, data.ena.values, "% MLT", (v) => `${num(v, 0)}%`) : null), [data]);
  const load = useMemo<ChartOption | null>(() => {
    if (!data?.load) return null;
    const l = data.load;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 0)} MWmed` },
      xAxis: timeAxis(),
      yAxis: valueAxis("MWmed"),
      series: SUBS.map((s) => line(s, l.ts.map((t, i) => [t, l.values[s][i]]), SUB_COLOR[s])),
    };
  }, [data]);

  const lastDays = data?.aggregates ? data.aggregates.dates.slice(-8).map((d, i, arr) => ({ d, i: data.aggregates!.dates.length - arr.length + i })) : [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="SIN · Brasil"
        subtitle="Preço, operação e hidrologia dos quatro submercados."
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} />}
      />
      <SimBanner metas={[data?.meta.pld, data?.meta.cmo, data?.meta.ear, data?.meta.ena, data?.meta.load]} label="PLD" />
      {error && !data ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Agora" subtitle="Preço, carga e reservatório por submercado">
          <SinFlow br={data} now={now} />
        </Panel>
        <Panel className="xl:col-span-2" title="PLD médio diário" subtitle="Últimos 90 dias">
          {daily ? <EChart option={daily} height={260} label="PLD médio diário por submercado" /> : <Loading height={260} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`PLD ${sub} por dia e hora`} subtitle="Últimos 31 dias · mais claro = mais caro">
          {heat ? <EChart option={heat} height={520} label={`Mapa de calor do PLD ${sub}`} dim={isValidating} /> : <Loading height={520} />}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={`CMO × PLD — ${SUB_NAMES[sub]}`} subtitle="O PLD é o CMO do DESSEM limitado ao piso e ao teto">
            {cmoVsPld ? <EChart option={cmoVsPld} height={220} label="CMO versus PLD" /> : <Loading height={220} />}
          </Panel>
          <Panel title="Carga" subtitle="MWmed por hora · 7 dias">
            {load ? <EChart option={load} height={220} label="Carga horária por subsistema" /> : <Loading height={220} />}
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Reservatórios (EAR)" subtitle="% da capacidade máxima · 12 meses">
          {ear ? <EChart option={ear} height={240} label="EAR por subsistema" /> : <Loading />}
        </Panel>
        <Panel title="Afluências (ENA)" subtitle="% da média de longo termo · 12 meses">
          {ena ? <EChart option={ena} height={240} label="ENA por subsistema" /> : <Loading />}
        </Panel>
      </div>

      {data?.aggregates ? (
        <Disclosure title="Tabela de PLD médio diário" hint="R$/MWh · inclui amanhã quando publicado">
          <Panel title="PLD médio diário">
            <Table
              head={["Data", ...SUBS.map((s) => `${s}`), "Spread máx."]}
              stack={false}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={lastDays.reverse().map(({ d, i }) => {
                const v = SUBS.map((s) => data.aggregates!.daily[s][i]);
                const f = v.filter((x): x is number => x !== null);
                return [dayLabel(d), ...v.map((x) => num(x, 2)), f.length ? num(Math.max(...f) - Math.min(...f), 2) : "—"];
              })}
            />
          </Panel>
        </Disclosure>
      ) : null}
    </div>
  );
}
