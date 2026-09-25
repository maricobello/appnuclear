"use client";

import { useMemo } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { ErrorBox, Loading, PageHeader, Panel, SimBanner, SourceTag, Table } from "@/components/ui";
import type { ClimaResp } from "@/lib/apiTypes";
import { band, baseOption, C, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { num, pct } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";

export default function ClimaPage() {
  const { data, error } = useApi<ClimaResp>("/api/clima", 600_000);

  const wind = useMemo<ChartOption | null>(() => {
    const hubs = data?.hubs.filter((h) => h.role === "eólica");
    if (!hubs?.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => pct(100 * v, 0) },
      xAxis: timeAxis(),
      yAxis: valueAxis("fator de capacidade", { min: 0, max: 1, scale: false, axisLabel: { color: C.muted, fontSize: 10, formatter: (v: number) => `${v * 100}%` } }),
      series: hubs.map((h, i) => line(h.name, h.series.ts.map((t, k) => [t, h.series.windCf[k]]), C.series[i])),
    };
  }, [data]);

  const solar = useMemo<ChartOption | null>(() => {
    const h = data?.hubs.find((x) => x.role === "solar");
    if (!h) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => pct(100 * v, 0) },
      xAxis: timeAxis(),
      yAxis: valueAxis("fator de capacidade", { min: 0, max: 1, scale: false, axisLabel: { color: C.muted, fontSize: 10, formatter: (v: number) => `${v * 100}%` } }),
      series: [line(h.name, h.series.ts.map((t, k) => [t, h.series.solarCf[k]]), C.series[3], { areaStyle: { color: C.series[3], opacity: 0.1 } })],
    };
  }, [data]);

  const temp = useMemo<ChartOption | null>(() => {
    const hubs = data?.hubs.filter((h) => h.role === "carga");
    if (!hubs?.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 1)} °C` },
      xAxis: timeAxis(),
      yAxis: valueAxis("°C"),
      series: hubs.map((h) => line(`${h.name} (${h.sub})`, h.series.ts.map((t, k) => [t, h.series.temp[k]]), SUB_COLOR[h.sub])),
    };
  }, [data]);

  const basins = useMemo(
    () =>
      (data?.basins ?? []).map((b) => {
        const days = b.cumulative.map((c) => Date.now() + c.day * 86400_000);
        const opt: ChartOption = {
          ...baseOption(),
          legend: { show: false },
          grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
          tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 0)} mm` },
          xAxis: timeAxis({ axisLabel: { color: C.muted, fontSize: 10, hideOverlap: true, formatter: (v: number) => new Date(v).toISOString().slice(8, 10) + "/" + new Date(v).toISOString().slice(5, 7) } }),
          yAxis: valueAxis("mm", { min: 0, scale: false }),
          series: [
            ...band("P10–P90", days, b.cumulative.map((c) => c.p10), b.cumulative.map((c) => c.p90), SUB_COLOR[b.hub.sub], 0.18),
            line("Mediana (P50)", days.map((t, i) => [t, b.cumulative[i].p50]), SUB_COLOR[b.hub.sub]),
          ],
        };
        return { b, opt };
      }),
    [data],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clima & hidrologia"
        subtitle="Drivers físicos do preço: temperatura nos centros de carga, vento a 100 m nos polos eólicos do Nordeste, irradiância no polo solar de MG e chuva nas bacias (ensemble ECMWF de 51 membros → incerteza hidrológica)."
        right={<SourceTag meta={data?.meta.weather} label="Open-Meteo" />}
      />
      <SimBanner metas={[data?.meta.weather, data?.meta.ensemble]} />
      {error && !data ? <ErrorBox error={error} /> : null}

      <Panel title="Pontos monitorados — próximas 24 h" subtitle="Fator de capacidade por curva de potência genérica (IEC classe II) e PR 0,8 para FV · CDH = graus-hora acima de 24 °C">
        {data ? (
          <Table
            head={["Ponto", "Papel", "Submercado", "Temp. média", "Temp. máx.", "CDH", "Vento 100 m", "FC eólico", "FC solar", "Chuva"]}
            align={["left", "left", "center", "right", "right", "right", "right", "right", "right", "right"]}
            rows={data.hubs.map((h) => [
              h.name,
              h.role,
              h.sub,
              `${num(h.next24.tempAvg, 1)} °C`,
              `${num(h.next24.tempMax, 1)} °C`,
              num(h.next24.cdh, 0),
              `${num(h.next24.windAvg, 1)} m/s`,
              pct(100 * h.next24.windCf, 0),
              pct(100 * h.next24.solarCf, 0),
              `${num(h.next24.precip, 1)} mm`,
            ])}
          />
        ) : (
          <Loading height={200} />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Eólica — fator de capacidade (7 dias)" subtitle="Polos RN e BA">
          {wind ? <EChart option={wind} height={240} label="Fator de capacidade eólico" /> : <Loading />}
        </Panel>
        <Panel title="Solar — fator de capacidade (7 dias)" subtitle="Polo de Pirapora/MG">
          {solar ? <EChart option={solar} height={240} label="Fator de capacidade solar" /> : <Loading />}
        </Panel>
        <Panel title="Temperatura nos centros de carga" subtitle="7 dias · cor = submercado">
          {temp ? <EChart option={temp} height={240} label="Temperatura nos centros de carga" /> : <Loading />}
        </Panel>
      </div>

      <Panel title="Chuva acumulada nas bacias — ensemble ECMWF (15 dias)" subtitle="Faixa P10–P90 entre membros e mediana · mais chuva ⇒ mais ENA ⇒ pressão baixista no PLD" right={<SourceTag meta={data?.meta.ensemble} label="ECMWF" />}>
        {basins.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {basins.map(({ b, opt }) => (
              <div key={b.hub.id} className="rounded-md border border-line p-2">
                <div className="flex items-baseline justify-between px-1 text-xs">
                  <span className="text-ink-2">{b.hub.name}</span>
                  <span className="tnum text-muted">
                    P50 {num(b.p50, 0)} mm · [{num(b.p10, 0)}–{num(b.p90, 0)}]
                  </span>
                </div>
                <EChart option={opt} height={170} label={`Chuva acumulada ${b.hub.name}`} />
                <div className="px-1 text-[10px] text-muted">{b.members} membros · {b.horizonDays} dias</div>
              </div>
            ))}
          </div>
        ) : (
          <Loading height={200} />
        )}
      </Panel>
    </div>
  );
}
