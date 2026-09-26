"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, ErrorBox, Loading, PageHeader, Panel, Segmented, SimBanner, SourceTag, Stat, Table } from "@/components/ui";
import type { ArbitragemResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { brl, compact, num, pct, signed } from "@/lib/fmt";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));

function NumberField({ label, value, onChange, step, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; suffix: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tnum w-20 rounded border border-line bg-surface px-2 py-1 text-ink focus:border-accent focus:outline-none"
      />
      <span>{suffix}</span>
    </label>
  );
}

export default function ArbitragemPage() {
  const [sub, setSub] = useState<Sub>("SE");
  const [pow, setPow] = useState(30);
  const [cap, setCap] = useState(120);
  const [rte, setRte] = useState(88);
  const [deg, setDeg] = useState(20);
  const [applied, setApplied] = useState({ pow: 30, cap: 120, rte: 88, deg: 20 });
  const url = `/api/arbitragem?sub=${sub}&pow=${applied.pow}&cap=${applied.cap}&rte=${applied.rte / 100}&deg=${applied.deg}`;
  const { data: a, error, isValidating } = useApi<ArbitragemResp>(url, 300_000);
  const [pair, setPair] = useState(0);

  const priceOpt = useMemo<ChartOption | null>(() => {
    if (!a) return null;
    const s = a.bess.schedule;
    return {
      ...baseOption(),
      grid: { left: 8, right: 16, top: 24, bottom: 0, containLabel: true },
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
      xAxis: timeAxis({ axisLabel: { show: false } }),
      yAxis: valueAxis("PLD previsto R$/MWh"),
      series: [line("PLD previsto (LEAR)", s.map((x) => [x.ts, x.price]), SUB_COLOR[a.sub])],
    };
  }, [a]);

  const dispatchOpt = useMemo<ChartOption | null>(() => {
    if (!a) return null;
    const s = a.bess.schedule;
    return {
      ...baseOption(),
      legend: { ...baseOption().legend, data: ["Descarga (injeta)", "Carga (consome)"] },
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${num(v, 1)} MW` },
      xAxis: timeAxis(),
      yAxis: valueAxis("MW", { scale: false }),
      series: [
        { name: "Descarga (injeta)", type: "bar", stack: "d", barMaxWidth: 10, itemStyle: { color: C.series[2], borderRadius: [2, 2, 0, 0] }, data: s.map((x) => [x.ts, x.mw > 0 ? Math.round(x.mw * 10) / 10 : 0]) },
        { name: "Carga (consome)", type: "bar", stack: "d", barMaxWidth: 10, itemStyle: { color: C.series[1], borderRadius: [0, 0, 2, 2] }, data: s.map((x) => [x.ts, x.mw < 0 ? Math.round(x.mw * 10) / 10 : 0]) },
      ],
    };
  }, [a]);

  const socOpt = useMemo<ChartOption | null>(() => {
    if (!a) return null;
    return {
      ...baseOption(),
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => `${num(v, 0)}%` },
      xAxis: timeAxis(),
      yAxis: valueAxis("SoC %", { min: 0, max: 100, scale: false }),
      series: [line("Estado de carga", a.bess.schedule.map((x) => [x.ts, Math.round(x.soc * 1000) / 10]), C.series[6], { areaStyle: { color: C.series[6], opacity: 0.1 } })],
    };
  }, [a]);

  const histOpt = useMemo<ChartOption | null>(() => {
    if (!a || !a.bess.pnlHistogram.length) return null;
    const h = a.bess.pnlHistogram;
    const var95 = -a.bess.risk.var95;
    return {
      ...baseOption(),
      grid: { left: 8, right: 16, top: 30, bottom: 26, containLabel: true },
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, formatter: (p: { dataIndex: number }[]) => { const b = h[p[0].dataIndex]; return `${brl(b.from, 0)} a ${brl(b.to, 0)}<br/><b>${b.count}</b> trajetórias`; } },
      xAxis: categoryAxis(h.map((b) => compact((b.from + b.to) / 2)), { name: "P&L 7 dias (R$)", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: C.muted, fontSize: 10 } }),
      yAxis: valueAxis("trajetórias", { scale: false }),
      series: [
        {
          name: "P&L LSMC",
          type: "bar",
          barCategoryGap: "8%",
          itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] },
          data: h.map((b) => ({ value: b.count, itemStyle: b.to <= var95 ? { color: C.critical, borderRadius: [4, 4, 0, 0] } : undefined })),
        },
      ],
    };
  }, [a]);

  const spreadOpt = useMemo<ChartOption | null>(() => {
    const s = a?.spreads[pair];
    if (!s || !s.series.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
      xAxis: timeAxis(),
      yAxis: valueAxis("R$/MWh"),
      series: [line(`Spread ${s.a} − ${s.b}`, s.series.map((v, i) => [s.seriesTs[i], v]), C.series[0], {
        markLine: { symbol: "none", silent: true, lineStyle: { color: C.muted, width: 1, type: "solid" }, label: { color: C.muted, fontSize: 10 }, data: [{ yAxis: Math.round(s.mean * 100) / 100, name: "média 30d" }] },
      })],
    };
  }, [a, pair]);

  const lensOpt = useMemo<ChartOption | null>(() => {
    if (!a?.lens.length) return null;
    const rows = [...a.lens].sort((x, y) => x.brlAvg - y.brlAvg);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => brl(v) },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: valueAxis("R$/MWh", { scale: false }),
      yAxis: categoryAxis(rows.map((r) => r.market)),
      series: [
        {
          name: "Preço médio do dia",
          type: "bar",
          barMaxWidth: 16,
          itemStyle: { color: C.series[0], borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: C.ink2, fontSize: 10, formatter: (p: { value: number }) => num(p.value, 0) },
          data: rows.map((r) => Math.round(r.brlAvg * 100) / 100),
        },
      ],
    };
  }, [a]);

  const b = a?.bess;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Arbitragem"
        subtitle="Temporal (armazenamento: LP exato + Least-Squares Monte Carlo), espacial (spreads entre submercados) e europeia. Métricas de decisão/risco, não P&L transacionável."
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} />}
      />
      <SimBanner metas={[a?.meta.pld, a?.meta.eu, a?.meta.fx]} />
      <div role="note" className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[11px] text-muted">
        <span aria-hidden>ℹ️</span>
        <span>
          <strong className="text-ink-2">Como ler estes números.</strong> No SIN não existe mercado spot contínuo onde se compre/venda no PLD à vontade
          (a liquidação é ex-post, mensal, sobre a exposição líquida). O valor de bateria em R$/MW·dia é um <strong>teto prospectivo</strong> do
          potencial de arbitragem — não P&L realizável hoje — e não inclui encargos, TUST/TUSD nem tributos. Receita real de BESS vem de leilão de
          reserva de capacidade, serviços ancilares ou behind-the-meter. O spread entre submercados é <strong>indicador de risco</strong> (não há FTR no SIN);
          “reversão esperada” é leitura estatística, não uma operação executável.
        </span>
      </div>
      {error && !a ? <ErrorBox error={error} /> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <span className="text-xs font-medium text-ink-2">Ativo de armazenamento</span>
        <NumberField label="Potência" value={pow} onChange={setPow} step={5} min={1} max={2000} suffix="MW" />
        <NumberField label="Energia" value={cap} onChange={setCap} step={10} min={1} max={5000} suffix="MWh" />
        <NumberField label="Eficiência ida-volta" value={rte} onChange={setRte} step={1} min={50} max={99} suffix="%" />
        <NumberField label="Degradação" value={deg} onChange={setDeg} step={5} min={0} max={500} suffix="R$/MWh" />
        <button
          onClick={() => setApplied({ pow, cap, rte, deg })}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20"
        >
          Recalcular
        </button>
        <span className="text-[11px] text-muted">duração {num(cap / Math.max(pow, 1), 1)} h</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Valor com opcionalidade (7 dias)" value={brl(b?.lsmcRS, 0)} hint={b ? `intrínseco + LSMC · ± ${brl(1.96 * b.lsmcStdErr, 0)} (IC 95%)` : undefined} />
        <Stat label="Intrínseco (LP exato, curva média)" value={brl(b?.intrinsicRS, 0)} hint={b?.solver} />
        <Stat label="Opcionalidade (extrínseco)" value={brl(b?.extrinsicRS, 0)} delta={b && b.intrinsicRS ? `${signed((100 * b.extrinsicRS) / Math.abs(b.intrinsicRS), 0)}% sobre o intrínseco` : null} />
        <Stat label="Informação perfeita (teto)" value={brl(b?.perfectForesightRS, 0)} hint="LP exato por trajetória · limite superior" />
        <Stat label="Receita por MW·dia" value={brl(b?.perMWDayRS, 0)} />
        <Stat
          label="P&L médio no pior 5% (CVaR 95%)"
          value={brl(b ? -b.risk.cvar95 : null, 0)}
          deltaGood={b ? -b.risk.cvar95 >= 0 : null}
          delta={b ? (-b.risk.cvar95 >= 0 ? "lucro mesmo na cauda" : "perda esperada na cauda") : null}
          hint={b ? `P(perda) ${pct(100 * b.risk.probLoss, 1)} · Ω ${Number.isFinite(b.risk.omega) ? num(b.risk.omega, 2) : "∞"}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Despacho ótimo — próximas 72 h" subtitle="Preço previsto, potência na rede e estado de carga (gráficos separados, mesmo eixo de tempo)" right={<SourceTag meta={a?.meta.pld} label="PLD" />}>
          {priceOpt && dispatchOpt && socOpt ? (
            <div className="flex flex-col gap-1">
              <EChart option={priceOpt} height={150} label="PLD previsto" dim={isValidating} />
              <EChart option={dispatchOpt} height={170} label="Despacho da bateria" dim={isValidating} />
              <EChart option={socOpt} height={130} label="Estado de carga" dim={isValidating} />
            </div>
          ) : (
            <Loading height={450} />
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Distribuição de P&L" subtitle="1.000 trajetórias MRJD (500 treino / 500 avaliação) · barras vermelhas = cauda VaR 95%">
            {histOpt ? <EChart option={histOpt} height={220} label="Distribuição de P&L" /> : <Loading height={220} />}
            {b ? <p className="mt-2 text-[11px] text-muted">P05 {brl(b.risk.p05, 0)} · mediana {brl(b.risk.p50, 0)} · P95 {brl(b.risk.p95, 0)} · média na cauda 5% {brl(-b.risk.cvar95, 0)}</p> : null}
          </Panel>
          <Panel title="D+1 já publicado" subtitle="Despacho exato no preço conhecido; energia que sobra no fim do dia valorizada pela previsão dos dias seguintes">
            {b?.publishedTomorrow ? (
              <div className="flex flex-col gap-1 text-xs">
                <div className="text-2xl font-semibold text-ink">{brl(b.publishedTomorrow.valueRS, 0)}</div>
                <div className="text-muted">
                  {b.publishedTomorrow.date} · caixa do dia {brl(b.publishedTomorrow.cashRS, 0)} · SoC final {pct(100 * b.publishedTomorrow.endSoc, 0)} · spread intradiário {brl(b.publishedTomorrow.spreadRS, 0)}/MWh
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">O PLD de amanhã ainda não foi divulgado pela CCEE (normalmente sai à tarde).</p>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Spreads entre submercados (30 dias)" subtitle="Risco de descolamento entre submercados (não é arbitragem: não há FTR no SIN). z-score, % de horas descoladas, ADF, Engle–Granger e meia-vida (OU)">
          {a ? (
            <Table
              head={["Par", "Atual", "z", "Descolado", "Meia-vida", "ADF p", "Coint.", "Sinal"]}
              align={["left", "right", "right", "right", "right", "right", "center", "left"]}
              rows={a.spreads.map((s, i) => [
                <button key="p" onClick={() => setPair(i)} className={`underline-offset-2 hover:underline ${pair === i ? "text-accent" : "text-ink-2"}`}>{`${s.a}−${s.b}`}</button>,
                brl(s.current, 2),
                num(s.z, 2),
                pct(s.decoupledPct, 0),
                s.halfLifeH !== null ? `${num(s.halfLifeH, 1)} h` : "—",
                num(s.adfP, 3),
                s.cointegrated === null ? "—" : s.cointegrated ? "sim" : "não",
                <Badge key="s" level={s.signal.startsWith("Spread alto") || s.signal.startsWith("Spread baixo") ? "warning" : s.signal === "Acoplados" ? "good" : "neutral"}>{s.signal}</Badge>,
              ])}
            />
          ) : (
            <Loading height={200} />
          )}
          <div className="mt-3">{spreadOpt ? <EChart option={spreadOpt} height={180} label="Série do spread selecionado" /> : null}</div>
        </Panel>
        <Panel title="Lente global — preço médio do dia em R$/MWh" subtitle="Conversão pelo câmbio do BCB. Indicativo: não há interconexão física entre os mercados." right={<SourceTag meta={a?.meta.fx} label="BCB" />}>
          {lensOpt ? <EChart option={lensOpt} height={360} label="Comparação global de preços" /> : <Loading height={360} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Europa — bateria 1 MW / 2 MWh por zona" subtitle="Receita intrínseca ótima no último dia de entrega disponível (resolução nativa)" right={<SourceTag meta={a?.meta.eu} label="Energy-Charts" />}>
          {a ? (
            <Table
              head={["Zona", "Entrega", "Média", "Mín", "Máx", "h negativas", "€/MW·dia"]}
              align={["left", "left", "right", "right", "right", "right", "right"]}
              rows={a.eu.map((z) => [`${z.name} (${z.bzn})`, z.date, num(z.avg, 1), num(z.min, 1), num(z.max, 1), num(z.negativeHours, 2), <strong key="v" className="text-ink">{num(z.bessEurPerMWDay, 1)}</strong>])}
            />
          ) : (
            <Loading height={200} />
          )}
        </Panel>
        <Panel title="Europa — valor de congestionamento (FTR intrínseco)" subtitle="Σ max(spread, 0)·Δt por direção — valor de 1 MW de direito de transmissão">
          {a ? (
            <Table
              head={["Fronteira", "Entrega", "Spread médio", "→ €/MW·dia", "← €/MW·dia", "Congestionado"]}
              align={["left", "left", "right", "right", "right", "right"]}
              rows={a.borders.map((x) => [`${x.from} ⇄ ${x.to}`, x.date, signed(x.avgSpread, 2), num(x.ftrFromTo, 1), num(x.ftrToFrom, 1), pct(x.congestedPct, 0)])}
            />
          ) : (
            <Loading height={200} />
          )}
        </Panel>
      </div>
    </div>
  );
}
