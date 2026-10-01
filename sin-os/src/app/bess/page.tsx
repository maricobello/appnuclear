"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BatteryCharging, Download, Gauge, RefreshCw, TrendingDown, Wallet, Zap } from "lucide-react";
import {
  dailyRevenueOption,
  flowOption,
  fmtMoney,
  marginOption,
  n0,
  n1,
  n2,
  ParamPanel,
  sensitivityOption,
  SocRing,
  SpecCard,
  spreadDurationOption,
} from "@/components/bess/BessViews";
import { ChartFrame } from "@/components/EChart";
import { AnimatedNumber } from "@/components/motion";
import { Button, ErrorBox, MetricRow, Panel, PageHeader, Segmented, SourceTag } from "@/components/ui";
import type { BessResp } from "@/lib/apiTypes";
import { assetQuery, saveAsset, useAsset } from "@/lib/asset";
import type { RefMode } from "@/lib/market/bess-study";
import { toCsv } from "@/lib/csv";
import { brl, pct } from "@/lib/fmt";
import { brtHour } from "@/lib/sources/time";
import { useApi } from "@/lib/useApi";
import { useNow } from "@/lib/useNow";

/** Link "Simular" da Sala de Comando traz ?sub=XX: aplica ao ativo e limpa a URL. */
function SubFromUrl() {
  const sp = useSearchParams();
  const router = useRouter();
  const asset = useAsset();
  const sub = sp.get("sub");
  useEffect(() => {
    if ((sub === "SE" || sub === "S" || sub === "NE" || sub === "N") && sub !== asset.sub) saveAsset({ ...asset, sub });
    if (sub) router.replace("/bess");
  }, [sub, asset, router]);
  return null;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BessPage() {
  const asset = useAsset();
  const now = useNow();
  const q = useApi<BessResp>(`/api/bess?${assetQuery(asset)}`, 900_000);
  const b = q.data;
  const busy = q.isValidating;
  const f = b?.finance;
  const p = b?.params;

  const [refMode, setRefMode] = useState<RefMode>("auto");
  const ref = b?.refDays?.[refMode] ?? b?.refDay ?? null;
  const flowOpt = useMemo(() => flowOption(ref), [ref]);
  const marginOpt = useMemo(() => (b ? marginOption(b, ref) : null), [b, ref]);
  const idle = ref ? ref.chargeMW.every((v) => v < 1e-6) && ref.dischargeMW.every((v) => v < 1e-6) : false;
  const dailyOpt = useMemo(() => (b ? dailyRevenueOption(b) : null), [b]);
  const durOpt = useMemo(() => (b ? spreadDurationOption(b) : null), [b]);
  const sensOpt = useMemo(() => (b ? sensitivityOption(b) : null), [b]);

  // SOC na hora corrente do dia de referência (programado, se for amanhã)
  const hNow = now ? brtHour(now) : 0;
  const soc = ref ? ref.soc[Math.min(23, hNow)] : null;
  const E = p?.capacityMWh ?? asset.cap;
  const eta = Math.sqrt((p?.rte ?? asset.rte / 100) as number);
  const refCharged = ref ? ref.chargeMW.reduce((a, v) => a + v, 0) : null;
  const refDischarged = ref ? ref.dischargeMW.reduce((a, v) => a + v, 0) : null;
  const scale = b ? 365 / Math.max(1, b.full.days) : 1;
  const irrTone = f ? (f.irr !== null && p && f.irr >= p.waccPct / 100 ? "good" : f.irr !== null ? "warning" : "critical") : undefined;

  const exportCsv = () => {
    if (!b) return;
    download(
      `sinos-bess-${b.params.sub}-${b.window.to}.csv`,
      toCsv(
        ["data", "receita_otima_rs", "receita_politica_simples_rs", "energia_carregada_mwh", "energia_descarregada_mwh", "ciclos", "horas_operando", "spread_rs_mwh"],
        b.daily.map((d) => [d.date, d.revenue.toFixed(2), d.naive.toFixed(2), d.chargedMWh.toFixed(2), d.dischargedMWh.toFixed(2), d.cycles.toFixed(3), d.opHours, d.spread.toFixed(2)]),
        `SIN OS - BESS ${b.params.powerMW}MW/${b.params.capacityMWh}MWh PLD ${b.params.sub} ${b.window.from}..${b.window.to}; despacho otimo diario (HiGHS)`,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <Suspense fallback={null}>
        <SubFromUrl />
      </Suspense>
      <PageHeader
        title={`Sistema BESS — ${asset.name}`}
        subtitle={`Arbitragem de energia e otimização de receita no PLD ${asset.sub} real: despacho ótimo dia a dia (LP exato, HiGHS) nos últimos ${b?.window.days ?? asset.days} dias e modelo econômico com LCOS → CAPEX implícito → VPL, TIR e payback.`}
        right={
          <>
            {b ? <span className="text-[11px] text-muted">janela {b.window.from.split("-").reverse().join("/")} → {b.window.to.split("-").reverse().join("/")}</span> : null}
            <SourceTag meta={b?.meta} staleAfterMs={2 * 3600_000} />
            <Button onClick={exportCsv} disabled={!b} title="Resultados diários em CSV">
              <Download size={12} aria-hidden /> CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 xl:flex-row">
        {/* parâmetros: primeiro no celular, à direita no desktop */}
        <aside className="order-first xl:order-last xl:w-[272px] xl:shrink-0">
          <div className="xl:sticky xl:top-16">
            <ParamPanel key={JSON.stringify(asset)} initial={asset} onApply={saveAsset} busy={busy} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {q.error && !b ? <ErrorBox error={q.error} onRetry={() => q.mutate()} /> : null}
          {b?.notes.length ? (
            <div role="note" className="rounded-md border-l-2 border-l-warning bg-warning/[0.06] px-3 py-1.5 text-[11.5px] leading-snug text-ink-2">
              {b.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          ) : null}

          {/* KPIs do ativo */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
            <SpecCard Icon={Zap} label="Potência" value={n1.format(asset.pow)} unit="MW" caption="capacidade de carga/descarga" />
            <SpecCard Icon={BatteryCharging} label="Energia" value={n1.format(asset.cap)} unit="MWh" caption={`duração ${n1.format(asset.cap / asset.pow)} h`} delay={0.03} />
            <SpecCard Icon={RefreshCw} label="Eficiência ida-volta" value={n1.format(asset.rte)} unit="%" caption={`perdas totais ${n1.format(100 - asset.rte)}%`} delay={0.06} />
            <SpecCard Icon={TrendingDown} label="Degradação" value={n2.format(asset.deg)} unit="% ao ano" caption={`vida útil ${asset.life} anos`} delay={0.09} />
            <SpecCard Icon={Wallet} label="Custo nivelado" value={n2.format(asset.lcos)} unit="R$/MWh" caption={f ? `CAPEX implícito ${brl(f.capexPerKWh, 0)}/kWh` : "CAPEX + OPEX + degradação"} delay={0.12} />
          </div>

          {/* fluxo + resumos */}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-12">
            <Panel
              className="2xl:col-span-8"
              title="Fluxo de energia — BESS"
              subtitle={ref ? `${ref.label} (${ref.date.split("-").reverse().join("/")}) · receita do dia ${brl(ref.revenue, 0)} · barras: potência na rede · tracejado: SOC` : "carregando…"}
              right={
                <Segmented
                  label="Dia de referência"
                  value={refMode}
                  onChange={setRefMode}
                  size="xs"
                  options={[
                    { value: "auto", label: "Publicado" },
                    { value: "median", label: "Mediano" },
                    { value: "best", label: "Melhor" },
                  ]}
                />
              }
            >
              {idle ? (
                <p className="mb-2 rounded-[4px] border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted">
                  Sem operação neste dia: o PLD ficou plano (spread {brl(Math.max(...ref!.price) - Math.min(...ref!.price))}) e não cobre as perdas. Veja o dia <button className="text-accent hover:underline" onClick={() => setRefMode("median")}>mediano</button> ou o <button className="text-accent hover:underline" onClick={() => setRefMode("best")}>melhor</button> da janela.
                </p>
              ) : null}
              <ChartFrame option={flowOpt} loading={q.isLoading} error={q.error} onRetry={() => q.mutate()} height={idle ? 308 : 340} label="Fluxo de energia do BESS" dim={busy && !!b} />
            </Panel>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:col-span-4 2xl:grid-cols-1">
              <Panel title="Resumo operacional" subtitle={b ? `dia de referência · média de ${b.full.days} dias` : undefined}>
                <MetricRow label="Energia carregada" hint="dia" value={refCharged === null ? "—" : `${n1.format(refCharged)} MWh`} />
                <MetricRow label="Energia descarregada" hint="dia" value={refDischarged === null ? "—" : `${n1.format(refDischarged)} MWh`} />
                <MetricRow label="Ciclos por dia" hint="média" value={b ? n2.format(b.full.cyclesPerDay) : "—"} />
                <MetricRow label="Tempo médio de operação" value={b ? `${n1.format(b.full.opHoursPerDay)} h/dia` : "—"} />
                <MetricRow label="Energia movimentada" hint="ano" value={b ? `${n0.format((b.full.chargedMWh + b.full.dischargedMWh) * scale)} MWh` : "—"} />
              </Panel>
              <Panel title="Receita estimada" subtitle="arbitragem no PLD realizado">
                <MetricRow label="Arbitragem" hint="média 30 d" value={b ? <AnimatedNumber value={b.last30.revenuePerDay} format={(v) => `${brl(v, 0)}/dia`} /> : "—"} />
                <MetricRow label="Receita mensal" hint="média" value={b ? fmtMoney((b.full.revenue * scale) / 12) : "—"} />
                <MetricRow label="Receita anual" hint="ano 1" value={f ? fmtMoney(f.revenueYear1) : "—"} />
                <MetricRow label="Payback" value={f ? (f.paybackYears === null ? "não se paga" : `${n1.format(f.paybackYears)} anos`) : "—"} tone={f ? (f.paybackYears === null ? "critical" : undefined) : undefined} />
              </Panel>
            </div>
          </div>

          {/* SOC · margem · financeiro */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-12">
            <Panel className="2xl:col-span-3" title="Estado de carga (SOC)" subtitle={ref ? `às ${String(hNow).padStart(2, "0")}h · ${ref.label}` : undefined}>
              <div className="flex flex-col items-center gap-3">
                <SocRing soc={soc ?? 0} />
                <div className="grid w-full grid-cols-2 gap-1.5">
                  {[
                    ["Armazenada", soc === null ? "—" : `${n1.format(soc * E)} MWh`],
                    ["Livre p/ carga", soc === null ? "—" : `${n1.format((1 - soc) * E)} MWh`],
                    ["Injetável (×η)", soc === null ? "—" : `${n1.format(soc * E * eta)} MWh`],
                    ["Capacidade total", `${n1.format(E)} MWh`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[4px] border border-line px-2 py-1.5">
                      <div className="text-[10px] text-muted">{k}</div>
                      <div className="tnum text-[12.5px] font-semibold text-ink">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
            <Panel className="2xl:col-span-5" title="Margem de arbitragem" subtitle={b ? `preços médios ponderados pela energia em ${b.full.days} dias` : undefined}>
              <ChartFrame option={marginOpt} loading={q.isLoading} error={q.error} height={150} label="Preço do dia com horas de compra e venda" />
              {b ? (
                <div className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  <MetricRow label="Preço de compra" value={brl(b.margin.avgBuy)} />
                  <MetricRow label="Preço de venda" value={brl(b.margin.avgSell)} />
                  <MetricRow label="Spread bruto" value={brl(b.margin.spread)} />
                  <MetricRow label="Spread líquido" hint="perdas" value={brl(b.margin.netSpread)} />
                  <MetricRow label="Custo do BESS" hint="LCOS" value={brl(b.margin.lcos)} />
                  <MetricRow label="Margem líquida" hint="/MWh" value={brl(b.margin.netMargin)} tone={b.margin.netMargin !== null && b.margin.netMargin >= 0 ? "good" : "critical"} />
                </div>
              ) : null}
            </Panel>
            <Panel className="md:col-span-2 2xl:col-span-4" title="Indicadores financeiros" subtitle={p ? `WACC real ${n1.format(p.waccPct)}% · ${p.lifeYears} anos · OPEX ${n1.format(p.opexPctCapex)}% do CAPEX/ano` : undefined}>
              <MetricRow label="Custo nivelado (LCOS)" hint="informado" value={p ? `${n2.format(p.lcos)} R$/MWh` : "—"} />
              <MetricRow label="LCOS efetivo" hint="despacho real" value={f?.effectiveLcos ? `${n2.format(f.effectiveLcos)} R$/MWh` : "—"} />
              <MetricRow label="LCOS de equilíbrio" hint="VPL = 0" value={f ? `${n2.format(f.breakevenLcos)} R$/MWh` : "—"} tone={f && p ? (f.breakevenLcos >= p.lcos ? "good" : "warning") : undefined} />
              <MetricRow label="CAPEX implícito" value={f ? `${fmtMoney(f.capex)} · ${brl(f.capexPerKWh, 0)}/kWh` : "—"} />
              <MetricRow label="Receita anual" value={f ? fmtMoney(f.revenueYear1) : "—"} />
              <MetricRow label="TIR (estimada)" value={f ? (f.irr === null ? "não se paga" : pct(100 * f.irr)) : "—"} tone={irrTone} />
              <MetricRow label="VPL" value={f ? fmtMoney(f.npv) : "—"} tone={f ? (f.npv >= 0 ? "good" : "critical") : undefined} />
              <MetricRow label="Payback" value={f ? (f.paybackYears === null ? "não se paga" : `${n1.format(f.paybackYears)} anos`) : "—"} />
              <MetricRow label="ROI" hint="vida útil" value={f ? pct(100 * f.roi) : "—"} tone={f ? (f.roi >= 0 ? "good" : "critical") : undefined} />
            </Panel>
          </div>

          {/* cenários + sensibilidade */}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-12">
            <Panel className="2xl:col-span-8" title="Simulação — resultados por cenário" subtitle="mesma janela de PLD; varia eficiência, degradação, custo e política de despacho" bodyClassName="px-1 pb-1">
              {b ? (
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-line-strong">
                        {["Cenário", "Potência", "Energia", "Eficiência", "Degradação", "R$/MWh", "Receita anual", "Payback", "TIR", "VPL"].map((h, i) => (
                          <th key={h} className={`eyebrow whitespace-nowrap px-2 py-1.5 font-semibold ${i ? "text-right" : "text-left"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {b.scenarios.map((s) => {
                        const std = s.name === "Padrão";
                        return (
                          <tr key={s.name} className={`border-b border-line/60 last:border-0 ${std ? "bg-accent/[0.07] outline outline-1 -outline-offset-1 outline-accent/40" : "hover:bg-surface-2"}`}>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              <span className={`block ${std ? "font-semibold text-accent" : "text-ink"}`}>{std ? "Padrão (atual)" : s.name}</span>
                              <span className="block text-[10px] leading-tight text-muted">{s.policy}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink-2">{n0.format(s.powerMW)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink-2">{n0.format(s.capacityMWh)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink-2">{n1.format(100 * s.rte)}%</td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink-2">{n2.format(s.degPctYear)}%</td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink-2">{n2.format(s.lcos)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-ink">{fmtMoney(s.revenueYear)}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${s.paybackYears === null ? "text-critical" : "text-ink-2"}`}>{s.paybackYears === null ? "não se paga" : `${n1.format(s.paybackYears)} a`}</td>
                            <td className={`px-2 py-1.5 text-right font-mono font-semibold ${s.irr === null ? "text-critical" : p && s.irr >= p.waccPct / 100 ? "text-good" : "text-warning"}`}>{s.irr === null ? "—" : pct(100 * s.irr)}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${s.npv >= 0 ? "text-good" : "text-critical"}`}>{fmtMoney(s.npv)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ChartFrame option={null} loading={q.isLoading} error={q.error} height={120} label="Cenários" />
              )}
            </Panel>
            <Panel className="2xl:col-span-4" title="Sensibilidade · TIR × custo nivelado" subtitle="mesma receita; linhas: WACC, LCOS atual e de equilíbrio">
              <ChartFrame option={sensOpt} loading={q.isLoading} error={q.error} height={170} label="Sensibilidade da TIR ao LCOS" />
            </Panel>
          </div>

          {/* histórico */}
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-12">
            <Panel className="2xl:col-span-8" title="Receita diária" subtitle={b ? `despacho ótimo vs. política simples · ${b.full.days} dias de PLD ${b.params.sub}` : undefined} right={<Gauge size={13} className="text-muted" aria-hidden />}>
              <ChartFrame option={dailyOpt} loading={q.isLoading} error={q.error} height={200} label="Receita diária do BESS" dim={busy && !!b} />
            </Panel>
            <Panel className="2xl:col-span-4" title="Curva de duração do spread diário" subtitle="% dos dias com spread (máx − mín) acima de cada valor">
              <ChartFrame option={durOpt} loading={q.isLoading} error={q.error} height={200} label="Curva de duração do spread diário" />
            </Panel>
          </div>
          <p className="px-1 text-[10.5px] leading-snug text-muted">
            Modelo: despacho diário começa e termina vazio, até {p ? n2.format(p.maxCyclesPerDay) : asset.maxc} ciclo(s)/dia, eficiência dividida igualmente entre carga e descarga (√η). O PLD horário é publicado na véspera, então o ótimo diário é implementável; a receita supõe liquidação no MCP ao PLD (a regulação de armazenamento na CCEE ainda está em definição). LCOS por MWh entregue; CAPEX implícito pelo perfil de {p ? n2.format(p.refCyclesPerDay) : asset.ref} ciclo(s)/dia.
          </p>
        </div>
      </div>
    </div>
  );
}
