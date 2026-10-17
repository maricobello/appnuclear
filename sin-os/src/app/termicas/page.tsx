"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Disclosure, Empty, ErrorBox, Kpi, Loading, MetricRow, PageHeader, Panel, Segmented, SimBanner, sourceState, Table } from "@/components/ui";
import type { TermicasResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { brl, dateTime, dayLabel, num, pct } from "@/lib/fmt";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

// o ONS publica o despacho de um dia no fim da tarde do seguinte
const STALE_MS = 54 * 3600_000;
const DAYS_OPTS = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "28", label: "28d" },
];
const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));
const REASON_COLOR: Record<string, string> = {
  merit: C.series[0],
  inflex: C.ink2,
  uc: C.series[1],
  electric: C.series[4],
  security: C.series[7],
  gfom: C.series[5],
  reserve: C.series[3],
  losses: C.series[6],
  gsub: C.series[2],
  export: C.accent2,
};
const ESS_COLOR: Record<string, string> = { uc: C.series[1], electric: C.series[4], security: C.series[7], off: C.series[2] };
const mi = (v: number) => v / 1e6;

export default function TermicasPage() {
  const [days, setDays] = useState("7");
  const [sub, setSub] = useState<Sub>("SE");
  const { data, error, isValidating, mutate } = useApi<TermicasResp>(`/api/termicas?dias=${days}`, 15 * 60_000);
  const r = data?.report ?? null;
  const state = sourceState(data?.meta.termica, STALE_MS);
  const stack = r?.merit.find((m) => m.sub === sub) ?? null;
  const reasonLabel = useMemo(() => Object.fromEntries((data?.reasons ?? []).map((x) => [x.key, x.label])), [data?.reasons]);

  const byReason = useMemo<ChartOption | null>(() => {
    if (!r?.days.length || !data) return null;
    const used = data.reasons.filter((x) => r.days.some((d) => d.reasons[x.key as keyof typeof d.reasons] > 0.5));
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${num(v, 0)} MWmed` },
      xAxis: categoryAxis(r.days.map((d) => dayLabel(d.date))),
      yAxis: valueAxis("MWmed", { scale: false }),
      series: used.map((x) => ({
        name: x.label,
        type: "bar",
        stack: "g",
        barMaxWidth: 28,
        itemStyle: { color: REASON_COLOR[x.key] ?? C.muted },
        data: r.days.map((d) => Math.round(d.reasons[x.key as keyof typeof d.reasons])),
      })),
    };
  }, [r, data]);

  const essDaily = useMemo<ChartOption | null>(() => {
    if (!r?.days.length || !data || !data.meta.pld.ok) return null;
    const keys = (["uc", "electric", "security", "off"] as const).filter((k) => r.days.some((d) => d.ess[k] > 0));
    if (!keys.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `R$ ${num(v, 2)} mi` },
      xAxis: categoryAxis(r.days.map((d) => dayLabel(d.date))),
      yAxis: valueAxis("R$ mi", { scale: false }),
      series: keys.map((k) => ({ name: data.essLabel[k], type: "bar", stack: "e", barMaxWidth: 28, itemStyle: { color: ESS_COLOR[k] }, data: r.days.map((d) => Math.round(mi(d.ess[k]) * 100) / 100) })),
    };
  }, [r, data]);

  const merit = useMemo<ChartOption | null>(() => {
    if (!stack?.steps.length) return null;
    let acc = 0;
    const line: [number, number][] = [];
    const pts: { value: [number, number]; name: string; avail: number; gen: number; reason: string | null; fuel: string; itemStyle: { color: string } }[] = [];
    for (const s of stack.steps) {
      line.push([acc, s.cvu]);
      const mid = acc + s.avail / 2;
      acc += s.avail;
      line.push([acc, s.cvu]);
      const color = s.gen <= 0.5 ? C.muted : s.reason === "merit" ? C.series[0] : C.series[1];
      pts.push({ value: [mid, s.cvu], name: s.name, avail: s.avail, gen: s.gen, reason: s.reason, fuel: s.fuel, itemStyle: { color } });
    }
    const top = Math.max(...stack.steps.map((s) => s.cvu), stack.cmo ?? 0);
    return {
      ...baseOption(),
      tooltip: {
        ...baseOption().tooltip,
        trigger: "item",
        formatter: (p: { seriesType: string; data: (typeof pts)[number] }) =>
          p.seriesType !== "scatter"
            ? ""
            : `<b>${p.data.name}</b> · ${p.data.fuel}<br/>CVU ${brl(p.data.value[1])}/MWh<br/>disponível ${num(p.data.avail, 0)} MW · gerando ${num(p.data.gen, 0)} MW${p.data.reason ? `<br/>${reasonLabel[p.data.reason] ?? p.data.reason}` : ""}`,
      },
      grid: { ...baseOption().grid, right: 12, bottom: 30 },
      xAxis: { type: "value", name: "MW disponíveis (acumulado)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.muted, fontSize: 11 }, axisLabel: { color: C.muted, fontSize: 11 }, splitLine: { show: false }, axisLine: { lineStyle: { color: C.grid } } },
      yAxis: valueAxis("CVU · R$/MWh", { scale: false, max: Math.ceil((top * 1.1) / 100) * 100 }),
      series: [
        { name: "Custo por usina", type: "line", step: false, symbol: "none", data: line, lineStyle: { color: C.ink2, width: 1.5 }, areaStyle: { color: C.inkSoft }, silent: true, z: 1 },
        {
          name: "Usinas",
          type: "scatter",
          symbolSize: 9,
          data: pts,
          z: 3,
          markLine:
            stack.cmo !== null
              ? { symbol: "none", silent: true, data: [{ yAxis: stack.cmo, name: "CMO" }], lineStyle: { color: C.warning, type: [6, 4], width: 1.5 }, label: { formatter: `CMO ${brl(stack.cmo, 0)}`, color: C.warning, position: "insideEndTop" } }
              : undefined,
        },
      ],
      legend: { show: false },
    };
  }, [stack, reasonLabel]);

  const t = r?.totals ?? null;
  const tot = (k: "uc" | "electric" | "security" | "off") => (t ? mi(t.ess[k]) : null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Térmicas & encargos"
        subtitle="Quanto as térmicas geraram e por quê, quem marca o preço e quanto o despacho fora da ordem de mérito custa em encargos (ESS)."
        right={<Segmented label="Janela" value={days} options={DAYS_OPTS} onChange={setDays} />}
      />
      <SimBanner metas={[data?.meta.termica, data?.meta.pld, data?.meta.cmo]} label="ONS" staleAfterMs={STALE_MS} />
      {error && !data ? <ErrorBox error={error} onRetry={() => mutate()} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Geração térmica" value={t?.gen ?? null} format={(v) => num(v, 0)} unit="MWmed" state={state} at={data?.meta.termica.latestTs} source={r?.from ? `média de ${dayLabel(r.from)} a ${dayLabel(r.to!)}` : undefined} />
        <Kpi label="Fora da ordem de mérito" value={t?.oomShare != null ? 100 * t.oomShare : null} format={(v) => num(v, 1)} unit="% da geração" state={state} source="unit commitment, restrição elétrica, segurança energética, GFOM, reserva e perdas" />
        <Kpi label="ESS estimado" value={t ? mi(t.ess.total) : null} format={(v) => num(v, 1)} unit="R$ mi" state={sourceState(data?.meta.pld)} source={`na janela · PLD ${data?.pldOfficial ? "oficial" : "estimado pelo CMO"}`} />
        <Kpi label="ESS por MWh consumido" value={data?.essPerMwh ?? null} format={(v) => num(v, 2)} unit="R$/MWh" state={sourceState(data?.meta.balanco, STALE_MS)} source="ESS ÷ carga do SIN nos mesmos dias (balanço do ONS)" />
        <Kpi label="Constrained-off térmico" value={t ? t.offMwh / 1000 : null} format={(v) => num(v, 1)} unit="GWh" state={state} source="corte de térmicas despachadas por mérito" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Por que as térmicas geraram" subtitle="Geração verificada por motivo do despacho, MWmed por dia (ONS)">
          {byReason ? <EChart option={byReason} height={300} label="Geração térmica por motivo do despacho" dim={isValidating} /> : data ? <Empty label="Sem despacho térmico na janela." height={300} /> : <Loading height={300} />}
        </Panel>
        <Panel title="ESS estimado por dia" subtitle="max(0, CVU − PLD) × geração fora da ordem de mérito + max(0, PLD − CVU) × constrained-off">
          {essDaily ? <EChart option={essDaily} height={300} label="ESS estimado por componente e dia" dim={isValidating} /> : data ? <Empty label={data.meta.pld.ok ? "Sem encargo estimado na janela." : "PLD indisponível: ESS não estimado."} height={300} /> : <Loading height={300} />}
        </Panel>
      </div>

      <Panel
        title={`Pilha de mérito — ${SUB_NAMES[sub]}`}
        subtitle={stack ? `Usinas por CVU com a disponibilidade declarada, na hora de maior geração térmica (${dateTime(stack.ts)}) · azul: mérito · laranja: outro motivo · cinza: parada` : "Usinas por CVU com a disponibilidade declarada"}
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} size="xs" />}
      >
        {merit ? <EChart option={merit} height={320} label={`Pilha de mérito das térmicas em ${SUB_NAMES[sub]}`} dim={isValidating} /> : data ? <Empty label="Sem térmicas com CVU neste submercado." height={320} /> : <Loading height={320} />}
        {stack ? (
          <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-3">
            <MetricRow label="CMO da hora" value={stack.cmo === null ? "—" : `${brl(stack.cmo)}/MWh`} />
            <MetricRow label="Térmica marginal (CVU até o CMO)" value={stack.marginal ? `${stack.marginal.name} · ${brl(stack.marginal.cvu, 0)}` : "nenhuma"} />
            <MetricRow
              label="Próxima a ligar por mérito"
              value={stack.next ? `${stack.next.name} · ${brl(stack.next.cvu, 0)}` : "—"}
              hint={stack.next?.gapToCmo != null ? `a CMO + ${brl(stack.next.gapToCmo, 0)}` : undefined}
            />
          </div>
        ) : null}
        {stack && stack.meritAboveCmo > 1 ? (
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {num(stack.meritAboveCmo, 0)} MW classificados pelo ONS como ordem de mérito têm CVU acima do CMO desta hora: o ONS classifica o mérito na programação, com a sua referência de despacho, e não pelo CMO horário publicado.
          </p>
        ) : null}
      </Panel>

      <Panel title="Térmicas com encargo" subtitle="Geração fora da ordem de mérito e corte por usina na janela, com o ESS estimado">
        {r?.plants.length ? (
          <Table
            label="Térmicas com encargo estimado"
            head={["Usina", "Sub", "CVU", "Unit commitment", "Restrição elétrica", "Segurança", "Constrained-off", "ESS"]}
            align={["left", "left", "right", "right", "right", "right", "right", "right"]}
            rows={r.plants.map((p) => [
              <span key="n" title={p.fuel}>
                {p.name}
              </span>,
              p.sub,
              p.cvu === null ? "—" : brl(p.cvu, 0),
              p.mwh.uc ? `${num(p.mwh.uc, 0)} MWh` : "—",
              p.mwh.electric ? `${num(p.mwh.electric, 0)} MWh` : "—",
              p.mwh.security ? `${num(p.mwh.security, 0)} MWh` : "—",
              p.mwh.off ? `${num(p.mwh.off, 0)} MWh` : "—",
              data?.meta.pld.ok ? `R$ ${num(mi(p.ess), 2)} mi` : "—",
            ])}
          />
        ) : data ? (
          <Empty label="Nenhuma térmica fora da ordem de mérito ou cortada na janela." />
        ) : (
          <Loading height={140} />
        )}
      </Panel>

      <Panel title="Conferência com a CCEE" subtitle="Mesma conta rodada nos arquivos do ONS das semanas dos boletins InfoPLD (estimativa semanal de ESS da CCEE)">
        {data ? (
          <>
            <Table
              stack={false}
              label="Estimativa do modelo contra os boletins da CCEE"
              head={["Semana", "Componente", "Modelo", "CCEE", "Diferença"]}
              align={["left", "left", "right", "right", "right"]}
              rows={data.validation.flatMap((v) =>
                (["uc", "off", "electric", "security"] as const).map((k, i) => [
                  i === 0 ? (
                    <a key="b" className="text-accent hover:underline" href={v.url} target="_blank" rel="noreferrer">
                      {v.bulletin} · {dayLabel(v.week.from)}–{dayLabel(v.week.to)}
                    </a>
                  ) : (
                    ""
                  ),
                  data.essLabel[k],
                  `R$ ${num(v.model[k], 2)} mi`,
                  `R$ ${num(v.ccee[k], 2)} mi`,
                  v.ccee[k] > 0 && v.model[k] === 0 ? "fora do arquivo do ONS" : v.ccee[k] > 0 ? pct(100 * (v.model[k] / v.ccee[k] - 1), 0) : v.model[k] === 0 ? "igual" : "—",
                ]),
              )}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Unit commitment fica dentro de 3% da CCEE e constrained-off dentro de 35%. Nas duas semanas o ONS registrou zero de geração por restrição elétrica e por segurança energética, então o que a CCEE estimou nesses itens vem de componentes que o arquivo do ONS não mostra; por isso eles saem pela mesma regra mas sem
              validação.
            </p>
          </>
        ) : (
          <Loading height={120} />
        )}
      </Panel>

      <Disclosure title="Como é calculado e conferências" hint="checagens a cada leitura">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Conferências" subtitle="Feitas sobre os arquivos do ONS antes de mostrar">
            <div className="flex flex-col">
              <MetricRow label="Motivos somados × geração total (pior dia)" value={r?.checks.identityMaxGap != null ? pct(100 * r.checks.identityMaxGap, 2) : "—"} tone={r?.checks.identityMaxGap != null && r.checks.identityMaxGap <= 0.01 ? "good" : "warning"} />
              <MetricRow label="Geração com CVU da semana" value={r?.checks.cvuCoverage != null ? pct(100 * r.checks.cvuCoverage, 1) : "—"} tone={r?.checks.cvuCoverage != null && r.checks.cvuCoverage >= 0.99 ? "good" : "warning"} />
              <MetricRow label="Horas com encargo que tinham PLD" value={r?.checks.pldCoverage != null ? pct(100 * r.checks.pldCoverage, 1) : "—"} tone={r?.checks.pldCoverage === 1 ? "good" : "warning"} />
              <MetricRow label="ESS por componente na janela" value={t ? `UC ${num(tot("uc"), 1)} · elétr. ${num(tot("electric"), 1)} · seg. ${num(tot("security"), 1)} · off ${num(tot("off"), 1)} (R$ mi)` : "—"} tone="muted" />
            </div>
          </Panel>
          <Panel title="Como ler" subtitle="Regras de ressarcimento da CCEE sobre a classificação do despacho do ONS">
            <ul className="flex list-disc flex-col gap-2 pl-4 text-[14px] leading-relaxed text-ink-2">
              <li>Fora da ordem de mérito (unit commitment, restrição elétrica, segurança energética), a térmica recebe a diferença entre o seu CVU e o PLD da hora; quem paga é o consumidor, na proporção do consumo.</li>
              <li>Cortada estando na ordem de mérito (constrained-off), recebe a margem que perdeu: PLD − CVU.</li>
              <li>Só térmicas com CVU não nulo têm direito; o CVU é o do PMO da semana operativa (sábado a sexta).</li>
              {data?.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </Disclosure>
    </div>
  );
}
