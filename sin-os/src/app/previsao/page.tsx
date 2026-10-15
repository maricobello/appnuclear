"use client";

import { useMemo, useState } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Disclosure, ErrorBox, Loading, PageHeader, Panel, Segmented, SimBanner, Stat, Table } from "@/components/ui";
import type { PrevisaoResp, RegimesResp } from "@/lib/apiTypes";
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
    // séries de diagnóstico começam ocultas (um clique na legenda mostra)
    legend: { ...baseOption().legend, data: ["Realizado", "Previsão (LEAR ⊕ ingênuo)", "LEAR sozinho", "Mediana MC", "ACI 90% (conformal)", "MC P05–P95", "MC P25–P75"], selected: { "LEAR sozinho": false, "Mediana MC": false, "MC P25–P75": false } },
    xAxis: timeAxis(),
    yAxis: valueAxis("R$/MWh"),
    dataZoom: [{ type: "inside" }],
    series: [
      ...band("MC P05–P95", h.ts, h.mc.p05, h.mc.p95, color, 0.1, "a"),
      ...band("MC P25–P75", h.ts, h.mc.p25, h.mc.p75, color, 0.2, "b"),
      line("Realizado", f.history.ts.map((t, i) => [t, f.history.values[i]]), C.ink2),
      line("Previsão (LEAR ⊕ ingênuo)", h.ts.map((t, i) => [t, (h.point ?? h.lear)[i]]), color),
      line("LEAR sozinho", h.ts.map((t, i) => [t, h.lear[i]]), C.series[4], { lineStyle: { width: 1, color: C.series[4], type: [2, 3] } }),
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

/** AAAA-MM-DD → DD/MM/AAAA (o backtest cobre um ano: o dia/mês sozinho é ambíguo). */
const isoBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function PrevisaoPage() {
  const [sub, setSub] = useState<Sub>("SE");
  const { data: f, error, isValidating } = useApi<PrevisaoResp>(`/api/previsao?sub=${sub}`, 600_000);
  const reg365 = useApi<RegimesResp>(`/api/previsao/regimes?sub=${sub}`, 6 * 3600_000);
  const fanOpt = useMemo(() => (f ? fan(f) : null), [f]);
  const reg = useMemo(() => (f ? regimeBars(f) : null), [f]);
  const gar = useMemo(() => (f ? garchBars(f) : null), [f]);
  const bt = f?.backtest;

  const weekAvg = f?.horizon.dailyMean.length ? f.horizon.dailyMean.reduce((a, x) => a + (x.point ?? x.lear), 0) / f.horizon.dailyMean.length : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Previsão"
        subtitle="PLD dos próximos dias com faixa de incerteza, e quanto o modelo acerta."
        right={
          <div className="flex items-center gap-2">
            <a href={`/api/previsao?sub=${sub}&format=csv`} className="inline-flex min-h-11 sm:min-h-9 items-center rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-ink hover:bg-surface-3" title="Baixar a curva horária prevista (LEAR, banda e quantis) em CSV">
              Baixar CSV
            </a>
            <Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} />
          </div>
        }
      />
      <SimBanner metas={[f ? { id: "ccee_pld", ok: true, simulated: f.simulated, fallback: f.fallback, error: null, latestTs: null } : null]} label="PLD" />
      {error && !f ? <ErrorBox error={error} /> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Média prevista" value={brl(weekAvg)} hint={f ? `próximos ${f.horizon.dailyMean.length} dias · ${sub}` : undefined} />
        <Stat label="Erro médio" value={num(bt?.maeModel ?? bt?.maeLear, 2)} unit="R$/MWh" hint={bt ? `fora da amostra, ${bt.days} dias` : undefined} />
        <Stat
          label={bt ? `Contra o ingênuo · ${bt.days} dias` : "Contra o ingênuo"}
          value={bt ? `${num(100 * Math.abs(1 - bt.rmae), 0)}% ${bt.rmae <= 1 ? "menos erro" : "mais erro"}` : "—"}
          delta={bt ? `rMAE ${num(bt.rmae, 2)} · DM p = ${num(bt.dm.pValue, 3)}` : null}
          deltaGood={bt ? bt.rmae < 1 : null}
        />
        <Stat label="Cobertura da faixa" value={pct(bt ? 100 * bt.aci.coverage : null, 0)} hint={bt ? `alvo 90% · ±${brl(bt.aci.halfWidth, 0)} em média` : undefined} />
      </div>

      <Panel title={`PLD ${sub} — próximos dias`} subtitle={f ? `Realizado até ${dayLabel(f.lastObservedDate)}, previsão a partir de ${dayLabel(f.firstForecastDate)} · faixa de 90%` : "Calibrando modelos…"}>
        {fanOpt ? <EChart option={fanOpt} height={360} label="Leque de previsão do PLD" dim={isValidating} /> : <Loading height={360} />}
        {f?.warnings.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {f.warnings.map((w, i) => (
              <li key={i} className="rounded-xl bg-warning/12 px-3 py-2 text-[13px] leading-snug text-warning">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Média por dia" subtitle="Previsão publicada e faixa de 90% da média do dia">
          {f ? (
            <Table
              head={["Dia", "Previsão", "P05", "P95"]}
              align={["left", "right", "right", "right"]}
              rows={f.horizon.dailyMean.map((d) => [dayLabel(d.date), <b key="p" className="font-semibold text-ink">{brl(d.point ?? d.lear)}</b>, brl(d.p05), brl(d.p95)])}
            />
          ) : (
            <Loading />
          )}
        </Panel>
        <Panel title={`Erro por regime — ${sub}`} subtitle={reg365.data ? `Um ano de teste: de ${isoBr(reg365.data.from)} a ${isoBr(reg365.data.to)}` : "Um ano de teste contra o ingênuo · a primeira leitura do dia leva ~20 s"}>
          {reg365.data ? (
            <>
              <Table
                head={["Regime", "rMAE", "Leitura"]}
                stack
                align={["left", "right", "left"]}
                rows={[reg365.data.overall, ...reg365.data.buckets].map((b) => {
                  const tone = b.rmae === null ? "text-muted" : b.rmae < 0.97 ? "text-good" : b.rmae <= 1.03 ? "text-ink-2" : "text-critical";
                  const read = b.rmae === null ? "—" : b.rmae < 0.97 ? `erra ${num(100 * (1 - b.rmae), 0)}% menos` : b.rmae <= 1.03 ? "empata" : `erra ${num(100 * (b.rmae - 1), 0)}% mais`;
                  return [
                    <span key="l" className={b === reg365.data!.overall ? "font-semibold text-ink" : undefined} title={`${num(b.hours, 0)} horas · MAE ${brl(b.maeModel)} vs ingênuo ${brl(b.maeNaive)}`}>
                      {b.label}
                    </span>,
                    <span key="r" className={`font-semibold ${tone}`}>{b.rmae === null ? "—" : num(b.rmae, 2)}</span>,
                    <span key="t" className={tone}>
                      {read}
                      {b.smallSample ? " (amostra pequena)" : ""}
                    </span>,
                  ];
                })}
              />
              <p className="mt-2 text-[12px] text-muted">{reg365.data.method} Fonte do PLD: {reg365.data.pldSource}.</p>
            </>
          ) : reg365.error ? (
            <ErrorBox error={reg365.error} onRetry={() => reg365.mutate()} />
          ) : (
            <Loading height={200} label="Rodando um ano de teste…" />
          )}
        </Panel>
      </div>

      <Disclosure title="Detalhes do modelo" hint="regimes, volatilidade, saltos e quantis">
        {bt ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="CRPS (QRA)" value={num(bt.qraCrps, 2)} unit="R$/MWh" hint={`cobertura 5–95%: ${pct(100 * bt.qraCoverage90, 0)} (alvo 90%)`} />
            <Stat label="sMAPE" value={pct(bt.smape, 1)} hint={`RMSE ${num(bt.rmse, 1)}`} />
            <Stat label="LEAR sozinho" value={num(bt.maeLear, 2)} unit="R$/MWh" hint={bt.rmaeLear !== undefined ? `rMAE ${num(bt.rmaeLear, 3)}` : undefined} />
            <Stat label="Testes da faixa" value={`p = ${num(bt.aci.kupiecP, 3)}`} hint={`Kupiec (blocos diários) · Christoffersen p = ${bt.aci.christoffersenP !== undefined ? num(bt.aci.christoffersenP, 3) : "—"}`} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Panel title="Regimes de mercado (HMM 3 estados)" subtitle="Probabilidade filtrada agora e projetada pela matriz de transição">
            {reg ? <EChart option={reg} height={170} label="Probabilidades de regime" /> : <Loading height={170} />}
            {f?.regime ? (
              <div className="mt-3">
                <Table
                  head={["De \\ Para", ...f.regime.labels, "Duração média"]}
                  stack={false}
                  align={["left", "right", "right", "right", "right"]}
                  rows={f.regime.transition.map((row, i) => [f.regime!.labels[i], ...row.map((p) => pct(100 * p, 1)), `${num(f.regime!.durationsH[i], 1)} h`])}
                />
              </div>
            ) : null}
          </Panel>
          <Panel title="Volatilidade — GARCH(1,1)" subtitle={f?.garch ? `σ atual ${num(f.garch.dailyVolPct, 1)}%/dia · persistência α+β = ${num(f.garch.persistence, 3)} · meia-vida ${f.garch.halfLifeDays !== null && Number.isFinite(f.garch.halfLifeDays) ? `${num(f.garch.halfLifeDays, 1)} d` : "—"}` : "retornos log do PLD médio diário"}>
            {gar ? <EChart option={gar} height={200} label="Volatilidade projetada" /> : <p className="text-[13px] text-muted">Sem variação suficiente para estimar (preço no piso/teto).</p>}
            {f?.garch ? <p className="mt-2 text-[12px] text-muted">α = {num(f.garch.alpha, 3)} · β = {num(f.garch.beta, 3)} · n = {f.garch.n} dias</p> : null}
          </Panel>
          <Panel title="Dinâmica estocástica — MRJD" subtitle={`Reversão à média com saltos (Cartea–Figueroa) calibrada nos ${f?.mrjd?.calibratedOn ?? "resíduos do LEAR"}, espaço asinh`}>
            {f?.mrjd ? (
              <Table
                head={["Parâmetro", "Valor", "Leitura"]}
                stack
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
            {f ? <p className="mt-2 text-[12px] text-muted">LEAR: {num(f.lear.activeFeatures, 1)} regressores ativos em média (de 103) · janela {f.lear.calibrationDays} dias · asinh-median por hora</p> : null}
            {f?.backtest.horizonErrors.length ? (
              <p className="mt-1 text-[12px] text-muted">
                Erro fora da amostra por horizonte (MAE, R$/MWh):{" "}
                {f.backtest.horizonErrors.map((h) => `D+${h.day} ${h.mae === null ? "—" : num(h.mae, 0)}`).join(" · ")} — a banda de cada dia é alargada nessa proporção (×{f.backtest.horizonErrors.map((h) => num(h.spread, 2)).join(" / ×")}).
              </p>
            ) : null}
            {f?.backtest.regimeMae ? (
              <p className="mt-1 text-[12px] text-muted">
                MAE por regime: no piso {f.backtest.regimeMae.floor === null ? "—" : `${num(f.backtest.regimeMae.floor, 1)} R$/MWh`} · fora do piso{" "}
                {f.backtest.regimeMae.offFloor === null ? "—" : `${num(f.backtest.regimeMae.offFloor, 1)} R$/MWh`} ({pct(100 * f.backtest.regimeMae.floorShare, 0)} das horas no piso). A banda agora varia por hora do dia (heterocedasticidade pico/fora-de-pico).
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Panel title="Quantis do dia seguinte (QRA)" subtitle="Quantile Regression Averaging sobre LEAR + ingênuo, calibrado no backtest">
            {f ? (
              <Table
                head={["Hora", ...f.horizon.qraNextDay.taus.map((t) => `P${Math.round(t * 100)}`)]}
                stack={false}
                align={["left", ...f.horizon.qraNextDay.taus.map(() => "right" as const)]}
                rows={f.horizon.qraNextDay.quantiles.map((q, h) => [`${String(h).padStart(2, "0")}h`, ...q.map((v) => num(v, 1))])}
              />
            ) : (
              <Loading />
            )}
          </Panel>
        </div>
      </Disclosure>
    </div>
  );
}
