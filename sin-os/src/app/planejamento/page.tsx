"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, Disclosure, Empty, ErrorBox, Kpi, Loading, MetricRow, PageHeader, Panel, Segmented, SimBanner, Table } from "@/components/ui";
import type { PlanejamentoResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { ago, brl, dayLabel, num, pct } from "@/lib/fmt";
import { headline12, headlineBand, headlinePld, sddp12, sddpPld, type Quant } from "@/lib/planning/report";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const DAY = 86400_000;

/** Faixa P10–P90 sobre eixo de categorias: base invisível + largura empilhada. */
function catBand(name: string, lo: (number | null)[], hi: (number | null)[], color: string, opacity = 0.16) {
  return [
    { name: `${name}-base`, type: "line", stack: name, data: lo, lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    {
      name,
      type: "line",
      stack: name,
      data: hi.map((h, i) => (h === null || lo[i] === null ? null : h - (lo[i] as number))),
      lineStyle: { opacity: 0 },
      itemStyle: { color, opacity: Math.min(1, opacity * 3) },
      areaStyle: { color, opacity },
      showSymbol: false,
      silent: true,
      tooltip: { show: false },
    },
  ];
}

const q = (x: Quant | undefined, k: keyof Quant) => (x ? x[k] : null);
/** Legenda sem as séries auxiliares das faixas ("-base"). */
const legendOf = (series: { name?: string }[]) => ({ ...baseOption().legend, data: series.map((x) => x.name).filter((n): n is string => !!n && !n.endsWith("-base")) });
const withLegend = <T extends { series: unknown[] }>(o: T): ChartOption => ({ ...o, legend: legendOf(o.series as { name?: string }[]) }) as ChartOption;

export default function PlanejamentoPage() {
  const [sub, setSub] = useState<Sub>("SE");
  const { data, error, isValidating, mutate } = useApi<PlanejamentoResp>("/api/planejamento", 15 * 60_000);
  const r = data?.report ?? null;
  const months = useMemo(() => r?.resultado.meses ?? [], [r]);
  const realized = useMemo(() => new Map((data?.realized ?? []).map((x) => [x.mes, x])), [data]);
  const m1 = months.find((m) => m.cobertura >= 0.999 && r && m.mes > r.start.slice(0, 7)) ?? months[0] ?? null;
  const p12 = r ? (headline12(r)?.[sub] ?? null) : null;
  const base12 = r ? (sddp12(r)?.[sub].mean ?? null) : null;
  const ponta = !!months[0]?.pld_ponta;
  const stages = useMemo(() => r?.resultado.estagios ?? [], [r]);
  const riskMax = stages.length ? Math.max(...stages.map((s) => s.risco_deficit[sub])) : null;
  const ear6 = stages[5]?.ear_fim_pct[sub] ?? null;
  const cal = r?.calibracao_risco ?? null;
  const comb = r?.combinacao ?? null;
  const pure = useMemo(() => new Map((cal?.puro ?? []).map((x) => [x.mes, x.pld_p50])), [cal]);

  const pldChart = useMemo<ChartOption | null>(() => {
    if (!months.length) return null;
    const cats = months.map((m) => monthLabel(m.mes));
    const lo = months.map((m) => headlineBand(m, sub).p10);
    const hi = months.map((m) => headlineBand(m, sub).p90);
    const floor = r ? r.params.pld_limites[String(Math.max(...Object.keys(r.params.pld_limites).map(Number)))]?.min : null;
    return withLegend({
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "axis", valueFormatter: (v: number) => (v === null || v === undefined ? "—" : brl(v)) },
      grid: { ...baseOption().grid, right: 12 },
      xAxis: categoryAxis(cats),
      yAxis: valueAxis("R$/MWh"),
      series: [
        ...catBand("PLD P10–P90", lo, hi, C.series[0]),
        { name: comb ? "PLD publicado (P50)" : "PLD P50", type: "line", data: months.map((m) => headlinePld(m)[sub].p50), lineStyle: { width: 2, color: C.series[0] }, itemStyle: { color: C.series[0] }, symbolSize: 6 },
        comb
          ? { name: "SDDP calibrado (P50)", type: "line", data: months.map((m) => sddpPld(m)[sub].p50), lineStyle: { width: 1.5, type: [5, 4], color: C.ink2 }, itemStyle: { color: C.ink2 }, showSymbol: false }
          : { name: "PLD médio", type: "line", data: months.map((m) => headlinePld(m)[sub].mean), lineStyle: { width: 1.5, type: [5, 4], color: C.ink2 }, itemStyle: { color: C.ink2 }, showSymbol: false },
        ...(cal
          ? [{ name: `Sem calibração (λ ${num(cal.lambda_padrao, 2)})`, type: "line", data: months.map((m) => pure.get(m.mes)?.[sub] ?? null), lineStyle: { width: 1.2, type: [2, 3], color: C.series[3] }, itemStyle: { color: C.series[3] }, showSymbol: false }]
          : ponta
            ? [{ name: "PLD do SDDP sem ponta (P50)", type: "line", data: months.map((m) => m.pld[sub].p50), lineStyle: { width: 1.2, type: [2, 3], color: C.series[3] }, itemStyle: { color: C.series[3] }, showSymbol: false }]
            : []),
        { name: "CMO médio", type: "line", data: months.map((m) => m.cmo[sub].mean), lineStyle: { width: 1.2, color: C.series[1] }, itemStyle: { color: C.series[1] }, showSymbol: false },
        {
          name: `PLD realizado${data?.pldOfficial ? "" : " (estimado)"}`,
          type: "scatter",
          data: months.map((m) => realized.get(m.mes)?.pld[sub] ?? null),
          symbolSize: 10,
          itemStyle: { color: C.warning },
          markLine: floor ? { symbol: "none", silent: true, data: [{ yAxis: floor }], lineStyle: { color: C.muted, type: [2, 3] }, label: { formatter: `piso ${brl(floor, 2)}`, color: C.muted, position: "insideStartTop" } } : undefined,
        },
      ],
    });
  }, [months, sub, realized, r, data?.pldOfficial, ponta, cal, pure, comb]);

  const earChart = useMemo<ChartOption | null>(() => {
    if (!stages.length || !r) return null;
    const cats = stages.map((s) => dayLabel(s.fim));
    const env = r.caso.envelope[sub];
    const calOf = (iso: string) => String(new Date(Date.parse(iso) - DAY).getUTCMonth() + 1);
    return withLegend({
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "axis", valueFormatter: (v: number) => (v === null || v === undefined ? "—" : pct(v, 1)) },
      grid: { ...baseOption().grid, right: 12 },
      xAxis: categoryAxis(cats),
      yAxis: valueAxis("% do máximo", { min: 0, max: 100, scale: false }),
      series: [
        ...catBand("EAR P10–P90", stages.map((s) => s.ear_fim_pct[sub].p10), stages.map((s) => s.ear_fim_pct[sub].p90), C.series[2]),
        { name: "EAR P50", type: "line", data: stages.map((s) => s.ear_fim_pct[sub].p50), lineStyle: { width: 2, color: C.series[2] }, itemStyle: { color: C.series[2] }, symbolSize: 6 },
        { name: "Máx. já operado", type: "line", step: "middle", data: stages.map((s) => env[calOf(s.fim)]?.max ?? null), lineStyle: { width: 1, type: [4, 3], color: C.muted }, itemStyle: { color: C.muted }, showSymbol: false },
        { name: "Mín. já operado", type: "line", step: "middle", data: stages.map((s) => env[calOf(s.fim)]?.min ?? null), lineStyle: { width: 1, type: [2, 3], color: C.critical }, itemStyle: { color: C.critical }, showSymbol: false },
      ],
    });
  }, [stages, sub, r]);

  const histChart = useMemo<ChartOption | null>(() => {
    const h = data?.history ?? [];
    if (h.length < 2) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "axis", valueFormatter: (v: number) => (v === null || v === undefined ? "—" : brl(v)) },
      grid: { ...baseOption().grid, right: 12 },
      xAxis: categoryAxis(h.map((x) => dayLabel(x.asof))),
      yAxis: valueAxis("R$/MWh"),
      series: [
        { name: "PLD do mês seguinte (P50)", type: "line", data: h.map((x) => x.m1[sub]), lineStyle: { width: 2, color: C.series[0] }, itemStyle: { color: C.series[0] }, symbolSize: 5 },
        { name: "PLD médio 12 meses", type: "line", data: h.map((x) => x.pld12?.[sub] ?? null), lineStyle: { width: 1.5, color: C.series[1] }, itemStyle: { color: C.series[1] }, symbolSize: 5 },
      ],
    };
  }, [data?.history, sub]);

  const valChart = useMemo<ChartOption | null>(() => {
    const v = r?.validacao?.meses ?? [];
    if (!v.length) return null;
    const cats = v.map((x) => monthLabel(x.mes));
    const head = (x: (typeof v)[number]) => x.sub[sub].previsto_pld_ponta ?? x.sub[sub].previsto_pld;
    // com a combinação, faixa e P50 são os publicados (refeitos sem o próprio mês) e o SDDP calibrado vai tracejado
    const pub = v.every((x) => x.sub[sub].publicado) ? (x: (typeof v)[number]) => x.sub[sub].publicado! : null;
    const top = pub ?? head;
    return withLegend({
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "axis", valueFormatter: (x: number) => (x === null || x === undefined ? "—" : brl(x)) },
      grid: { ...baseOption().grid, right: 12 },
      xAxis: categoryAxis(cats),
      yAxis: valueAxis("R$/MWh"),
      series: [
        ...catBand(pub ? "Faixa publicada" : "Previsto P10–P90", v.map((x) => top(x).p10), v.map((x) => top(x).p90), C.series[0]),
        { name: pub ? "Publicado (P50)" : "Previsto P50", type: "line", data: v.map((x) => top(x).p50), lineStyle: { width: 2, color: C.series[0] }, itemStyle: { color: C.series[0] }, symbolSize: 5 },
        ...(pub ? [{ name: "SDDP calibrado (P50)", type: "line", data: v.map((x) => head(x).p50), lineStyle: { width: 1.5, type: [5, 4], color: C.ink2 }, itemStyle: { color: C.ink2 }, showSymbol: false }] : []),
        ...(v[0]?.sub[sub].previsto_puro != null
          ? [{ name: "Sem calibração (λ padrão)", type: "line", data: v.map((x) => x.sub[sub].previsto_puro ?? null), lineStyle: { width: 1.2, type: [2, 3], color: C.series[3] }, itemStyle: { color: C.series[3] }, showSymbol: false }]
          : v[0]?.sub[sub].previsto_pld_ponta
            ? [{ name: "SDDP sem ponta (P50)", type: "line", data: v.map((x) => x.sub[sub].previsto_pld.p50), lineStyle: { width: 1.2, type: [2, 3], color: C.series[3] }, itemStyle: { color: C.series[3] }, showSymbol: false }]
            : []),
        { name: "Realizado", type: "line", data: v.map((x) => x.sub[sub].realizado_pld), lineStyle: { width: 2, color: C.warning }, itemStyle: { color: C.warning }, symbolSize: 6 },
        ...(pub ? [] : [{ name: "Persistência (mês anterior)", type: "line", data: v.map((x) => x.sub[sub].persistencia), lineStyle: { width: 1.2, type: [4, 3], color: C.ink2 }, itemStyle: { color: C.ink2 }, showSymbol: false }]),
      ],
    });
  }, [r, sub]);

  const staleNote = data && r && data.stale ? `relatório de ${ago(Date.parse(r.generatedAt))}: o worker diário está atrasado` : null;
  const metrics = r?.validacao?.metricas[sub] ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Planejamento da operação"
        subtitle="O SDDP oficial de ONS, CCEE e EPE (NovoModelo) rodado todo dia sobre um caso do SIN montado só com dados abertos do ONS: PLD esperado mês a mês com faixas, armazenamento, risco de déficit e valor da água."
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} size="xs" />}
      />
      <SimBanner metas={[data?.meta.pld]} label="CCEE" />
      {error && !data ? <ErrorBox error={error} onRetry={() => mutate()} /> : null}
      {staleNote ? (
        <div role="status" className="rounded-2xl bg-warning/12 px-4 py-2.5 text-[13px] text-ink-2">
          {staleNote}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi
          label={m1 ? `PLD ${monthLabel(m1.mes)} (P50)` : "PLD do próximo mês"}
          value={m1 ? headlinePld(m1)[sub].p50 : null}
          format={(v) => num(v, 2)}
          unit="R$/MWh"
          foot={m1 ? `P10 ${num(headlineBand(m1, sub).p10, 0)} · P90 ${num(headlineBand(m1, sub).p90, 0)}` : undefined}
          source={
            comb && m1?.peso_sddp != null
              ? `combinação calibrada na retroanálise: ${num(100 * m1.peso_sddp, 0)}% do SDDP calibrado e ${num(100 * (1 - m1.peso_sddp), 0)}% do CMO do DESSEM de 14 dias, com a ponta horária, entre o piso e o teto da ANEEL`
              : ponta
                ? "mediana dos cenários; CMO do SDDP + desvios horários recentes do DESSEM, entre o piso e o teto da ANEEL"
                : "mediana dos cenários; CMO por patamar entre o piso e o teto da ANEEL"
          }
        />
        <Kpi
          label="PLD médio 12 meses"
          value={p12?.mean ?? null}
          format={(v) => num(v, 2)}
          unit="R$/MWh"
          foot={p12 ? `P10 ${num(p12.p10, 0)} · P90 ${num(p12.p90, 0)}` : undefined}
          source={comb?.pld_12m ? "média dos 12 meses civis inteiros à frente do publicado (P10 e P90: média das faixas mensais)" : "média dos 12 meses civis inteiros à frente, cenário a cenário"}
        />
        <Kpi label="EAR hoje" value={r ? r.caso.armazenamento[sub].pct : null} format={(v) => num(v, 1)} unit="%" foot={ear6 ? `6 meses: ${num(ear6.p50, 0)}% · P10 ${num(ear6.p10, 0)}` : undefined} source="energia armazenada (ONS) e a mediana simulada ao fim do 6º estágio" />
        <Kpi label="Risco de déficit" value={riskMax !== null ? 100 * riskMax : null} format={(v) => num(v, 1)} unit="% dos cenários" foot="pior mês em 13" source="fração dos cenários com déficit acima de 0,1% da carga, no pior dos 13 estágios" />
        <Kpi
          label="Valor da água hoje"
          value={stages[0]?.valor_agua[sub].mean ?? null}
          format={(v) => num(v, 2)}
          unit="R$/MWh"
          foot={cal ? `λ implícito ${num(cal.lambda, 2)}${cal.piso_pp ? ` · piso +${num(cal.piso_pp, 0)} p.p.` : ""}` : undefined}
          source={`custo de oportunidade de 1 MWh armazenado no início do estudo (dual do reservatório equivalente), com a aversão a risco calibrada pelo CMO recente do DESSEM${cal ? ` (padrão da CPAMP: λ ${num(cal.lambda_padrao, 2)})` : ""}`}
        />
      </div>

      <Panel
        title={`PLD esperado — ${SUB_NAMES[sub]}`}
        subtitle={
          comb
            ? "O publicado combina, mês a mês, o SDDP calibrado com o CMO do DESSEM das 2 semanas anteriores, nos pesos que mais acertaram na retroanálise (o SDDP pesa mais no mês seguinte); faixa P10–P90 pelos erros dessa combinação no mesmo horizonte; tracejado: o SDDP calibrado; pontilhado: o SDDP no λ padrão; pontos: PLD realizado (mês corrente até agora)"
            : ponta
              ? `Mediana dos cenários por mês civil, com a ponta horária do DESSEM${cal ? " e a aversão a risco calibrada pelo CMO recente" : ""}; faixa P10–P90${months[0]?.pld_faixa?.[sub]?.calibrada ? " calibrada pelos erros da retroanálise em cada horizonte" : ""}; pontilhado: ${cal ? "o mesmo SDDP no λ padrão" : "o PLD que sai só do SDDP mensal"}; pontos: PLD realizado (mês corrente até agora)`
              : "Faixa P10–P90 e mediana dos cenários simulados, por mês civil; pontos: PLD realizado (mês corrente até agora)"
        }
      >
        {pldChart ? <EChart option={pldChart} height={320} label={`PLD esperado por mês em ${SUB_NAMES[sub]}`} dim={isValidating} /> : data ? <Empty label="Sem relatório do planejamento ainda." height={320} /> : <Loading height={320} />}
        {months.length ? (
          <Table
            label="PLD e CMO esperados por mês"
            head={["Mês", "PLD P10", "PLD P50", comb ? "SDDP calibrado" : "PLD médio", "PLD P90", cal ? "Sem calibração" : "SDDP sem ponta", "CMO médio", "Realizado"]}
            align={["left", "right", "right", "right", "right", "right", "right", "right"]}
            rows={months.map((m) => [
              <span key="m">
                {monthLabel(m.mes)}
                {m.cobertura < 0.999 ? <span className="text-muted"> · {num(100 * m.cobertura, 0)}% do mês</span> : null}
              </span>,
              num(headlineBand(m, sub).p10, 2),
              <b key="p">{num(headlinePld(m)[sub].p50, 2)}</b>,
              num(comb ? sddpPld(m)[sub].p50 : headlinePld(m)[sub].mean, 2),
              num(headlineBand(m, sub).p90, 2),
              num(cal ? (pure.get(m.mes)?.[sub] ?? null) : m.pld[sub].p50, 2),
              num(m.cmo[sub].mean, 2),
              realized.get(m.mes)?.pld[sub] != null ? num(realized.get(m.mes)!.pld[sub], 2) : "—",
            ])}
          />
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`Armazenamento — ${SUB_NAMES[sub]}`} subtitle="EAR ao fim de cada estágio (P10–P90 e mediana) com o envelope que o ONS já operou em 27 anos">
          {earChart ? <EChart option={earChart} height={300} label={`Armazenamento simulado em ${SUB_NAMES[sub]}`} dim={isValidating} /> : data ? <Empty label="Sem relatório." height={300} /> : <Loading height={300} />}
        </Panel>
        <Panel title="Risco, térmicas e renováveis" subtitle={`Por estágio — ${SUB_NAMES[sub]}`}>
          {stages.length ? (
            <Table
              label="Risco de déficit, geração térmica e corte de renováveis por estágio"
              head={["Estágio", "Déficit", "Térmica (média)", "Corte renovável", "Valor da água"]}
              align={["left", "right", "right", "right", "right"]}
              rows={stages.map((s) => [
                `${dayLabel(s.inicio)}–${dayLabel(s.fim)}`,
                pct(100 * s.risco_deficit[sub], 1),
                `${num(q(s.termica_mw[sub], "mean"), 0)} MW`,
                `${num(s.corte_renovavel_mw[sub], 0)} MW`,
                brl(q(s.valor_agua[sub], "mean"), 0),
              ])}
            />
          ) : data ? (
            <Empty label="Sem relatório." />
          ) : (
            <Loading height={200} />
          )}
        </Panel>
      </div>

      {r?.sensibilidades.length ? (
        <Panel
          title="Sensibilidades"
          subtitle={`Cada linha é um SDDP completo com uma premissa alterada (mesma estimação de afluências, mesma semente${cal ? " e a mesma aversão a risco implícita" : ""}). ${cal ? "Calibrado, o caso fica perto do ponto em que a aversão a risco dispara o CMO: os choques mostram direção e ordem de grandeza, não um preço provável." : ""}`}
        >
          <Table
            label="Sensibilidades do PLD"
            head={["Cenário", m1 ? `SDDP ${monthLabel(m1.mes)} P50` : "SDDP M+1", "Δ", "SDDP 12 meses (média)", "Δ"]}
            align={["left", "right", "right", "right", "right"]}
            rows={[
              ["Caso base", num(m1 ? sddpPld(m1)[sub].p50 : null, 2), "", num(base12, 2), ""],
              ...r.sensibilidades.map((s) => {
                const sm = s.meses.find((x) => x.mes === m1?.mes);
                const s12 = sddp12({ resultado: { pld_12m: s.pld_12m, pld_12m_ponta: s.pld_12m_ponta } })?.[sub].mean ?? null;
                const v1 = sm ? sddpPld(sm)[sub].p50 : null;
                const b1 = m1 ? sddpPld(m1)[sub].p50 : null;
                const d1 = v1 != null && b1 != null ? v1 - b1 : null;
                const d12 = s12 !== null && base12 != null ? s12 - base12 : null;
                return [s.rotulo, num(v1, 2), d1 === null ? "—" : `${d1 >= 0 ? "+" : ""}${num(d1, 2)}`, num(s12, 2), d12 === null ? "—" : `${d12 >= 0 ? "+" : ""}${num(d12, 2)}`];
              }),
            ]}
          />
        </Panel>
      ) : null}

      <Panel title="Retroanálise" subtitle={`O caso montado no 1º dia de cada mês passado, só com o que estava publicado na véspera e com o λ calibrado como na rodada diária — ${SUB_NAMES[sub]}`}>
          <div className={`grid grid-cols-1 gap-x-8 gap-y-3 ${metrics ? "xl:grid-cols-2" : ""}`}>
          <div className="min-w-0">
          {valChart ? <EChart option={valChart} height={300} label={`Retroanálise do PLD em ${SUB_NAMES[sub]}`} dim={isValidating} /> : data ? <Empty label="Retroanálise ainda não publicada." height={300} /> : <Loading height={300} />}
          </div>
          {metrics ? (
            <div className="flex min-w-0 flex-col">
              {metrics.pld_mae_combinado != null ? (
                <MetricRow
                  label="Erro médio do PLD — publicado (combinação)"
                  value={brl(metrics.pld_mae_combinado)}
                  tone={metrics.pld_mae_persistencia !== null && metrics.pld_mae_combinado <= metrics.pld_mae_persistencia ? "good" : "warning"}
                  hint="pesos e faixa calibrados sem o mês avaliado"
                />
              ) : null}
              {metrics.pld_mae_ponta != null ? (
                <MetricRow
                  label={`Erro médio do PLD — ${metrics.pld_mae_puro != null ? "SDDP calibrado" : "modelo com ponta"} (P50)`}
                  value={brl(metrics.pld_mae_ponta)}
                  tone={metrics.pld_mae_combinado != null ? "muted" : metrics.pld_mae_persistencia !== null && metrics.pld_mae_ponta <= metrics.pld_mae_persistencia ? "good" : "warning"}
                  hint={`viés ${brl(metrics.pld_vies_ponta ?? null)}`}
                />
              ) : (
                <MetricRow label="Erro médio do PLD — SDDP (P50)" value={brl(metrics.pld_mae_modelo)} tone={metrics.pld_mae_modelo !== null && metrics.pld_mae_persistencia !== null && metrics.pld_mae_modelo <= metrics.pld_mae_persistencia ? "good" : "warning"} hint={`viés ${brl(metrics.pld_vies_modelo)}`} />
              )}
              {metrics.pld_mae_puro != null ? <MetricRow label="Erro médio — SDDP sem calibração" value={brl(metrics.pld_mae_puro)} tone="muted" hint="o mesmo caso no λ padrão" /> : null}
              <MetricRow label="Erro médio — persistência" value={brl(metrics.pld_mae_persistencia)} tone="muted" hint="repetir o PLD do mês anterior" />
              {metrics.pld_mae_dessem14 != null ? <MetricRow label="Erro médio — CMO do DESSEM de 14 dias" value={brl(metrics.pld_mae_dessem14)} tone="muted" hint="a média das 2 semanas anteriores, com a ponta" /> : null}
              <MetricRow label="Erro médio — CMO do DECOMP (ONS)" value={brl(metrics.pld_mae_decomp)} tone="muted" hint="o CMO semanal publicado durante o mês, limitado ao piso e ao teto" />
              {(metrics.pld_cobertura_combinado ?? metrics.pld_cobertura_calibrada) != null ? (
                <MetricRow
                  label="PLD realizado dentro da faixa publicada"
                  value={pct(100 * (metrics.pld_cobertura_combinado ?? metrics.pld_cobertura_calibrada)!, 0)}
                  hint="calibrada pelos erros dos outros meses; o esperado é perto de 80%"
                />
              ) : null}
              <MetricRow
                label={metrics.pld_cobertura_calibrada != null ? "Dentro de P10–P90 só do modelo" : "PLD realizado dentro de P10–P90"}
                value={pct((metrics.pld_cobertura_p10_p90_ponta ?? metrics.pld_cobertura_p10_p90) !== null ? 100 * (metrics.pld_cobertura_p10_p90_ponta ?? metrics.pld_cobertura_p10_p90)! : null, 0)}
                tone={metrics.pld_cobertura_calibrada != null ? "muted" : undefined}
                hint={metrics.pld_cobertura_calibrada != null ? "dispersão dos cenários de afluência" : "o esperado é perto de 80%"}
              />
              <MetricRow label="Erro médio da EAR no fim do mês" value={metrics.ear_mae_pp !== null ? `${num(metrics.ear_mae_pp, 1)} p.p.` : "—"} />
              <MetricRow label="EAR realizada dentro de P10–P90" value={pct(metrics.ear_cobertura_p10_p90 !== null ? 100 * metrics.ear_cobertura_p10_p90 : null, 0)} hint={`${metrics.meses} meses`} />
            </div>
          ) : null}
          </div>
          {metrics?.horizonte?.length ? (
            <div className="mt-5">
            <Table
              label="Erro médio do PLD por horizonte"
              head={metrics.horizonte.some((x) => x.mae_combinado != null) ? ["Horizonte", "Publicado", "SDDP calibrado", "Sem calibração", "Persistência", "DESSEM 14 d", "Meses"] : ["Horizonte", "Modelo", "Sem calibração", "Persistência", "DESSEM 14 d", "Meses"]}
              align={["left", "right", "right", "right", "right", "right", "right"]}
              rows={metrics.horizonte.map((x, _, all) => [
                x.h === 0 ? "mês seguinte" : `${x.h + 1}º mês`,
                ...(all.some((y) => y.mae_combinado != null) ? [<b key="c">{num(x.mae_combinado ?? null, 1)}</b>, num(x.mae_modelo, 1)] : [<b key="m">{num(x.mae_modelo, 1)}</b>]),
                num(x.mae_puro, 1),
                num(x.mae_persistencia, 1),
                num(x.mae_dessem14, 1),
                String(x.n),
              ])}
            />
            </div>
          ) : null}
      </Panel>
      <Panel title="Como a previsão mudou" subtitle="PLD do mês seguinte e média de 12 meses em cada rodada diária">
          {histChart ? <EChart option={histChart} height={260} label="Histórico das rodadas do planejamento" dim={isValidating} /> : data ? <Empty label="O histórico aparece a partir da segunda rodada." height={200} /> : <Loading height={200} />}
      </Panel>

      {r ? (
        <Disclosure title="O caso e o solver" hint={`estudo de ${dayLabel(r.start)}/${r.start.slice(2, 4)} a ${dayLabel(r.caso.fim)}/${r.caso.fim.slice(2, 4)}`}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Solver" subtitle={`${r.solver.nome} ${r.solver.versao}`}>
              <div className="flex flex-col">
                <MetricRow label="Método" value={r.solver.metodo} tone="muted" />
                <MetricRow label="Iterações · tempo" value={`${r.solver.iterations} · ${num(r.solver.seconds / 60, 1)} min`} />
                <MetricRow
                  label="Estabilidade do limite inferior (últimas 10)"
                  value={r.solver.lb_variacao_ultimas_10 !== null ? pct(100 * r.solver.lb_variacao_ultimas_10, 2) : "—"}
                  tone={r.solver.lb_variacao_ultimas_10 !== null && r.solver.lb_variacao_ultimas_10 <= 0.02 ? "good" : "warning"}
                  hint="com CVaR o gap clássico não vale: a convergência é a estabilização do limite inferior"
                />
                <MetricRow label="Afluências" value={`${r.caso.par.metodo}, ordem máx. ${r.caso.par.ordem_max} · correlação espacial estimada`} tone="muted" />
                <MetricRow label="Cenários · aberturas · passes" value={`${r.resultado.cenarios} · ${r.params.openings} · ${r.params.forward_passes}`} tone="muted" />
                <MetricRow label="Estágios" value={`${r.caso.estagios} mensais, ${r.caso.patamares.length} patamares (${r.caso.patamares.join(", ")})`} tone="muted" />
                <MetricRow
                  label="Aversão a risco"
                  value={r.params.cvar_lambda > 0 ? `CVaR α ${pct(100 * r.params.cvar_alpha, 0)} · λ ${num(r.params.cvar_lambda, 3)}` : "valor esperado"}
                  tone="muted"
                  hint={cal ? "λ implícito (ver abaixo)" : undefined}
                />
                <MetricRow label="Déficit · desconto" value={`${brl(r.params.deficit_cost, 2)}/MWh · ${pct(100 * r.params.discount_rate, 0)} a.a.`} tone="muted" />
              </div>
            </Panel>
            <Panel title="Entradas medidas" subtitle={`${SUB_NAMES[sub]} — dados do ONS até ${dayLabel(r.asof)}`}>
              <div className="flex flex-col">
                <MetricRow
                  label="Aproveitamento da ENA armazenável (k)"
                  value={num(r.caso.aproveitamento_ena[sub].k, 3)}
                  hint={`(geração ${num(r.caso.aproveitamento_ena[sub].geracao_mwmed, 0)} + vertimento turbinável ${num(r.caso.aproveitamento_ena[sub].vertimento_mwmed, 0)} + ΔEAR ${num(r.caso.aproveitamento_ena[sub].delta_ear_mwmed, 0)}) ÷ ENA armazenável ${num(r.caso.aproveitamento_ena[sub].ena_mwmed, 0)} MWmed, ${r.caso.aproveitamento_ena[sub].dias} dias`}
                />
                {r.caso.fio_dagua ? (
                  <MetricRow
                    label="Fio d'água (REEs sem estoque)"
                    value={r.caso.fio_dagua.rees[sub].length ? r.caso.fio_dagua.rees[sub].map((x) => x.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, c: string) => a + c.toUpperCase())).join(", ") : "nenhum"}
                    hint={r.caso.fio_dagua.rees[sub].length ? `${pct(100 * r.caso.fio_dagua.fracao_media[sub], 0)} da ENA armazenável, em média: turbinável mas não armazenável` : "toda a armazenável vai para o reservatório"}
                  />
                ) : null}
                <MetricRow label="Armazenamento" value={`${num(r.caso.armazenamento[sub].cur_mwmes, 0)} de ${num(r.caso.armazenamento[sub].max_mwmes, 0)} MWmês`} />
                <MetricRow label="Disponibilidade hidráulica" value={`${num(r.caso.hidro_disponivel_mw[sub], 0)} MW`} hint="média de 28 dias, usina a usina" />
                {r.caso.vazao_minima_mw?.[sub] != null ? (
                  <MetricRow label="Defluência mínima" value={`${num(r.caso.vazao_minima_mw[sub], 0)} MW`} hint="quantil de 1% da geração hidráulica diária no último ano (vazões mínimas das usinas)" />
                ) : null}
                <MetricRow label="Térmicas (disponível · inflexível)" value={`${num(r.caso.termicas.disponivel_mw[sub], 0)} · ${num(r.caso.termicas.inflexivel_mw[sub], 0)} MW`} hint={`${r.caso.termicas.usinas} usinas no SIN · ${r.caso.termicas.pmo}`} />
                <MetricRow label="Recebe · exporta (máximos medidos)" value={`${num(r.caso.intercambio_liquido[sub].recebe_mw, 0)} · ${num(r.caso.intercambio_liquido[sub].exporta_mw, 0)} MW`} />
                {r.ponta ? (
                  <MetricRow
                    label="Ponta horária (desvio do CMO do DESSEM)"
                    value={`${brl(r.ponta.desvio[sub].p05, 0)} a +${brl(r.ponta.desvio[sub].p95, 0)}`}
                    hint={`P5 e P95 dos desvios em torno da média, ${r.ponta.janela_dias} dias antes do início: somados ao CMO do SDDP antes do piso e do teto`}
                  />
                ) : null}
                <MetricRow label="Crescimento 12 meses (carga · eólica · solar)" value={`${pct(100 * r.caso.crescimento_12m[sub].carga, 1)} · ${pct(100 * r.caso.crescimento_12m[sub].eolica, 1)} · ${pct(100 * r.caso.crescimento_12m[sub].solar, 1)}`} />
              </div>
            </Panel>
          </div>
          {cal ? (
            <Panel title="Aversão a risco implícita" subtitle={cal.alvo_fonte} className="mt-4">
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                <MetricRow label={`Alvo: CMO do DESSEM (${cal.sub})`} value={brl(cal.alvo, 2)} hint={`demais: ${SUBS.filter((x) => x !== cal.sub).map((x) => `${x} ${brl(cal.alvo_por_sub[x], 0)}`).join(" · ")}`} />
                <MetricRow label="CMO do 1º estágio com o λ implícito" value={brl(cal.cmo, 2)} tone={Math.abs(cal.cmo - cal.alvo) <= cal.tolerancia ? "good" : "warning"} hint={`tolerância ${brl(cal.tolerancia, 0)}`} />
                <MetricRow
                  label="λ implícito do CVaR"
                  value={num(cal.lambda, 3)}
                  tone={cal.limite ? "warning" : "good"}
                  hint={
                    cal.limite
                      ? cal.limite === "teto"
                        ? "no fim do caminho (λ 0,99 e piso do SE +40 p.p.): o SDDP não alcança o alvo"
                        : "no valor esperado (λ 0): o SDDP fica acima do alvo"
                      : `padrão da CPAMP ${num(cal.lambda_padrao, 2)}, α ${pct(100 * r.params.cvar_alpha, 0)}`
                  }
                />
                <MetricRow
                  label="Piso do SE elevado"
                  value={cal.piso_pp ? `+${num(cal.piso_pp, 1)} p.p.` : "não"}
                  tone="muted"
                  hint="2ª alavanca, só quando o λ satura: o análogo do volume mínimo operativo dos modelos oficiais"
                />
                <MetricRow
                  label="Rodadas do SDDP na busca"
                  value={cal.tentativas.map((t) => `λ ${num(t.lambda, 2)}${t.piso_pp ? ` +${num(t.piso_pp, 0)} p.p.` : ""} → ${brl(t.cmo, 0)}`).join(" · ")}
                  tone="muted"
                />
              </div>
            </Panel>
          ) : null}
          <Panel title="Interligações" subtitle="Limite em cada sentido = quantil 99,5% do fluxo medido no último ano" className="mt-4">
            <Table
              label="Limites das interligações"
              head={["Interligação", "Sentido direto", "Sentido reverso", "Fluxo médio"]}
              align={["left", "right", "right", "right"]}
              rows={r.caso.intercambio.map((x) => [`${x.from} → ${x.to}`, `${num(x.direct_mw, 0)} MW`, `${num(x.reverse_mw, 0)} MW`, `${num(x.mean_mw, 0)} MW`])}
            />
          </Panel>
          <Panel title="O que este modelo faz diferente" subtitle="E o que ainda não representa" className="mt-4">
            <ul className="flex list-disc flex-col gap-2 pl-4 text-[14px] leading-relaxed text-ink-2">
              <li>O caso é montado e rodado todo dia com dados abertos, sem o deck do PMO; cada número de entrada vem com a medida que o originou.</li>
              <li>Só a ENA armazenável é água utilizável: a diferença para a bruta é o vertimento não turbinável das usinas a fio d’água (correlação de 0,95 a 0,997 com o vertimento medido usina a usina). Dentro dela, os REEs sem estoque (Belo Monte, Itaipu, Madeira, Teles Pires) viram uma usina fio d’água, turbinável mas não armazenável.</li>
              <li>O histórico de afluências desde 2000 é reconstruído na configuração de usinas de hoje (a MLT do Norte dobrou com Belo Monte): cada dia entra pela % da MLT publicada × a MLT atual do mesmo mês.</li>
              <li>O fator de aproveitamento k fecha o balanço hídrico medido usina a usina (geração + vertimento turbinável + variação do armazenamento ÷ ENA armazenável), no lugar das perdas, evaporação e retiradas que o deck oficial traz.</li>
              <li>O envelope operativo (teto e piso de armazenamento por mês) é o que o ONS efetivamente operou desde 2000: resume volumes de espera e restrições operativas sem precisar declará-los.</li>
              <li>Os limites conjuntos de recebimento e exportação vêm do intercâmbio líquido medido, capturando a simultaneidade que a soma das interligações superestima.</li>
              <li>O SDDP mensal acerta o nível do CMO mas não vê as horas de ponta do fim da tarde, quando a solar sai e o CMO horário dispara; como o PLD tem piso, a média do mês fica acima do PLD da média. O PLD com ponta soma ao CMO de cada cenário os desvios horários do DESSEM dos 30 dias anteriores e só então aplica piso, teto horário e teto estrutural: em 2025–26, com o CMO mensal realizado, isso cortou o erro do PLD mensal de 11,5 para 6,0 R$/MWh.</li>
              <li>
                O caso aberto é mais folgado que o deck oficial (sem volumes mínimos operativos, restrições usina a usina nem a previsão de vazões do DECOMP): no λ padrão, o CMO de jun/2025 saía R$ 18 com o DESSEM a R$ 212. Em vez de inventar essas peças, cada rodada calibra a aversão a risco para que o CMO do 1º estágio reproduza o CMO médio do DESSEM nas 2 semanas anteriores — primeiro o λ do CVaR e, quando ele satura, o piso de armazenamento do SE (o análogo do volume mínimo operativo) — e o SDDP leva essa leitura para o resto do horizonte, como a volatilidade implícita de uma opção.
              </li>
              <li>O PLD é validado contra o realizado na retroanálise acima, mês a mês e por horizonte, ao lado do SDDP sem calibração, da persistência, do DESSEM de 14 dias e do CMO semanal do DECOMP.</li>
              <li>Ainda não representa: cascatas usina a usina, produtividade variável com a queda, manutenção programada futura das térmicas e restrições elétricas internas aos submercados.</li>
              {data?.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Panel>
          {r.fontes.length ? (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Fontes ({r.fontes.length} arquivos do ONS):{" "}
              {[...new Set(r.fontes.map((f) => f.name))].map((n, i) => (
                <span key={n}>
                  {i ? " · " : ""}
                  <a className="text-accent hover:underline" href={r.fontes.find((f) => f.name === n)!.url} target="_blank" rel="noreferrer">
                    {n}
                  </a>
                </span>
              ))}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge level={data?.stale ? "warning" : "good"}>{data?.stale ? "atrasado" : "em dia"}</Badge>
            <span className="text-[12px] text-muted">rodado {ago(Date.parse(r.generatedAt))} · dados até {dayLabel(r.asof)}</span>
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
