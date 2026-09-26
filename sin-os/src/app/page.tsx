"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeftRight, BatteryCharging, Bot, Globe } from "lucide-react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, ErrorBox, Loading, Panel, SimBanner, SourceTag, Stat, statusLabel, statusLevel } from "@/components/ui";
import type { ArbitragemResp, AuditoriaResp, BrasilResp, PrevisaoResp } from "@/lib/apiTypes";
import { band, baseOption, C, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { ago, brl, num, pct, signed } from "@/lib/fmt";
import { SUB_NAMES, SUBS } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

function pldOption(d: BrasilResp): ChartOption {
  const p = d.pld!;
  const now = Date.now();
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
    xAxis: timeAxis(),
    yAxis: valueAxis("R$/MWh"),
    series: SUBS.map((s, k) =>
      line(`${s} · ${SUB_NAMES[s]}`, p.ts.map((t, i) => [t, p.values[s][i]]), SUB_COLOR[s], {
        z: 10 - k,
        ...(k === 0
          ? {
              markLine: { symbol: "none", silent: true, label: { color: C.muted, formatter: "agora", fontSize: 10 }, lineStyle: { color: C.muted, width: 1, type: "solid" }, data: [{ xAxis: now }] },
              markArea: { silent: true, itemStyle: { color: "rgba(255,255,255,0.025)" }, data: [[{ xAxis: now }, { xAxis: p.ts[p.ts.length - 1] }]] },
            }
          : {}),
      }),
    ),
  };
}

function fanOption(f: PrevisaoResp): ChartOption {
  const h = f.horizon;
  const hist = f.history;
  const cut = hist.ts.length - 72;
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, formatter: undefined, valueFormatter: (v: number) => brl(v) },
    legend: { ...baseOption().legend, data: ["Realizado", "LEAR (P50)", "Monte Carlo P05–P95", "P25–P75"] },
    xAxis: timeAxis(),
    yAxis: valueAxis("R$/MWh"),
    series: [
      ...band("Monte Carlo P05–P95", h.ts, h.mc.p05, h.mc.p95, C.series[0], 0.12, "a"),
      ...band("P25–P75", h.ts, h.mc.p25, h.mc.p75, C.series[0], 0.22, "b"),
      line("Realizado", hist.ts.slice(cut).map((t, i) => [t, hist.values[cut + i]]), C.ink2),
      line("LEAR (P50)", h.ts.map((t, i) => [t, h.lear[i]]), C.series[0]),
    ],
  };
}

function Opportunities({ a }: { a: ArbitragemResp }) {
  const topEu = a.eu[0];
  const topBorder = a.borders[0];
  const spread = [...a.spreads].filter((s) => s.z !== null).sort((x, y) => Math.abs(y.z!) - Math.abs(x.z!))[0];
  const items = [
    {
      Icon: BatteryCharging,
      title: `BESS ${a.bess.spec.powerMW} MW / ${a.bess.spec.capacityMWh} MWh no PLD ${a.sub}`,
      value: brl(a.bess.lsmcRS, 0),
      detail: `7 dias · política LSMC (intrínseco ${brl(a.bess.intrinsicRS, 0)} + opcionalidade ${brl(a.bess.extrinsicRS, 0)}) · pior 5%: ${brl(-a.bess.risk.cvar95, 0)}`,
      level: a.bess.lsmcRS > 0 ? ("good" as const) : ("neutral" as const),
    },
    topEu && {
      Icon: Globe,
      title: `Bateria 1 MW/2 MWh — ${topEu.name} (${topEu.bzn})`,
      value: `€ ${num(topEu.bessEurPerMWDay, 0)}/MW·dia`,
      detail: `entrega ${topEu.date} · spread ${num(topEu.max - topEu.min, 0)} €/MWh · ${num(topEu.negativeHours, 1)} h negativas`,
      level: "good" as const,
    },
    topBorder && {
      Icon: ArrowLeftRight,
      title: `Congestionamento ${topBorder.from} ⇄ ${topBorder.to}`,
      value: `€ ${num(Math.max(topBorder.ftrFromTo, topBorder.ftrToFrom), 0)}/MW·dia`,
      detail: `valor intrínseco de FTR · spread médio ${signed(topBorder.avgSpread, 1)} €/MWh · ${num(topBorder.congestedPct, 0)}% dos intervalos congestionados`,
      level: "neutral" as const,
    },
    spread && {
      Icon: ArrowLeftRight,
      title: `Spread ${spread.a}−${spread.b} (z = ${num(spread.z, 2)})`,
      value: brl(spread.current, 2),
      detail: `${spread.signal}${spread.halfLifeH ? ` · meia-vida ${num(spread.halfLifeH, 1)} h` : ""}`,
      level: Math.abs(spread.z ?? 0) > 2 ? ("warning" as const) : ("neutral" as const),
    },
  ].filter(Boolean) as { Icon: typeof Globe; title: string; value: string; detail: string; level: "good" | "neutral" | "warning" }[];
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
          <it.Icon size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-ink-2">{it.title}</span>
              <span className="shrink-0 text-sm font-semibold text-ink">{it.value}</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{it.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  const br = useApi<BrasilResp>("/api/brasil", 60_000);
  const fc = useApi<PrevisaoResp>("/api/previsao?sub=SE", 600_000);
  const arb = useApi<ArbitragemResp>("/api/arbitragem?sub=SE", 300_000);
  const audit = useApi<AuditoriaResp>("/api/auditoria", 30_000);

  const pldOpt = useMemo(() => (br.data?.pld ? pldOption(br.data) : null), [br.data]);
  const fanOpt = useMemo(() => (fc.data ? fanOption(fc.data) : null), [fc.data]);
  const d = br.data;
  const earSE = d?.ear?.values.SE.filter((v): v is number => v !== null);
  const run = audit.data?.latest;
  const report = audit.data?.reports?.[0];

  return (
    <div className="flex flex-col gap-4">
      <SimBanner metas={[d?.meta.pld, d?.meta.cmo, d?.meta.ear, d?.meta.ena, d?.meta.load]} />
      {br.error && !d ? <ErrorBox error={br.error} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(d?.kpis ?? SUBS.map((s) => ({ sub: s, now: null, dayAgo: null, spark: [], tomorrowAvg: null, at: null, todayAvg: null }))).map((k) => (
          <Stat
            key={k.sub}
            label={`PLD ${k.sub} · ${SUB_NAMES[k.sub]}`}
            swatch={SUB_COLOR[k.sub]}
            value={num(k.now, 2)}
            unit="R$/MWh"
            delta={k.now !== null && k.dayAgo !== null ? `${signed(k.now - k.dayAgo, 2)} vs mesma hora ontem` : null}
            hint={k.tomorrowAvg !== null ? `D+1 publicado: média ${brl(k.tomorrowAvg)}` : undefined}
            spark={k.spark}
            sparkColor={SUB_COLOR[k.sub]}
          />
        ))}
        <Stat
          label="Reservatórios SE/CO (EAR)"
          value={pct(earSE?.[earSE.length - 1])}
          delta={earSE && earSE.length > 8 ? `${signed(earSE[earSE.length - 1] - earSE[earSE.length - 8], 1)} p.p. em 7 dias` : null}
          deltaGood={earSE && earSE.length > 8 ? earSE[earSE.length - 1] >= earSE[earSE.length - 8] : null}
          spark={d?.ear?.values.SE.slice(-60)}
          sparkColor={C.series[0]}
        />
        <Stat
          label="Saúde das APIs"
          value={run ? `${run.overallScore}` : "—"}
          unit="/100"
          delta={run ? `${run.counts.ok} ok · ${run.counts.degraded} degradadas · ${run.counts.down} fora` : "execute a primeira auditoria"}
          hint={run ? `última execução ${ago(run.startedAt)}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="PLD horário por submercado"
          subtitle={`Últimos 10 dias + dia seguinte já publicado (área sombreada). Limites 2026: ${brl(d?.limits.min)} a ${brl(d?.limits.maxHourly)}.`}
          right={<SourceTag meta={d?.meta.pld} />}
        >
          {pldOpt ? <EChart option={pldOpt} height={300} label="PLD horário por submercado" dim={br.isValidating && !!br.data} /> : <Loading />}
        </Panel>
        <Panel title="Oportunidades agora" subtitle="Ranqueadas pelos modelos de arbitragem" right={<Link href="/arbitragem" className="text-xs text-accent hover:underline">detalhes →</Link>}>
          {arb.data ? <Opportunities a={arb.data} /> : arb.error ? <ErrorBox error={arb.error} /> : <Loading height={220} />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Previsão PLD SE — 7 dias"
          subtitle={fc.data ? `LEAR + Monte Carlo MRJD · rMAE ${num(fc.data.backtest.rmae, 2)} vs ingênuo · cobertura ACI ${pct(100 * fc.data.backtest.aci.coverage, 0)}` : "calibrando…"}
          right={<Link href="/previsao" className="text-xs text-accent hover:underline">modelos →</Link>}
        >
          {fanOpt ? <EChart option={fanOpt} height={260} label="Leque de previsão do PLD SE" /> : fc.error ? <ErrorBox error={fc.error} /> : <Loading height={260} />}
        </Panel>
        <Panel title="Status das APIs públicas" subtitle={run ? `auditoria ${ago(run.startedAt)} · persistência: ${audit.data?.storage === "firestore" ? "Firestore" : "memória"}` : "sem auditoria ainda"} right={<Link href="/auditoria" className="text-xs text-accent hover:underline">auditor →</Link>}>
          {run ? (
            <ul className="grid grid-cols-1 gap-1.5">
              {run.sources.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-2">
                    {s.name} <span className="text-muted">· {s.provider.split(" —")[0]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tnum text-muted">{s.latencyMs !== null ? `${s.latencyMs} ms` : ""}</span>
                    <Badge level={statusLevel(s.status)}>{statusLabel[s.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              Nenhuma auditoria registrada. Abra o <Link href="/auditoria" className="text-accent">Agente auditor</Link> e clique em “Rodar auditoria”.
            </p>
          )}
        </Panel>
        <Panel title="Agente auditor (IA)" subtitle={report ? `${report.model} · ${ago(report.createdAt)}` : audit.data?.agent.configured ? "aguardando primeira análise" : "configure ANTHROPIC_API_KEY"} right={<Bot size={16} className="text-muted" aria-hidden />}>
          {report ? (
            <div className="flex flex-col gap-2 text-xs">
              <Badge level={report.severity === "critical" ? "critical" : report.severity === "warning" ? "warning" : "good"}>{report.severity}</Badge>
              <p className="leading-relaxed text-ink-2">{report.summary}</p>
              <ul className="flex flex-col gap-1">
                {report.findings.slice(0, 4).map((f, i) => (
                  <li key={i} className="text-muted">
                    <span className="text-ink-2">{f.sourceId}</span> — {f.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted">
              O agente usa Claude com ferramentas (re-sonda endpoints, lê o histórico no Firestore, inspeciona amostras e checa PLD×CMO) e gera um relatório com causa provável e ação recomendada sempre que a auditoria detecta degradação.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
