"use client";

import { useEffect, useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Disclosure, Empty, ErrorBox, Kpi, Loading, MetricRow, PageHeader, Panel, Segmented, SimBanner, Sparkline, sourceState, Stat, Table, type Level } from "@/components/ui";
import type { RedeResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, line, timeAxis, valueAxis } from "@/lib/chart";
import { ago, brl, dateTime, dayLabel, num, pct, tinyMw } from "@/lib/fmt";
import { PAIR_NAMES, PAIR_SUBS, PAIRS, type Pair } from "@/lib/market/interchange";
import { SUB_NAMES } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

// o ONS publica o intercâmbio de um dia no fim da tarde do seguinte: acima de ~54 h fica atrasado
const STALE_MS = 54 * 3600_000;
const DAYS_OPTS = [
  { value: "3", label: "3d" },
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
];
const PAIR_OPTS = PAIRS.map((p) => ({ value: p, label: p.replace("-", "–") }));
const HOURS = Array.from({ length: 24 }, (_, h) => `${h}h`);
const STATUS: Record<string, { level: Level; label: string }> = {
  bom: { level: "good", label: "Bom" },
  atencao: { level: "warning", label: "Atenção" },
  ruim: { level: "critical", label: "Ruim" },
};
/** Faixas de carregamento no mapa (pior hora do dia, % da capacidade de longa duração). */
const BANDS = [
  { name: "até 50%", lo: -Infinity, hi: 50, color: C.axis, opacity: 0.9 },
  { name: "50–80%", lo: 50, hi: 80, color: C.accent, opacity: 0.9 },
  { name: "80–100%", lo: 80, hi: 100, color: C.serious, opacity: 1 },
  { name: "acima de 100%", lo: 100, hi: Infinity, color: C.critical, opacity: 1 },
];
/** "LT 500 kV SE LAJEADO / MIRACEMA C 1 TO" → "LAJEADO / MIRACEMA C 1 TO" (a tensão vai em outra coluna ou no título). */
const shortName = (s: string) => s.replace(/^LT\s+/, "").replace(/^\d+\s*kV\s+(SE\s+)?/, "");
const KPI_LABEL: Record<Pair, string> = { "N-NE": "Norte – Nordeste", "N-SE": "Norte – Sudeste", "NE-SE": "Nordeste – Sudeste", "S-SE": "Sul – Sudeste" };
const widthOf = (kv: number) => (kv >= 700 ? 2.6 : kv >= 440 ? 1.8 : kv >= 300 ? 1.2 : 0.8);
const dir = (p: Pair, v: number | null | undefined) => {
  const [a, b] = PAIR_SUBS[p];
  return v === null || v === undefined ? `${a}–${b}` : v >= 0 ? `${a} → ${b}` : `${b} → ${a}`;
};

/** Altura do mapa: quadrado que cabe na largura da tela (o Brasil ocupa ~40° × 40°). */
function useMapSize() {
  const [h, setH] = useState(460);
  useEffect(() => {
    const f = () => setH(Math.round(Math.min(520, Math.max(300, window.innerWidth - 56))));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return h;
}

export default function RedePage() {
  const [days, setDays] = useState("7");
  const [pair, setPair] = useState<Pair>("N-SE");
  const { data, error, isValidating, mutate } = useApi<RedeResp>(`/api/rede?dias=${days}`, 15 * 60_000);
  const mapH = useMapSize();
  const ic = data?.interchange ?? null;
  const g = data?.grid ?? null;
  const icState = sourceState(data?.meta.intercambio, STALE_MS);
  const stats = ic?.pairs.find((x) => x.pair === pair) ?? null;

  const flow = useMemo<ChartOption | null>(() => {
    if (!ic?.ts.length) return null;
    const [a, b] = PAIR_SUBS[pair];
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip },
      grid: { ...baseOption().grid, right: 8 },
      xAxis: timeAxis(),
      yAxis: [valueAxis(`MWmed (+ = ${a}→${b})`), valueAxis("R$/MWh", { splitLine: { show: false }, position: "right", nameTextStyle: { color: C.muted, fontSize: 10, align: "right" } })],
      series: [
        { ...line("Medido", ic.ts.map((t, i) => [t, ic.real[pair][i]]), C.series[0]), tooltip: { valueFormatter: (v: number) => `${num(v, 0)} MW` } },
        { ...line("Programado", ic.ts.map((t, i) => [t, ic.prog[pair][i]]), C.ink2, { lineStyle: { width: 1.3, type: [4, 3], color: C.ink2 } }), tooltip: { valueFormatter: (v: number) => `${num(v, 0)} MW` } },
        {
          name: `PLD ${b} − PLD ${a}${data?.pldOfficial ? "" : " (estimado)"}`,
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 4,
          itemStyle: { color: C.serious, opacity: 0.55 },
          data: ic.ts.map((t, i) => [t, ic.spread[pair][i]]),
          tooltip: { valueFormatter: (v: number) => brl(v) },
        },
      ],
    };
  }, [ic, pair, data?.pldOfficial]);

  const map = useMemo<ChartOption | null>(() => {
    if (!g?.lines.length) return null;
    const side = mapH - 44;
    const known = g.lines.filter((l) => l.max !== null);
    const unknown = g.lines.filter((l) => l.max === null);
    const item = (l: (typeof g.lines)[number]) => ({ name: l.n, value: l.max, kv: l.kv, coords: [[l.a[1], l.a[0]], [l.b[1], l.b[0]]], lineStyle: { width: widthOf(l.kv) } });
    const tip = (p: { data: { name: string; value: number | null; kv: number } }) =>
      `<b>${p.data.name}</b><br/>${p.data.kv} kV · pior hora ${p.data.value === null ? "sem capacidade no cadastro" : `${num(p.data.value, 0)}% da capacidade`}`;
    return {
      ...baseOption(),
      animation: false,
      tooltip: { ...baseOption().tooltip, trigger: "item", formatter: tip },
      grid: { top: 36, bottom: 8, left: "center", width: side, height: side - 8 },
      xAxis: { type: "value", min: -74, max: -34, show: false },
      yAxis: { type: "value", min: -34, max: 6, show: false },
      series: [
        { name: "sem capacidade", type: "lines", coordinateSystem: "cartesian2d", silent: false, data: unknown.map(item), lineStyle: { color: C.axis, opacity: 0.5, type: [2, 2] } },
        ...BANDS.map((b) => ({
          name: b.name,
          type: "lines",
          coordinateSystem: "cartesian2d",
          data: known.filter((l) => l.max! > b.lo && l.max! <= b.hi).map(item),
          lineStyle: { color: b.color, opacity: b.opacity },
          emphasis: { lineStyle: { width: 4 } },
          zlevel: b.lo >= 80 ? 1 : 0,
        })),
        // linha curta some no mapa: as carregadas (≥ 80%) ganham um ponto no meio, com a mesma legenda
        ...BANDS.filter((b) => b.lo >= 80).map((b) => ({
          name: b.name,
          type: "scatter",
          symbolSize: 9,
          zlevel: 2,
          itemStyle: { color: b.color, borderColor: C.surface, borderWidth: 1.5 },
          data: known
            .filter((l) => l.max! > b.lo && l.max! <= b.hi)
            .map((l) => ({ name: l.n, value: [(l.a[1] + l.b[1]) / 2, (l.a[0] + l.b[0]) / 2], kv: l.kv, max: l.max })),
          tooltip: { formatter: (p: { data: { name: string; kv: number; max: number } }) => `<b>${p.data.name}</b><br/>${p.data.kv} kV · pior hora ${num(p.data.max, 0)}% da capacidade` },
        })),
      ],
    };
  }, [g, mapH]);

  const validation = useMemo<ChartOption | null>(() => {
    const v = g?.validation.intercambio.find((x) => x.par === pair);
    if (!v) return null;
    const [a, b] = PAIR_SUBS[pair];
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (x: number) => `${num(x, 0)} MW` },
      xAxis: categoryAxis(HOURS, { boundaryGap: false }),
      yAxis: valueAxis(`MW (+ = ${a}→${b})`),
      series: [
        { ...line("Medido (ONS)", [], C.series[0]), data: v.real },
        { ...line("Calculado (fluxo AC)", [], C.series[1], { lineStyle: { width: 1.5, type: [4, 3], color: C.series[1] } }), data: v.modelo },
      ],
    };
  }, [g, pair]);

  const top = g?.topLines[0] ?? null;
  const n1 = g?.n1 ?? null;
  const ageNote = g ? `dia ${dayLabel(g.date)} · recebido ${ago(data?.gridReceivedAt)}` : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rede elétrica"
        subtitle="Quanto passou entre os submercados, quando a rede separou os preços e onde o SIN está mais carregado."
        right={<Segmented label="Janela" value={days} options={DAYS_OPTS} onChange={setDays} />}
      />
      <SimBanner metas={[data?.meta.intercambio, data?.meta.balanco, data?.meta.pld]} label="ONS" staleAfterMs={STALE_MS} />
      {error && !data ? <ErrorBox error={error} onRetry={() => mutate()} /> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {PAIRS.map((p) => {
          const s = ic?.pairs.find((x) => x.pair === p);
          const l = s?.latest ?? null;
          return (
            <Kpi
              key={p}
              label={KPI_LABEL[p]}
              value={l?.real !== null && l?.real !== undefined ? Math.abs(l.real) : null}
              format={(v) => num(v, 0)}
              unit={`MW ${dir(p, l?.real)}`}
              state={icState}
              at={data?.meta.intercambio.latestTs}
              source={l ? `medido às ${dateTime(l.ts)} · programado ${num(l.prog, 0)} MW · PLD diferente dos dois lados em ${pct(100 * (s?.decoupledShare ?? 0), 0)} das horas da janela` : undefined}
              foot={s?.decoupledShare !== null && s?.decoupledShare !== undefined ? `${pct(100 * s.decoupledShare, 0)} descolado` : undefined}
              spark={ic ? ic.real[p].slice(-48) : undefined}
            />
          );
        })}
      </div>

      <Panel
        title={`Intercâmbio ${PAIR_NAMES[pair]}`}
        subtitle="Medido e programado pelo ONS, hora a hora; barras: diferença de PLD entre os dois lados (zero = mesmo preço)"
        right={<Segmented label="Interligação" value={pair} options={PAIR_OPTS} onChange={setPair} size="xs" />}
      >
        {flow ? <EChart option={flow} height={300} label={`Intercâmbio medido e programado ${PAIR_NAMES[pair]}`} dim={isValidating} /> : data ? <Empty label="Intercâmbio indisponível na janela." height={300} /> : <Loading height={300} />}
        {stats ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {stats.decoupledHours
              ? `Em ${num(stats.decoupledHours)} de ${num(stats.pricedHours)} horas o PLD de ${SUB_NAMES[PAIR_SUBS[pair][1]]} ficou diferente do de ${SUB_NAMES[PAIR_SUBS[pair][0]]} (média de ${brl(stats.meanSpreadDecoupled)}): algum limite de transmissão entre os dois lados estava ativo. Nessas horas passaram em média ${num(stats.meanRealDecoupled, 0)} MW, contra ${num(stats.meanRealCoupled, 0)} MW com preço igual.`
              : `Os dois lados tiveram o mesmo PLD em todas as ${num(stats.pricedHours)} horas com preço: nenhum limite de transmissão separou os dois lados na janela.`}
          </p>
        ) : null}
      </Panel>

      <Panel title="Quando a rede separa os preços" subtitle={`Janela ${ic?.from ? `${dayLabel(ic.from)}–${dayLabel(ic.to!)}` : ""}; sentido positivo = do primeiro para o segundo submercado`}>
        {ic ? (
          <>
            <Table
              label="Intercâmbio e descolamento de preço por interligação"
              head={["Interligação", "Fluxo médio", "Maior fluxo", "Medido − programado", "Horas descoladas", "Diferença de PLD", "Para o lado caro"]}
              align={["left", "right", "right", "right", "right", "right", "right"]}
              rows={ic.pairs.map((s) => [
                s.name,
                `${num(s.meanReal, 0)} MW`,
                `${num(s.maxAbsReal, 0)} MW`,
                `${num(s.maeProg, 0)} MW`,
                s.pricedHours ? `${num(s.decoupledHours)} (${pct(100 * (s.decoupledShare ?? 0), 0)})` : "—",
                s.decoupledHours ? brl(s.meanSpreadDecoupled) : "—",
                s.towardExpensive === null ? "—" : pct(100 * s.towardExpensive, 0),
              ])}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Para o lado caro: nas horas descoladas, quanto da energia foi do submercado mais barato para o mais caro. Abaixo de 100% a energia correu para o lado barato em parte das horas, o que acontece quando o fluxo é imposto (elos de corrente contínua programados, como o de Belo
              Monte) ou quando o limite que separou os preços está em outra interligação.
            </p>
          </>
        ) : data ? (
          <Empty label="Intercâmbio indisponível." />
        ) : (
          <Loading height={140} />
        )}
      </Panel>

      <div className="flex flex-col gap-1 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Fluxo de potência do SIN</h2>
          {g ? data?.gridStale ? <Badge level="warning">Atrasado · {ageNote}</Badge> : <Badge level="good">{ageNote}</Badge> : null}
        </div>
        <p className="text-[14px] text-muted">
          Modelo AC da rede básica montado só com os cadastros do ONS e o despacho real de cada usina no dia, resolvido hora a hora com o p3s (Fraunhofer IEE) e conferido com o pandapower.
        </p>
      </div>

      {!g && data ? (
        <Panel title="Retrato da rede ainda não chegou">
          <p className="text-[14px] leading-relaxed text-ink-2">
            O fluxo de potência roda todo dia no GitHub Actions (<code>.github/workflows/rede.yml</code>), depois que o ONS publica a operação do dia anterior, e envia o resultado para cá. Assim que o primeiro envio chegar, esta parte mostra o mapa de carregamento, as linhas mais
            carregadas, a análise N-1 e a validação contra o intercâmbio medido.
          </p>
        </Panel>
      ) : null}

      {g ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Fluxo AC" value={`${g.validation.converged}/${g.validation.hours} h`} hint={g.validation.pandapower.ok ? `pandapower confere (${tinyMw(g.validation.pandapower.dif_max_mw)})` : "pandapower não confere"} />
            <Stat label="Linha mais carregada" value={top ? `${num(top.max, 0)}%` : "—"} hint={top ? `${shortName(top.nome)} · ${top.kv} kV · ${top.hora_max}h` : undefined} />
            <Stat label="N-1 (perda de uma linha)" value={num(n1?.com_sobrecarga ?? null)} unit={n1?.com_sobrecarga === 1 ? "sobrecarga" : "sobrecargas"} hint={`${num(n1?.contingencias ?? null)} contingências às ${n1?.hora ?? "—"}h${n1?.nao_convergiram.length ? ` · ${n1.nao_convergiram.length} sem solução` : ""}`} />
            <Stat label="Perdas na rede" value={pct(g.validation.perdas_pct, 2)} hint={`${num(g.validation.perdas_media_mw, 0)} MW de ${num(g.validation.carga_media_mw, 0)} MW de carga`} />
            <Stat label="Usinas com barra" value={pct(100 * (g.validation.cobertura_rede_basica ?? 0), 1)} hint="da geração despachada pelo ONS" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Panel className="xl:col-span-3" title="Carregamento das linhas" subtitle={`Pior hora de ${dayLabel(g.date)}, em % da capacidade de longa duração do cadastro`}>
              {map ? <EChart option={map} height={mapH} label="Mapa das linhas de transmissão coloridas pelo carregamento" /> : <Empty label="Sem coordenadas no cadastro." height={mapH} />}
            </Panel>
            <Panel className="xl:col-span-2" title="Linhas mais carregadas" subtitle="Maior carregamento do dia e a curva nas 24 horas">
              <Table
                stack={false}
                label="Linhas mais carregadas"
                head={["Linha", "Máx.", "Hora", "24 h"]}
                align={["left", "right", "right", "left"]}
                rows={g.topLines.slice(0, 12).map((l) => [
                  <span key="n" className="block max-w-[150px] truncate sm:max-w-[220px]" title={`${l.nome} · ${l.kv} kV · ${num(l.cap_mva, 0)} MVA`}>
                    {shortName(l.nome)} <span className="text-muted">{l.kv} kV</span>
                  </span>,
                  <span key="m" className={l.max !== null && l.max > 100 ? "text-critical" : l.max !== null && l.max > 80 ? "text-serious" : undefined}>
                    {pct(l.max, 0)}
                  </span>,
                  `${l.hora_max}h`,
                  <span key="s" className="block w-[90px]">
                    <Sparkline values={l.carregamento} color={l.max !== null && l.max > 80 ? C.serious : C.accent} height={22} width={90} />
                  </span>,
                ])}
              />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Validação: calculado × medido" subtitle={`Intercâmbio ${PAIR_NAMES[pair]} em ${dayLabel(g.date)}`} right={<Segmented label="Interligação" value={pair} options={PAIR_OPTS} onChange={setPair} size="xs" />}>
              {validation ? <EChart option={validation} height={240} label="Intercâmbio calculado pelo modelo versus medido pelo ONS" /> : <Empty height={240} />}
              <Table
                label="Erro do intercâmbio calculado por interligação"
                head={["Interligação", "Erro médio", "Erro relativo", "Correlação", "Situação"]}
                align={["left", "right", "right", "right", "left"]}
                rows={g.validation.intercambio.map((x) => [
                  x.nome,
                  `${num(x.mae_mw, 0)} MW`,
                  x.erro_rel === null ? "—" : pct(100 * x.erro_rel, 1),
                  num(x.correlacao, 3),
                  x.status ? <Badge key="b" level={STATUS[x.status].level}>{STATUS[x.status].label}</Badge> : "—",
                ])}
              />
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Até 15% do fluxo médio é bom; até 30%, atenção. O corredor Norte–Sudeste é o menos confiável: a compensação série das linhas não está no cadastro do ONS e o modelo desvia parte do fluxo pelo Nordeste.
              </p>
            </Panel>
            <Panel title="N-1: o que acontece se uma linha sair" subtitle={n1 ? `${n1.criterio} · ${n1.hora ?? "—"}h` : undefined}>
              {n1?.top.length ? (
                <Table
                  stack
                  label="Contingências N-1 mais severas"
                  head={["Se sair", "Mais carregada depois", "Carregamento", "Limite curto"]}
                  align={["left", "left", "right", "right"]}
                  rows={n1.top.slice(0, 10).map((x) => [
                    shortName(x.fora),
                    shortName(x.pior),
                    <span key="c" className={x.carregamento !== null && x.carregamento > 100 ? "text-critical" : x.carregamento !== null && x.carregamento > 90 ? "text-serious" : undefined}>
                      {pct(x.carregamento, 0)}
                    </span>,
                    `${num(x.cap_curta_mva, 0)} MVA`,
                  ])}
                />
              ) : (
                <Empty label="Sem contingências calculadas." />
              )}
              {n1?.nao_convergiram.length ? <p className="mt-2 text-[13px] text-warning">Sem solução (colapso de tensão ou limite do modelo): {n1.nao_convergiram.map(shortName).join("; ")}.</p> : null}
            </Panel>
          </div>

          <Disclosure title="Hipóteses, fontes e histórico do modelo" hint={`${g.sources.length} arquivos do ONS`}>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title="Hipóteses" subtitle="O que não está nos cadastros públicos e como foi tratado">
                <ul className="flex list-disc flex-col gap-2 pl-4 text-[14px] leading-relaxed text-ink-2">
                  {g.assumptions.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Modelo e solver" subtitle={`${g.solver.nome} ${g.solver.versao}${g.solver.commit ? ` (${g.solver.commit.slice(0, 7)})` : ""} · pandapower ${g.solver.pandapower}`}>
                <div className="flex flex-col">
                  <MetricRow label="Barras na ilha principal" value={num(Number(g.model.barras_ilha_principal ?? NaN))} />
                  <MetricRow label="Linhas · transformadores" value={`${num(Number(g.model.linhas ?? NaN))} · ${num(Number(g.model.trafos ?? NaN))}`} />
                  <MetricRow label="Barras com carga · com geração" value={`${num(Number(g.model.barras_de_carga ?? NaN))} · ${num(Number(g.model.barras_com_geracao ?? NaN))}`} />
                  <MetricRow label="Injeção extra na referência" value={`${num(g.validation.slack_mw.min, 0)} a ${num(g.validation.slack_mw.max, 0)} MW`} />
                  <MetricRow label="Tensões entre 0,90 e 1,10 pu" value={g.validation.tensao ? pct(100 * (g.validation.tensao.faixa_090_110 ?? 0), 1) : "—"} hint="plausibilidade: o ONS não publica tensões" />
                  <MetricRow label="Tempo de cálculo" value={`${num(g.solver.segundos, 0)} s`} tone="muted" />
                </div>
              </Panel>
              <Panel title="Arquivos usados" subtitle="Bucket público de dados abertos do ONS, com a data de publicação">
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {g.sources.map((s) => (
                    <li key={s.url} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <a className="min-w-0 break-all text-accent hover:underline" href={s.url} rel="noreferrer" target="_blank">
                        {s.url.split("/").pop()}
                      </a>
                      <span className="tnum shrink-0 text-muted">{s.modified ? dateTime(Date.parse(s.modified)) : "—"}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Histórico da validação" subtitle="Erro relativo do intercâmbio calculado por dia modelado">
                {data?.gridHistory.length ? (
                  <Table
                    stack={false}
                    label="Histórico da validação do modelo da rede"
                    head={["Dia", "AC", ...PAIRS.map((p) => p.replace("-", "–")), "N-1"]}
                    align={["left", "right", "right", "right", "right", "right", "right"]}
                    rows={[...data.gridHistory].reverse().map((h) => [
                      dayLabel(h.date),
                      `${h.converged}/${h.hours}`,
                      ...PAIRS.map((p) => {
                        const x = h.interchange.find((i) => i.par === p);
                        return x?.erro_rel === null || x?.erro_rel === undefined ? "—" : pct(100 * x.erro_rel, 0);
                      }),
                      h.n1.com_sobrecarga === null ? "—" : `${h.n1.com_sobrecarga} sobrec.`,
                    ])}
                  />
                ) : (
                  <Empty label="Histórico começa no primeiro envio." />
                )}
              </Panel>
            </div>
          </Disclosure>
        </>
      ) : null}

      {data?.identity || data?.notes.length ? (
        <Disclosure title="Qualidade dos dados de intercâmbio" hint="conferência com o balanço de energia">
          <Panel title="Intercâmbio nacional × balanço de energia" subtitle="Exportação de cada subsistema somando as interligações contra o intercâmbio do balanço, hora a hora">
            {data?.identity ? (
              <div className="flex flex-col">
                {data.identity.map((x) => (
                  <MetricRow
                    key={x.sub}
                    label={SUB_NAMES[x.sub]}
                    hint={`${num(x.hours)} h`}
                    value={x.sub === "S" && (x.maxAbsDiff ?? 0) > 1 ? `diferença média ${num(x.meanDiff, 0)} MW` : `maior diferença ${num(x.maxAbsDiff, 1)} MW`}
                    tone={x.maxAbsDiff !== null && x.maxAbsDiff <= 1 ? "good" : x.sub === "S" ? "muted" : "warning"}
                  />
                ))}
                <p className="mt-2 text-[12px] leading-relaxed text-muted">Quando o Sul troca energia com Argentina e Uruguai, a diferença dele é esse intercâmbio internacional, que o balanço inclui e o arquivo nacional não.</p>
              </div>
            ) : (
              <Empty label="Balanço indisponível para conferir." />
            )}
            {data?.notes.length ? (
              <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-ink-2">
                {data.notes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </Disclosure>
      ) : null}
    </div>
  );
}
