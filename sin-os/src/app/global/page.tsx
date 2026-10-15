"use client";

import { useMemo } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, ErrorBox, Loading, PageHeader, Panel, SimBanner, Stat } from "@/components/ui";
import type { GlobalResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, timeAxis, tooltipTime, valueAxis } from "@/lib/chart";
import { num, pct } from "@/lib/fmt";
import { useApi } from "@/lib/useApi";

// cor segue a entidade: zonas fixas nas 4 primeiras posições da paleta
const FOCUS = [
  { bzn: "DE-LU", color: C.series[0] },
  { bzn: "FR", color: C.series[1] },
  { bzn: "ES", color: C.series[2] },
  { bzn: "NO2", color: C.series[3] },
];

const FUEL_PT: Record<string, string> = {
  wind: "Eólica", gas: "Gás", nuclear: "Nuclear", imports: "Importação", biomass: "Biomassa", solar: "Solar", hydro: "Hídrica", coal: "Carvão", other: "Outros",
};

export default function GlobalPage() {
  const { data: g, error, isValidating } = useApi<GlobalResp>("/api/global", 60_000);

  const heat = useMemo<ChartOption | null>(() => {
    if (!g?.eu) return null;
    const zones = Object.entries(g.eu);
    const allTs = [...new Set(zones.flatMap(([, z]) => z.ts))].sort((a, b) => a - b).slice(-72);
    const idx = new Map(allTs.map((t, i) => [t, i]));
    const data: [number, number, number][] = [];
    zones.forEach(([, z], zi) => z.ts.forEach((t, i) => { const x = idx.get(t); if (x !== undefined) data.push([x, zi, z.values[i]]); }));
    const vals = data.map((d) => d[2]);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "item", formatter: (p: { value: [number, number, number] }) => `${zones[p.value[1]][1].name} · ${tooltipTime(allTs[p.value[0]])}<br/><b>€ ${num(p.value[2], 2)}/MWh</b>` },
      grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
      xAxis: categoryAxis(allTs.map((t) => new Date(t).toISOString().slice(11, 13) + "h"), { axisLabel: { color: C.muted, fontSize: 10, interval: 5 } }),
      yAxis: categoryAxis(zones.map(([b]) => b)),
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
      },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: C.surface, borderWidth: 1 } }],
    };
  }, [g]);

  const lines = useMemo<ChartOption | null>(() => {
    if (!g?.eu) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `€ ${num(v, 2)}` },
      xAxis: timeAxis(),
      yAxis: valueAxis("EUR/MWh"),
      series: FOCUS.filter((f) => g.eu![f.bzn]).map((f) => line(`${g.eu![f.bzn].name} (${f.bzn})`, g.eu![f.bzn].ts.map((t, i) => [t, g.eu![f.bzn].values[i]]), f.color)),
    };
  }, [g]);

  const uk = useMemo<ChartOption | null>(() => {
    if (!g?.ukMid && !g?.ukSys) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `£ ${num(v, 2)}` },
      xAxis: timeAxis(),
      yAxis: valueAxis("GBP/MWh"),
      series: [
        ...(g.ukMid ? [line("Market Index (APX)", g.ukMid.ts.map((t, i) => [t, g.ukMid!.values[i]]), C.series[0])] : []),
        ...(g.ukSys ? [line("System Buy Price (desequilíbrio)", g.ukSys.ts.map((t, i) => [t, g.ukSys!.sbp[i]]), C.series[1])] : []),
      ],
    };
  }, [g]);

  const mix = useMemo<ChartOption | null>(() => {
    if (!g?.carbon?.mix.length) return null;
    const rows = [...g.carbon.mix].sort((a, b) => a.perc - b.perc);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${num(v, 1)}%` },
      grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
      xAxis: valueAxis(undefined, { scale: false, axisLabel: { show: false }, splitLine: { show: false } }),
      yAxis: categoryAxis(rows.map((r) => FUEL_PT[r.fuel] ?? r.fuel)),
      series: [{ name: "Participação", type: "bar", barMaxWidth: 14, itemStyle: { color: C.series[0], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: C.ink2, fontSize: 10, formatter: "{c}%" }, data: rows.map((r) => r.perc) }],
    };
  }, [g]);

  const eia = (s: { ts: number[]; values: number[] } | null, name: string, unit: string, color: string): ChartOption | null =>
    s ? { ...baseOption(), tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 2)} ${unit}` }, xAxis: timeAxis({ axisLabel: { color: C.muted, fontSize: 10, hideOverlap: true, formatter: (v: number) => new Date(v).toISOString().slice(5, 10) } }), yAxis: valueAxis(unit), series: [line(name, s.ts.map((t, i) => [t, s.values[i]]), color)] } : null;

  const fx = g?.fx;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mercados globais" subtitle="Europa, Reino Unido, câmbio e combustíveis, para comparar custo marginal e spreads." />
      <SimBanner metas={[g?.meta.eu, g?.meta.ukMid, g?.meta.ukSys, g?.meta.carbon, g?.meta.fx]} label="Energy-Charts" />
      {error && !g ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["USD", "EUR", "GBP"] as const).map((c) => (
          <Stat key={c} label={`${c}/BRL`} value={num(fx?.[c].rate, 4)} hint={fx ? `ref. ${fx[c].date}` : undefined} spark={fx?.[c].history.map((h) => h.rate)} sparkColor={C.series[0]} />
        ))}
        <Stat
          label="Carbono no Reino Unido"
          value={num(g?.carbon?.actual ?? g?.carbon?.forecast, 0)}
          unit="gCO₂/kWh"
          hint={g?.carbon ? `índice: ${g.carbon.index}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Europa por zona e hora" subtitle={`Últimas 72 h (UTC), inclui o dia seguinte após o leilão das 12h CET · resolução ${g?.euResolutionMin ?? "—"} min`}>
          {heat ? <EChart option={heat} height={380} label="Mapa de calor de preços europeus" dim={isValidating} /> : <Loading height={380} />}
        </Panel>
        <Panel title="Europa — zonas de referência" subtitle="€/MWh por hora · preço negativo é legítimo">
          {lines ? <EChart option={lines} height={380} label="Preços europeus por zona" /> : <Loading height={380} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Reino Unido" subtitle="Preço de referência e de desequilíbrio a cada 30 min">
          {uk ? <EChart option={uk} height={260} label="Preços do Reino Unido" /> : <Loading height={260} />}
        </Panel>
        <Panel title="Geração no Reino Unido agora" subtitle="% por fonte">
          {mix ? <EChart option={mix} height={260} label="Mix de geração britânico" /> : <Loading height={260} />}
        </Panel>
      </div>

      <Panel title="Combustíveis" subtitle="Henry Hub e Brent, que formam o custo das térmicas" right={g?.meta.eia.ok ? null : <Badge level="neutral">opcional · EIA_API_KEY</Badge>}>
        {g?.eia ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {eia(g.eia.henryHub, "Henry Hub", "US$/MMBtu", C.series[0]) ? <EChart option={eia(g.eia.henryHub, "Henry Hub", "US$/MMBtu", C.series[0])!} height={200} label="Henry Hub" /> : null}
            {eia(g.eia.brent, "Brent", "US$/bbl", C.series[0]) ? <EChart option={eia(g.eia.brent, "Brent", "US$/bbl", C.series[0])!} height={200} label="Brent" /> : null}
          </div>
        ) : (
          <p className="text-[13px] text-muted">
            Integração opcional. Cadastre-se em eia.gov/opendata (gratuito), adicione <code className="text-ink-2">EIA_API_KEY</code> nas variáveis de ambiente da Vercel e faça redeploy. {g?.meta.eia.error ? `(${g.meta.eia.error})` : ""}
          </p>
        )}
        {fx ? <p className="mt-3 text-[12px] text-muted">Triangulação: EUR/USD implícito {num(fx.EUR.rate / fx.USD.rate, 4)} · GBP/USD {num(fx.GBP.rate / fx.USD.rate, 4)} · variação USD 20 dias {pct(100 * (fx.USD.rate / fx.USD.history[0].rate - 1), 2)}</p> : null}
      </Panel>
    </div>
  );
}
