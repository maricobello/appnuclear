"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Button, Disclosure, ErrorBox, Loading, PageHeader, Panel, Segmented, SimBanner, SourceTag, Stat, Table } from "@/components/ui";
import type { ArbitragemResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { brl, compact, num, pct, signed } from "@/lib/fmt";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));

function NumberField({ label, value, onChange, step, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; suffix: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tnum h-11 w-24 rounded-[10px] bg-surface-2 sm:h-9 px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent/50"
        />
        <span className="text-[13px]">{suffix}</span>
      </span>
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Arbitragem"
        subtitle="Quanto uma bateria capturaria com a diferença de preço ao longo do dia, e o risco de descolamento entre submercados."
        right={
          <div className="flex items-center gap-2">
            <a href={`${url}&format=csv`} className="inline-flex min-h-11 sm:min-h-9 items-center rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-ink hover:bg-surface-3" title="Baixar o despacho ótimo das próximas 72 h (preço esperado, potência e SoC) em CSV">
              Baixar CSV
            </a>
            <Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} />
          </div>
        }
      />
      <SimBanner metas={[a?.meta.pld, a?.meta.eu, a?.meta.fx]} label="PLD" />
      {error && !a ? <ErrorBox error={error} /> : null}

      <section className="card flex flex-wrap items-end gap-x-5 gap-y-3 px-5 py-4" aria-label="Ativo de armazenamento">
        <NumberField label="Potência" value={pow} onChange={setPow} step={5} min={1} max={2000} suffix="MW" />
        <NumberField label="Energia" value={cap} onChange={setCap} step={10} min={1} max={5000} suffix="MWh" />
        <NumberField label="Eficiência ida e volta" value={rte} onChange={setRte} step={1} min={50} max={99} suffix="%" />
        <NumberField label="Degradação" value={deg} onChange={setDeg} step={5} min={0} max={500} suffix="R$/MWh" />
        <Button variant="primary" onClick={() => setApplied({ pow, cap, rte, deg })}>
          Recalcular
        </Button>
        <span className="pb-2 text-[13px] text-muted">duração {num(cap / Math.max(pow, 1), 1)} h</span>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Valor em 7 dias" value={brl(b?.lsmcRS, 0)} hint={b ? `com opcionalidade · ± ${brl(1.96 * b.lsmcStdErr, 0)}` : undefined} />
        <Stat label="Por MW·dia" value={brl(b?.perMWDayRS, 0)} hint="teto prospectivo, sem encargos" />
        <Stat label="Teto (informação perfeita)" value={brl(b?.perfectForesightRS, 0)} hint="limite superior" />
        <Stat
          label="Pior 5% (CVaR 95%)"
          value={brl(b ? -b.risk.cvar95 : null, 0)}
          deltaGood={b ? -b.risk.cvar95 >= 0 : null}
          delta={b ? (-b.risk.cvar95 >= 0 ? "lucro mesmo na cauda" : "perda esperada na cauda") : null}
        />
      </div>
      <p className="-mt-2 px-1 text-[13px] text-muted">
        No SIN não há mercado contínuo a PLD: estes valores são o teto do potencial de arbitragem. Receita real de bateria vem de leilão de capacidade, serviços ancilares ou atrás do medidor.
      </p>

      {b?.notes?.length ? (
        <ul className="flex flex-col gap-1 px-1 text-[13px] text-warning" aria-label="Diagnósticos numéricos">
          {b.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Despacho ótimo — próximas 72 h" subtitle="Preço previsto, potência na rede e estado de carga" right={<SourceTag meta={a?.meta.pld} label="PLD" />}>
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
          <Panel title="Distribuição do resultado" subtitle="1.000 cenários simulados · vermelho = pior 5%">
            {histOpt ? <EChart option={histOpt} height={220} label="Distribuição de P&L" /> : <Loading height={220} />}
            {b ? <p className="mt-2 text-[12px] text-muted">P05 {brl(b.risk.p05, 0)} · mediana {brl(b.risk.p50, 0)} · P95 {brl(b.risk.p95, 0)} · média na cauda 5% {brl(-b.risk.cvar95, 0)}</p> : null}
          </Panel>
          <Panel title="Amanhã (já publicado)" subtitle="Despacho exato no preço conhecido">
            {b?.publishedTomorrow ? (
              <div className="flex flex-col gap-1 text-[13px]">
                <div className="tnum text-[26px] font-semibold tracking-[-0.02em] text-ink">{brl(b.publishedTomorrow.valueRS, 0)}</div>
                <div className="text-muted">
                  {b.publishedTomorrow.date} · caixa do dia {brl(b.publishedTomorrow.cashRS, 0)} · SoC final {pct(100 * b.publishedTomorrow.endSoc, 0)} · spread intradiário {brl(b.publishedTomorrow.spreadRS, 0)}/MWh
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted">O PLD de amanhã ainda não foi divulgado (normalmente sai à tarde).</p>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Spreads entre submercados" subtitle="Últimos 30 dias · risco de descolamento (não há FTR no SIN); toque num par para ver a série">
          {a ? (
            <Table
              head={["Par", "Atual", "z", "Descolado", "Meia-vida", "Sinal"]}
              align={["left", "right", "right", "right", "right", "left"]}
              rows={a.spreads.map((s, i) => [
                <button key="p" onClick={() => setPair(i)} title={`ADF p = ${num(s.adfP, 3)} · cointegrado: ${s.cointegrated === null ? "—" : s.cointegrated ? "sim" : "não"}`} className={`font-medium underline-offset-2 hover:underline ${pair === i ? "text-accent" : "text-ink-2"}`}>{`${s.a}−${s.b}`}</button>,
                brl(s.current, 2),
                num(s.z, 2),
                pct(s.decoupledPct, 0),
                s.halfLifeH !== null ? `${num(s.halfLifeH, 1)} h` : "—",
                <Badge key="s" level={s.signal.startsWith("Spread alto") || s.signal.startsWith("Spread baixo") ? "warning" : s.signal === "Acoplados" ? "good" : "neutral"}>{s.signal}</Badge>,
              ])}
            />
          ) : (
            <Loading height={200} />
          )}
          <div className="mt-3">{spreadOpt ? <EChart option={spreadOpt} height={180} label="Série do spread selecionado" /> : null}</div>
        </Panel>
        <Panel title="Lente global" subtitle="Preço médio do dia em R$/MWh pelo câmbio do BCB · só referência, não há interconexão">
          {lensOpt ? <EChart option={lensOpt} height={360} label="Comparação global de preços" /> : <Loading height={360} />}
        </Panel>
      </div>

      <Disclosure title="Europa, opcionalidade e resultado realizado" hint="bateria por zona, congestionamento e capture ratio">
        {b?.realized ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Teto realizado" value={brl(b.realized.perMWDayRS, 0)} unit="R$/MW·dia" hint={`informação perfeita no PLD realizado · ${b.realized.days} dias`} />
            <Stat label="Política simples" value={brl(b.realized.naivePerMWDayRS, 0)} unit="R$/MW·dia" hint="1 ciclo por dia nas horas mais baratas e mais caras" />
            {b.realized.captureRatio === null ? (
              <Stat label="Capture ratio" value="n/d" hint="PLD quase plano: o teto é ~0" />
            ) : (
              <Stat label="Capture ratio" value={pct(100 * b.realized.captureRatio, 0)} hint="política simples / teto realizado" deltaGood={b.realized.captureRatio >= 0.5} delta={b.realized.captureRatio >= 0.5 ? "captura a maior parte" : "muito abaixo do teto"} />
            )}
          </div>
        ) : null}
        {b ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Intrínseco (curva média)" value={brl(b.intrinsicRS, 0)} hint={b.solver} />
            <Stat label="Opcionalidade" value={brl(b.extrinsicRS, 0)} delta={b.intrinsicRS ? `${signed((100 * b.extrinsicRS) / Math.abs(b.intrinsicRS), 0)}% sobre o intrínseco` : null} />
            <Stat label="Probabilidade de perda" value={pct(100 * b.risk.probLoss, 1)} hint={`Ω ${Number.isFinite(b.risk.omega) ? num(b.risk.omega, 2) : "∞"}`} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Europa — bateria 1 MW / 2 MWh" subtitle="Receita ótima no último dia de entrega, por zona" right={<SourceTag meta={a?.meta.eu} label="Energy-Charts" />}>
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
          <Panel title="Europa — congestionamento" subtitle="Valor de 1 MW de direito de transmissão por fronteira">
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
      </Disclosure>
    </div>
  );
}
