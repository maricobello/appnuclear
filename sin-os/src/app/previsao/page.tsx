"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Badge, ErrorBox, Loading, PageHeader, Panel, Segmented, SimBanner, Stat, Table } from "@/components/ui";
import type { PrevisaoResp } from "@/lib/apiTypes";
import { band, baseOption, C, categoryAxis, line, SUB_COLOR, timeAxis, valueAxis } from "@/lib/chart";
import { brl, dayLabel, num, pct } from "@/lib/fmt";
import { SUBS, type Sub } from "@/lib/sources/types";
import { useApi } from "@/lib/useApi";

const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));

function fan(f: PrevisaoResp): ChartOption {
  const h = f.horizon;
  const color = SUB_COLOR[f.sub];
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => brl(v) },
    legend: { ...baseOption().legend, data: ["Realizado", "LEAR (ponto)", "Mediana MC", "ACI 90% (conformal)", "MC P05–P95", "MC P25–P75"] },
    xAxis: timeAxis(),
    yAxis: valueAxis("R$/MWh"),
    dataZoom: [{ type: "inside" }],
    series: [
      ...band("MC P05–P95", h.ts, h.mc.p05, h.mc.p95, color, 0.1, "a"),
      ...band("MC P25–P75", h.ts, h.mc.p25, h.mc.p75, color, 0.2, "b"),
      line("Realizado", f.history.ts.map((t, i) => [t, f.history.values[i]]), C.ink2),
      line("LEAR (ponto)", h.ts.map((t, i) => [t, h.lear[i]]), color),
      line("Mediana MC", h.ts.map((t, i) => [t, h.mc.p50[i]]), C.series[6], { lineStyle: { width: 1.5, color: C.series[6] } }),
      line("ACI 90% (conformal)", h.ts.map((t, i) => [t, h.aciHi[i]]), C.muted, { lineStyle: { width: 1, color: C.muted, type: [4, 3] } }),
      line("ACI 90% (conformal)", h.ts.map((t, i) => [t, h.aciLo[i]]), C.muted, { lineStyle: { width: 1, color: C.muted, type: [4, 3] } }),
    ],
  };
}

function regimeBars(f: PrevisaoResp): ChartOption | null {
  const r = f.regime;
  if (!r) return null;
  const horizons = ["Agora", "Em 24 h", "Em 7 dias"];
  const probs = [r.current, r.in24h, r.in7d];
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => pct(v, 1) },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    xAxis: valueAxis(undefined, { max: 100, scale: false, axisLabel: { color: C.muted, fontSize: 10, formatter: "{value}%" } }),
    yAxis: categoryAxis(horizons, { inverse: true }),
    series: r.labels.map((lab, k) => ({
      name: `${lab} (~${brl(r.meansRS[k], 0)})`,
      type: "bar",
      stack: "p",
      barWidth: 18,
      itemStyle: { color: [C.series[2], C.series[0], C.series[7]][k], borderColor: C.surface, borderWidth: 2 },
      data: probs.map((p) => Math.round(p[k] * 1000) / 10),
    })),
  };
}

function garchBars(f: PrevisaoResp): ChartOption | null {
  const g = f.garch;
  if (!g) return null;
  return {
    ...baseOption(),
    tooltip: { ...baseOption().tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${num(v, 1)}%` },
    xAxis: categoryAxis(g.forecastVolPct.map((_, i) => `D+${i + 1}`)),
    yAxis: valueAxis("σ diária %", { scale: false }),
    series: [{ name: "Vol. condicional", type: "bar", barMaxWidth: 24, itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] }, data: g.forecastVolPct.map((v) => Math.round(v * 100) / 100) }],
  };
}

export default function PrevisaoPage() {
  const [sub, setSub] = useState<Sub>("SE");
  const { data: f, error, isValidating } = useApi<PrevisaoResp>(`/api/previsao?sub=${sub}`, 600_000);
  const fanOpt = useMemo(() => (f ? fan(f) : null), [f]);
  const reg = useMemo(() => (f ? regimeBars(f) : null), [f]);
  const gar = useMemo(() => (f ? garchBars(f) : null), [f]);
  const bt = f?.backtest;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Previsão probabilística do PLD"
        subtitle="Ensemble auditável: LEAR (LASSO via LARS, benchmark do epftoolbox) para o ponto, intervalos conformais adaptativos (ACI), QRA para quantis do D+1, Monte Carlo com difusão de reversão à média com saltos (MRJD), regimes por HMM e volatilidade GARCH(1,1). Avaliação fora da amostra com re-estimação diária."
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} />}
      />
      {f ? <SimBanner metas={[{ id: "ccee_pld", ok: true, simulated: f.simulated, fallback: f.fallback, error: null, latestTs: null }]} /> : null}
      {error && !f ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="MAE LEAR (fora da amostra)" value={num(bt?.maeLear, 2)} unit="R$/MWh" hint={bt ? `${bt.days} dias · ingênuo ${num(bt.maeNaive, 2)}` : undefined} />
        <Stat label="rMAE vs ingênuo semanal" value={num(bt?.rmae, 3)} delta={bt ? (bt.rmae < 1 ? "supera o benchmark" : "não supera o benchmark") : null} deltaGood={bt ? bt.rmae < 1 : null} />
        <Stat label="Teste Diebold–Mariano" value={bt ? `p = ${num(bt.dm.pValue, 3)}` : "—"} delta={bt ? (bt.dm.pValue < 0.05 ? "ganho significativo (5%)" : "sem significância a 5%") : null} deltaGood={bt ? bt.dm.pValue < 0.05 : null} />
        <Stat label="Cobertura ACI (alvo 90%)" value={pct(bt ? 100 * bt.aci.coverage : null, 1)} hint={bt ? `Kupiec p = ${num(bt.aci.kupiecP, 3)} · ±${brl(bt.aci.halfWidth, 0)}` : undefined} />
        <Stat label="CRPS (QRA)" value={num(bt?.qraCrps, 2)} unit="R$/MWh" hint="menor é melhor" />
        <Stat label="sMAPE" value={pct(bt?.smape, 1)} hint={bt ? `RMSE ${num(bt.rmse, 1)}` : undefined} />
      </div>

      <Panel
        title={`Leque de previsão — PLD ${sub}`}
        subtitle={f ? `Último dia observado ${dayLabel(f.lastObservedDate)} · previsão a partir de ${dayLabel(f.firstForecastDate)} · 1.000 trajetórias MRJD centradas no LEAR` : "calibrando modelos…"}
      >
        {fanOpt ? <EChart option={fanOpt} height={380} label="Leque de previsão do PLD" dim={isValidating} /> : <Loading height={380} />}
        {f?.warnings.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {f.warnings.map((w, i) => (
              <Badge key={i} level="warning">{w}</Badge>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Regimes de mercado (HMM 3 estados)" subtitle="Probabilidade filtrada agora e projetada pela matriz de transição">
          {reg ? <EChart option={reg} height={170} label="Probabilidades de regime" /> : <Loading height={170} />}
          {f?.regime ? (
            <div className="mt-3">
              <Table
                head={["De \\ Para", ...f.regime.labels, "Duração média"]}
                align={["left", "right", "right", "right", "right"]}
                rows={f.regime.transition.map((row, i) => [f.regime!.labels[i], ...row.map((p) => pct(100 * p, 1)), `${num(f.regime!.durationsH[i], 1)} h`])}
              />
            </div>
          ) : null}
        </Panel>
        <Panel title="Volatilidade — GARCH(1,1)" subtitle={f?.garch ? `σ atual ${num(f.garch.dailyVolPct, 1)}%/dia · persistência α+β = ${num(f.garch.persistence, 3)} · meia-vida ${f.garch.halfLifeDays !== null && Number.isFinite(f.garch.halfLifeDays) ? `${num(f.garch.halfLifeDays, 1)} d` : "—"}` : "retornos log do PLD médio diário"}>
          {gar ? <EChart option={gar} height={200} label="Volatilidade projetada" /> : <p className="text-xs text-muted">Sem variação suficiente para estimar (preço no piso/teto).</p>}
          {f?.garch ? <p className="mt-2 text-[11px] text-muted">α = {num(f.garch.alpha, 3)} · β = {num(f.garch.beta, 3)} · n = {f.garch.n} dias</p> : null}
        </Panel>
        <Panel title="Dinâmica estocástica — MRJD" subtitle="Reversão à média com saltos (Cartea–Figueroa) nos desvios da sazonalidade, espaço asinh">
          {f?.mrjd ? (
            <Table
              head={["Parâmetro", "Valor", "Leitura"]}
              align={["left", "right", "left"]}
              rows={[
                ["κ (por hora)", num(f.mrjd.kappaPerHour, 4), "velocidade de reversão"],
                ["Meia-vida", `${num(f.mrjd.halfLifeHours, 1)} h`, "tempo p/ choque cair à metade"],
                ["σ", num(f.mrjd.sigma, 4), "volatilidade difusiva"],
                ["Saltos / dia", num(f.mrjd.jumpsPerDay, 2), "intensidade λ·24"],
                ["Salto médio", num(f.mrjd.jumpMean, 3), "μ_J (asinh)"],
                ["Desvio do salto", num(f.mrjd.jumpSd, 3), "σ_J (asinh)"],
              ]}
            />
          ) : (
            <Loading height={160} />
          )}
          {f ? <p className="mt-2 text-[11px] text-muted">LEAR: {num(f.lear.activeFeatures, 1)} regressores ativos em média (de 103) · janela {f.lear.calibrationDays} dias</p> : null}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Quantis do dia seguinte (QRA)" subtitle="Quantile Regression Averaging sobre LEAR + ingênuo, calibrado no backtest">
          {f ? (
            <Table
              head={["Hora", ...f.horizon.qraNextDay.taus.map((t) => `P${Math.round(t * 100)}`)]}
              align={["left", ...f.horizon.qraNextDay.taus.map(() => "right" as const)]}
              rows={f.horizon.qraNextDay.quantiles.map((q, h) => [`${String(h).padStart(2, "0")}h`, ...q.map((v) => num(v, 1))])}
            />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title="Média diária prevista" subtitle="LEAR e faixa Monte Carlo P05–P95 (média das horas)">
          {f ? (
            <Table
              head={["Dia", "LEAR", "P05", "P95"]}
              align={["left", "right", "right", "right"]}
              rows={f.horizon.dailyMean.map((d) => [dayLabel(d.date), brl(d.lear), brl(d.p05), brl(d.p95)])}
            />
          ) : (
            <Loading />
          )}
        </Panel>
      </div>
    </div>
  );
}
