"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
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
  spreadDurationOption,
} from "@/components/bess/BessViews";
import { ChartFrame } from "@/components/EChart";
import { Button, Disclosure, ErrorBox, MetricRow, Panel, PageHeader, Segmented, SimBanner, Stat, Table } from "@/components/ui";
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
    <div className="flex flex-col gap-5">
      <Suspense fallback={null}>
        <SubFromUrl />
      </Suspense>
      <PageHeader
        title="BESS"
        subtitle={`${asset.name}: arbitragem no PLD ${asset.sub} real dos últimos ${b?.window.days ?? asset.days} dias, com despacho ótimo e retorno financeiro.`}
        right={
          <Button onClick={exportCsv} disabled={!b} title="Resultados diários em CSV">
            <Download size={14} aria-hidden /> Baixar CSV
          </Button>
        }
      />
      <SimBanner metas={[b?.meta]} label="PLD" staleAfterMs={2 * 3600_000} />

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* parâmetros: primeiro no celular, à direita no desktop */}
        <aside className="order-first xl:order-last xl:w-[288px] xl:shrink-0" aria-label="Parâmetros do ativo">
          <div className="xl:sticky xl:top-6">
            <ParamPanel key={JSON.stringify(asset)} initial={asset} onApply={saveAsset} busy={busy} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {q.error && !b ? <ErrorBox error={q.error} onRetry={() => q.mutate()} /> : null}
          {b?.notes.length ? (
            <div role="note" className="rounded-2xl bg-warning/12 px-4 py-3 text-[13px] leading-snug text-ink-2">
              {b.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Receita por dia" value={b ? brl(b.last30.revenuePerDay, 0) : "—"} hint="média dos últimos 30 dias" />
            <Stat label="Receita anual" value={f ? fmtMoney(f.revenueYear1) : "—"} hint={f && f.capacityRevenueYear > 0 ? `+ ${fmtMoney(f.capacityRevenueYear)} de capacidade` : "arbitragem, ano 1"} />
            <Stat label="TIR" value={f ? (f.irr === null ? "não se paga" : pct(100 * f.irr)) : "—"} hint={p ? `WACC ${n1.format(p.waccPct)}%` : undefined} />
            <Stat label="Payback" value={f ? (f.paybackYears === null ? "não se paga" : `${n1.format(f.paybackYears)} anos`) : "—"} hint={p ? `vida útil ${p.lifeYears} anos` : undefined} />
          </div>

          <Panel
            title="Fluxo de energia"
            subtitle={ref ? `${ref.label} (${ref.date.split("-").reverse().join("/")}) · receita do dia ${brl(ref.revenue, 0)}` : "Carregando…"}
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
              <p className="mb-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-muted">
                Sem operação neste dia: o PLD ficou plano (spread {brl(Math.max(...ref!.price) - Math.min(...ref!.price))}) e não cobre as perdas. Veja o dia <button className="text-accent hover:underline" onClick={() => setRefMode("median")}>mediano</button> ou o <button className="text-accent hover:underline" onClick={() => setRefMode("best")}>melhor</button> da janela.
              </p>
            ) : null}
            <ChartFrame option={flowOpt} loading={q.isLoading} error={q.error} onRetry={() => q.mutate()} height={idle ? 300 : 330} label="Fluxo de energia do BESS" dim={busy && !!b} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Operação" subtitle={b ? `Dia de referência e média de ${b.full.days} dias` : undefined}>
              <MetricRow label="Energia carregada" hint="dia" value={refCharged === null ? "—" : `${n1.format(refCharged)} MWh`} />
              <MetricRow label="Energia descarregada" hint="dia" value={refDischarged === null ? "—" : `${n1.format(refDischarged)} MWh`} />
              <MetricRow label="Ciclos por dia" hint="média" value={b ? n2.format(b.full.cyclesPerDay) : "—"} />
              <MetricRow label="Horas operando" value={b ? `${n1.format(b.full.opHoursPerDay)} h/dia` : "—"} />
              <MetricRow label="Energia movimentada" hint="ano" value={b ? `${n0.format((b.full.chargedMWh + b.full.dischargedMWh) * scale)} MWh` : "—"} />
              <MetricRow label="Receita mensal" hint="média" value={b ? fmtMoney((b.full.revenue * scale) / 12) : "—"} />
            </Panel>
            <Panel title="Margem de arbitragem" subtitle={b ? `Preços médios ponderados pela energia em ${b.full.days} dias` : undefined}>
              <ChartFrame option={marginOpt} loading={q.isLoading} error={q.error} height={150} label="Preço do dia com horas de compra e venda" />
              {b ? (
                <div className="mt-2 grid grid-cols-1 gap-x-6">
                  <MetricRow label="Preço de compra" value={brl(b.margin.avgBuy)} />
                  <MetricRow label="Preço de venda" value={brl(b.margin.avgSell)} />
                  <MetricRow label="Spread bruto" value={brl(b.margin.spread)} />
                  <MetricRow label="Spread líquido" hint="perdas" value={brl(b.margin.netSpread)} />
                  <MetricRow label="Custo do BESS" hint="LCOS" value={brl(b.margin.lcos)} />
                  <MetricRow label="Margem líquida" hint="/MWh" value={brl(b.margin.netMargin)} tone={b.margin.netMargin !== null && b.margin.netMargin >= 0 ? "good" : "critical"} />
                </div>
              ) : null}
            </Panel>
          </div>

          <Panel title="Retorno financeiro" subtitle={p ? `WACC real ${n1.format(p.waccPct)}% · ${p.lifeYears} anos · OPEX ${n1.format(p.opexPctCapex)}% do CAPEX ao ano` : undefined} bodyClassName="grid grid-cols-1 gap-x-8 px-5 pb-5 pt-1 lg:grid-cols-2">
            <MetricRow label="VPL" value={f ? fmtMoney(f.npv) : "—"} tone={f ? (f.npv >= 0 ? "good" : "critical") : undefined} />
            <MetricRow label="TIR (estimada)" value={f ? (f.irr === null ? "não se paga" : pct(100 * f.irr)) : "—"} tone={irrTone} />
            <MetricRow label="ROI" hint="vida útil" value={f ? pct(100 * f.roi) : "—"} tone={f ? (f.roi >= 0 ? "good" : "critical") : undefined} />
            <MetricRow label="CAPEX implícito" value={f ? `${fmtMoney(f.capex)} · ${brl(f.capexPerKWh, 0)}/kWh` : "—"} />
            <MetricRow label="Custo nivelado (LCOS)" hint="informado" value={p ? `${n2.format(p.lcos)} R$/MWh` : "—"} />
            <MetricRow label="LCOS efetivo" hint="despacho real" value={f?.effectiveLcos ? `${n2.format(f.effectiveLcos)} R$/MWh` : "—"} />
            <MetricRow label="LCOS de equilíbrio" hint="VPL = 0" value={f ? `${n2.format(f.breakevenLcos)} R$/MWh` : "—"} tone={f && p ? (f.breakevenLcos >= p.lcos ? "good" : "warning") : undefined} />
            {f && f.capacityRevenueYear > 0 ? <MetricRow label="Receita de capacidade" hint="premissa, por ano" value={fmtMoney(f.capacityRevenueYear)} /> : null}
          </Panel>

          <Disclosure title="Cenários, histórico e estado de carga" hint="simulação por cenário, receita diária e sensibilidade">
            <Panel title="Resultados por cenário" subtitle="Mesma janela de PLD; varia eficiência, degradação, custo e política de despacho" bodyClassName="px-2 pb-3 pt-1 max-sm:px-5">
              {b ? (
                <Table
                  label="Cenários"
                  head={["Cenário", "Potência MW", "Energia MWh", "Eficiência", "Degradação", "LCOS R$/MWh", "Receita anual", "Payback", "TIR", "VPL"]}
                  align={["left", "right", "right", "right", "right", "right", "right", "right", "right", "right"]}
                  rowClass={(i) => (b.scenarios[i]?.name === "Padrão" ? "bg-accent/[0.07]" : undefined)}
                  rows={b.scenarios.map((s) => {
                    const std = s.name === "Padrão";
                    return [
                      <span key="n">
                        <span className={`block ${std ? "font-semibold text-accent" : "text-ink"}`}>{std ? "Padrão (atual)" : s.name}</span>
                        <span className="block text-[12px] font-normal leading-tight text-muted">{s.policy}</span>
                      </span>,
                      n0.format(s.powerMW),
                      n0.format(s.capacityMWh),
                      `${n1.format(100 * s.rte)}%`,
                      `${n2.format(s.degPctYear)}%`,
                      n2.format(s.lcos),
                      <span key="r" className="text-ink">{fmtMoney(s.revenueYear)}</span>,
                      <span key="p" className={s.paybackYears === null ? "text-critical" : undefined}>{s.paybackYears === null ? "não se paga" : `${n1.format(s.paybackYears)} a`}</span>,
                      <span key="t" className={`font-semibold ${s.irr === null ? "text-critical" : p && s.irr >= p.waccPct / 100 ? "text-good" : "text-warning"}`}>{s.irr === null ? "—" : pct(100 * s.irr)}</span>,
                      <span key="v" className={s.npv >= 0 ? "text-good" : "text-critical"}>{fmtMoney(s.npv)}</span>,
                    ];
                  })}
                />
              ) : (
                <ChartFrame option={null} loading={q.isLoading} error={q.error} height={120} label="Cenários" />
              )}
            </Panel>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Panel className="lg:col-span-8" title="Receita diária" subtitle={b ? `Despacho ótimo e política simples · ${b.full.days} dias de PLD ${b.params.sub}` : undefined}>
                <ChartFrame option={dailyOpt} loading={q.isLoading} error={q.error} height={200} label="Receita diária do BESS" dim={busy && !!b} />
              </Panel>
              <Panel className="lg:col-span-4" title="Duração do spread diário" subtitle="% dos dias com spread acima de cada valor">
                <ChartFrame option={durOpt} loading={q.isLoading} error={q.error} height={200} label="Curva de duração do spread diário" />
              </Panel>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Panel title="Sensibilidade" subtitle="TIR conforme o custo nivelado; linhas: WACC, LCOS atual e de equilíbrio">
                <ChartFrame option={sensOpt} loading={q.isLoading} error={q.error} height={190} label="Sensibilidade da TIR ao LCOS" />
              </Panel>
              <Panel title="Estado de carga" subtitle={ref ? `Às ${String(hNow).padStart(2, "0")}h no ${ref.label.toLowerCase()}` : undefined}>
                <div className="flex flex-col items-center gap-3">
                  <SocRing soc={soc ?? 0} />
                  <div className="grid w-full grid-cols-2 gap-2">
                    {[
                      ["Armazenada", soc === null ? "—" : `${n1.format(soc * E)} MWh`],
                      ["Livre para carga", soc === null ? "—" : `${n1.format((1 - soc) * E)} MWh`],
                      ["Injetável (×η)", soc === null ? "—" : `${n1.format(soc * E * eta)} MWh`],
                      ["Capacidade total", `${n1.format(E)} MWh`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                        <div className="text-[12px] text-muted">{k}</div>
                        <div className="tnum text-[15px] font-semibold text-ink">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </div>
            <p className="px-1 text-[13px] leading-snug text-muted">
              Modelo: o despacho de cada dia começa e termina vazio, até {p ? n2.format(p.maxCyclesPerDay) : asset.maxc} ciclo(s) por dia, eficiência dividida entre carga e descarga (√η). O PLD horário sai na véspera, então o ótimo diário é implementável; a receita supõe liquidação ao PLD (a regulação de armazenamento na CCEE ainda está em definição). LCOS por MWh entregue; CAPEX implícito pelo perfil de {p ? n2.format(p.refCyclesPerDay) : asset.ref} ciclo(s) por dia. Detalhes na página de metodologia.
            </p>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
