"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { EChart, type ChartOption } from "@/components/EChart";
import { Button, Kpi, MetricRow, Panel, Segmented } from "@/components/ui";
import type { MercadoLivreResp } from "@/lib/apiTypes";
import { baseOption, C, categoryAxis, valueAxis } from "@/lib/chart";
import { brl, num, pct } from "@/lib/fmt";
import { costHistogram, counterpartyExposure, optimize, priceScenarios, simulateWith, TYPICAL, typicalProfile, type ContractMonth, type LoadProfile } from "@/lib/market/contracting";
import { parseLoadCsv, profileFromCurve, type LoadUnit, type ParsedCurve } from "@/lib/market/loadcurve";
import { BANDEIRA_LABEL, type Bandeira } from "@/lib/market/radar";
import { SUB_NAMES, SUBS, type Sub } from "@/lib/sources/types";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const SUB_OPTS = SUBS.map((s) => ({ value: s, label: s }));
const ZERO_DEV = Array.from({ length: 12 }, () => new Array(24).fill(0));
const N_SCENARIOS = 2000;
const ALPHA = 0.95;

/** R$ em mil ou milhão, conforme o tamanho. */
const money = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e6 ? `R$ ${num(v / 1e6, 2)} mi` : a >= 1e3 ? `R$ ${num(v / 1e3, 0)} mil` : brl(v, 0);
};

const BETAS = [
  { value: "0", label: "Neutro", title: "Só o custo esperado: a resposta é tudo ou nada" },
  { value: "0.3", label: "Baixa" },
  { value: "0.6", label: "Moderada" },
  { value: "0.9", label: "Alta", title: "Quase só o pior cenário (CVaR 95%)" },
] as const;

/** Modelo de CSV (2 dias, 15 min, kWh) para quem quer ver o formato. */
function sampleCsv(): string {
  const rows = ["Data;Hora;Consumo ativo (kWh)"];
  for (let d = 1; d <= 2; d++)
    for (let i = 0; i < 96; i++) {
      const h = Math.floor(i / 4);
      const kwh = (TYPICAL.comercial.shape[h] * 250).toFixed(1).replace(".", ",");
      rows.push(`0${d}/03/2026;${String(h).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")};${kwh}`);
    }
  return rows.join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const inputCls = "min-h-10 w-full rounded-xl bg-surface-2 px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-accent";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function Simulator({ data, essPerMwh }: { data: MercadoLivreResp; essPerMwh: number | null }) {
  const [sub, setSub] = useState<Sub>("SE");
  const [source, setSource] = useState<"tipico" | "csv">("tipico");
  const [kind, setKind] = useState<keyof typeof TYPICAL>("comercial");
  const [avgMw, setAvgMw] = useState("2");
  const [raw, setRaw] = useState<{ name: string; text: string } | null>(null);
  const [unit, setUnit] = useState<LoadUnit | "auto">("auto");
  const [priceIn, setPriceIn] = useState("");
  const [beta, setBeta] = useState<(typeof BETAS)[number]["value"]>("0.6");
  const [te, setTe] = useState("");
  const [bandeira, setBandeira] = useState<Bandeira>("amarela");
  const [encIn, setEncIn] = useState("");

  const parsed = useMemo<{ curve: ParsedCurve | null; error: string | null }>(() => {
    if (!raw) return { curve: null, error: null };
    try {
      return { curve: parseLoadCsv(raw.text, unit === "auto" ? undefined : unit), error: null };
    } catch (e) {
      return { curve: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [raw, unit]);
  const fromCurve = useMemo(() => (parsed.curve ? profileFromCurve(parsed.curve) : null), [parsed.curve]);
  const mwTypical = Math.max(0.01, Number(avgMw.replace(",", ".")) || 0);
  const profile: LoadProfile = useMemo(() => (source === "csv" && fromCurve ? fromCurve.profile : typicalProfile(kind, mwTypical)), [source, fromCurve, kind, mwTypical]);

  const months: ContractMonth[] = useMemo(() => data.meses.map((m) => ({ mes: m.mes, band: m.band[sub], lim: m.lim })), [data.meses, sub]);
  const rho = data.rho?.[sub] ?? null;
  const dev = data.forma?.[sub].dev ?? ZERO_DEV;
  // os cenários de preço não dependem da carga: mudar a carga só refaz a soma
  const scen = useMemo(() => (months.length ? priceScenarios(months, dev, rho ?? 0.5, N_SCENARIOS) : null), [months, dev, rho]);
  const sim = useMemo(() => (scen ? simulateWith(scen, profile) : null), [scen, profile]);
  const fairFlat = sim ? sim.T.reduce((a, b) => a + b, 0) / sim.n / sim.hours : null;
  const typed = Number(priceIn.replace(",", "."));
  const price = priceIn.trim() && Number.isFinite(typed) && typed > 0 ? typed : fairFlat !== null ? Math.round(fairFlat) : null;
  const res = useMemo(() => (sim && price !== null ? optimize(sim, price, Number(beta), ALPHA) : null), [sim, price, beta]);
  const expo = useMemo(() => (sim && res && price !== null ? counterpartyExposure(sim, res.qOpt, price) : []), [sim, res, price]);
  const hist = useMemo(() => (sim && res && price !== null ? costHistogram(sim, price, [0, sim.avgMw, res.qOpt]) : null), [sim, res, price]);

  const perMwh = (v: number) => (sim && sim.energyMwh ? v / sim.energyMwh : NaN);

  const frontier = useMemo<ChartOption | null>(() => {
    if (!sim || !res) return null;
    const pt = (r: { q: number; mean: number; cvar: number }) => [perMwh(r.cvar), perMwh(r.mean), r.q];
    const fmt = (p: { value: number[]; seriesName: string }) =>
      `${p.seriesName}<br/>${num(p.value[2], 2)} MWmed (${pct((100 * p.value[2]) / sim.avgMw, 0)} da carga)<br/>custo esperado ${brl(p.value[1])}/MWh<br/>CVaR 95% ${brl(p.value[0])}/MWh`;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, trigger: "item", formatter: fmt },
      grid: { ...baseOption().grid, right: 16, bottom: 30 },
      xAxis: valueAxis("CVaR 95% (R$/MWh)", { nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: valueAxis("Custo esperado (R$/MWh)"),
      series: [
        { name: "Volumes de 0% a 150% da carga", type: "line", data: res.frontier.map(pt), lineStyle: { width: 1.5, color: C.ink2 }, itemStyle: { color: C.ink2 }, symbolSize: 4 },
        { name: "Tudo no PLD", type: "scatter", data: [pt(res.spot)], itemStyle: { color: C.series[1] }, symbolSize: 11 },
        { name: "100% flat", type: "scatter", data: [pt(res.full)], itemStyle: { color: C.series[3] }, symbolSize: 11 },
        { name: "Ótimo", type: "scatter", data: [pt(res.opt)], itemStyle: { color: C.series[0] }, symbolSize: 14 },
      ],
    } as ChartOption;
  }, [sim, res]); // eslint-disable-line react-hooks/exhaustive-deps

  const distChart = useMemo<ChartOption | null>(() => {
    if (!hist) return null;
    const mid = hist.edges.slice(0, -1).map((e, i) => Math.round((e + hist.edges[i + 1]) / 2));
    const names = ["Tudo no PLD", "100% flat", "Volume ótimo"];
    const colors = [C.series[1], C.series[3], C.series[0]];
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => pct(v, 1) },
      grid: { ...baseOption().grid, bottom: 30 },
      xAxis: categoryAxis(mid.map((x) => num(x, 0)), { name: "R$/MWh de carga", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.muted, fontSize: 11 } }),
      yAxis: valueAxis("% dos cenários"),
      series: hist.counts.map((c, i) => ({ name: names[i], type: "line", step: "middle", data: c.map((x) => 100 * x), lineStyle: { width: 1.8, color: colors[i] }, itemStyle: { color: colors[i] }, showSymbol: false, areaStyle: i === 2 ? { color: colors[i], opacity: 0.12 } : undefined })),
    } as ChartOption;
  }, [hist]);

  const expoChart = useMemo<ChartOption | null>(() => {
    if (!expo.length) return null;
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip, valueFormatter: (v: number) => money(v * 1000) },
      xAxis: categoryAxis(expo.map((e) => monthLabel(e.mes))),
      yAxis: valueAxis("R$ mil"),
      series: [
        { name: "Exposição esperada (EE)", type: "bar", data: expo.map((e) => e.ee / 1000), itemStyle: { color: C.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 },
        { name: "Exposição potencial (PFE 95%)", type: "line", data: expo.map((e) => e.pfe / 1000), lineStyle: { width: 2, color: C.critical }, itemStyle: { color: C.critical }, symbolSize: 5 },
      ],
    } as ChartOption;
  }, [expo]);

  const shapeChart = useMemo<ChartOption | null>(() => {
    if (!sim || fairFlat === null) return null;
    const load = Array.from({ length: 24 }, (_, h) => profile.mw.reduce((a, r) => a + r[h], 0) / 12);
    const price = Array.from({ length: 24 }, (_, h) => fairFlat + dev.reduce((a, r) => a + r[h], 0) / 12);
    return {
      ...baseOption(),
      tooltip: { ...baseOption().tooltip },
      grid: { ...baseOption().grid, right: 8 },
      xAxis: categoryAxis(Array.from({ length: 24 }, (_, h) => `${h}h`)),
      yAxis: [valueAxis("MW"), valueAxis("R$/MWh", { splitLine: { show: false } })],
      series: [
        { name: "Sua carga (média do ano)", type: "bar", data: load.map((x) => Math.round(x * 1000) / 1000), itemStyle: { color: C.series[2], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
        { name: "PLD esperado por hora", type: "line", yAxisIndex: 1, data: price.map((x) => Math.round(Math.max(x, months[0]?.lim.min ?? 0))), lineStyle: { width: 2, color: C.series[1] }, itemStyle: { color: C.series[1] }, showSymbol: false },
      ],
    } as ChartOption;
  }, [sim, fairFlat, profile, dev, months]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setRaw({ name: f.name, text: "" });
      return;
    }
    setRaw({ name: f.name, text: await f.text() });
    setSource("csv");
  };

  const encargos = encIn.trim() ? Number(encIn.replace(",", ".")) : essPerMwh !== null ? Math.round(essPerMwh * 100) / 100 : 0;
  const teNum = Number(te.replace(",", "."));
  const acr = sim && te.trim() && Number.isFinite(teNum) && teNum > 0 ? sim.energyMwh * (teNum + data.bandeiras[bandeira]) : null;
  const acl = sim && res ? res.opt.mean + sim.energyMwh * (Number.isFinite(encargos) ? encargos : 0) : null;
  const aclBad = sim && res ? res.opt.cvar + sim.energyMwh * (Number.isFinite(encargos) ? encargos : 0) : null;
  const peakPfe = expo.length ? Math.max(...expo.map((e) => e.pfe)) : null;

  if (!months.length) return null;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Contratação ótima"
        subtitle="Quanto contratar em volume flat para os próximos 12 meses, medindo o custo e o risco em 2.000 cenários de preço tirados do planejamento"
        right={<Segmented label="Submercado" value={sub} options={SUB_OPTS} onChange={setSub} size="xs" />}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Segmented
              label="Curva de carga"
              value={source}
              onChange={setSource}
              options={[
                { value: "tipico", label: "Perfil típico" },
                { value: "csv", label: "Minha curva (CSV)" },
              ]}
            />
            {source === "tipico" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Perfil">
                  <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as keyof typeof TYPICAL)}>
                    {Object.entries(TYPICAL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Carga média (MWmed)">
                  <input className={inputCls} inputMode="decimal" value={avgMw} onChange={(e) => setAvgMw(e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} aria-label="Arquivo da curva de carga" className="text-[13px] text-ink-2 file:mr-3 file:rounded-full file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink" />
                <div className="flex flex-wrap items-center gap-2">
                  <Field label="Unidade">
                    <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value as LoadUnit | "auto")}>
                      <option value="auto">Pelo cabeçalho</option>
                      <option value="kWh">kWh por intervalo</option>
                      <option value="kW">kW</option>
                      <option value="MWh">MWh por intervalo</option>
                      <option value="MW">MW</option>
                    </select>
                  </Field>
                  <Button variant="ghost" className="mt-5" onClick={() => download("modelo-curva-de-carga.csv", sampleCsv())}>
                    Baixar modelo
                  </Button>
                </div>
                {parsed.error || (raw && !raw.text) ? (
                  <p role="alert" className="text-[13px] text-critical">
                    {raw && !raw.text ? "Arquivo maior que 25 MB." : parsed.error}
                  </p>
                ) : null}
                {parsed.curve && fromCurve ? (
                  <p className="text-[12px] leading-relaxed text-muted">
                    {raw?.name}: {num(parsed.curve.rows)} leituras de {parsed.curve.intervalMin} min, coluna “{parsed.curve.column}” em {parsed.curve.unit}
                    {parsed.curve.unitGuessed ? " (suposto: confira a unidade)" : ""}, {parsed.curve.first} a {parsed.curve.last}, {fromCurve.stats.monthsCovered} de 12 meses com dado próprio
                    {parsed.curve.skipped ? `, ${num(parsed.curve.skipped)} linhas ignoradas` : ""}. Média {num(fromCurve.stats.avgMw, 3)} MW, pico {num(fromCurve.stats.peakMw, 3)} MW, fator de carga{" "}
                    {pct(100 * fromCurve.stats.loadFactor, 0)}, {pct(100 * fromCurve.stats.peakShare, 1)} da energia entre 18h e 21h.
                  </p>
                ) : (
                  <p className="text-[12px] leading-relaxed text-muted">
                    Curva de 15 min, 30 min ou horária, como sai do portal da distribuidora (e do Open Energy, quando as APIs chegarem). A leitura acontece no seu navegador: o arquivo não é enviado.
                  </p>
                )}
              </div>
            )}
            <Field label="Preço do contrato flat (R$/MWh)" hint={fairFlat !== null ? `Vazio = preço justo pelos cenários: ${brl(fairFlat)}` : undefined}>
              <input className={inputCls} inputMode="decimal" placeholder={fairFlat !== null ? String(Math.round(fairFlat)) : ""} value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ink-2">Aversão a risco</span>
              <Segmented label="Aversão a risco" value={beta} onChange={setBeta} options={BETAS.map((b) => ({ value: b.value, label: b.label, title: "title" in b ? b.title : undefined }))} size="xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:col-span-2">
            <Kpi label="Volume ótimo" value={res?.qOpt ?? null} format={(v) => num(v, 2)} unit="MWmed" foot={res ? `${pct(100 * res.hedgeRatio, 0)} da carga média` : undefined} />
            <Kpi label="Preço justo do flat" value={res?.fairFlat ?? null} format={(v) => num(v, 2)} unit="R$/MWh" foot="PLD médio esperado no ano" />
            <Kpi
              label="Preço da sua carga"
              value={res?.captureLoad ?? null}
              format={(v) => num(v, 2)}
              unit="R$/MWh"
              foot={res ? `perfil ${res.profileCost >= 0 ? "+" : "−"}${brl(Math.abs(res.profileCost))} vs flat` : undefined}
            />
            <Kpi label="Custo no volume ótimo" value={res ? perMwh(res.opt.mean) : null} format={(v) => num(v, 2)} unit="R$/MWh" foot={res ? `pior 5%: ${brl(perMwh(res.opt.cvar))}` : undefined} />
            <div className="col-span-2 flex flex-col">
              {res && sim ? (
                <>
                  <MetricRow label="Tudo no PLD" hint="sem contrato" value={`${brl(perMwh(res.spot.mean))} · pior 5% ${brl(perMwh(res.spot.cvar))}`} tone="muted" />
                  <MetricRow label="100% da carga em flat" value={`${brl(perMwh(res.full.mean))} · pior 5% ${brl(perMwh(res.full.cvar))}`} tone="muted" />
                  <MetricRow
                    label="Volume ótimo"
                    hint={`β ${num(Number(beta), 1)}: ${num((1 - Number(beta)) * 100, 0)}% custo esperado + ${num(Number(beta) * 100, 0)}% CVaR 95%`}
                    value={`${brl(perMwh(res.opt.mean))} · pior 5% ${brl(perMwh(res.opt.cvar))}`}
                  />
                  <MetricRow
                    label="Correlação entre meses"
                    hint={rho !== null ? "implícita nos cenários do SDDP" : "padrão (sem cenários do SDDP)"}
                    value={num(rho ?? 0.5, 2)}
                    tone="muted"
                  />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Fronteira eficiente" subtitle="Cada ponto é um volume flat: mais contrato troca custo esperado por menos risco no pior cenário">
          {frontier ? <EChart option={frontier} height={300} label="Fronteira eficiente da contratação" /> : null}
        </Panel>
        <Panel title="Distribuição do custo" subtitle="Custo da energia por MWh consumido nos 2.000 cenários, sem contrato, com 100% flat e no volume ótimo">
          {distChart ? <EChart option={distChart} height={300} label="Distribuição do custo da energia" /> : null}
        </Panel>
        <Panel title="Sua carga × o preço de cada hora" subtitle="O preço da sua carga difere do flat pelo quanto você consome nas horas caras (fim de tarde) ou baratas (meio-dia, sol)">
          {shapeChart ? <EChart option={shapeChart} height={280} label="Perfil horário da carga e do PLD" /> : null}
        </Panel>
        <div id="contraparte" className="scroll-mt-20">
          <Panel
            title="Se a comercializadora quebrar"
            subtitle="Perda ao repor o resto do contrato ao PLD se a contraparte falhar no início de cada mês (volume ótimo, preço do contrato)"
          >
            {expoChart ? <EChart option={expoChart} height={240} label="Exposição de contraparte por mês" /> : null}
            <MetricRow label="Maior exposição potencial (PFE 95%)" hint="garantia que cobre 95% dos cenários" value={money(peakPfe)} tone="warning" />
            <MetricRow label="Exposição esperada no início" value={money(expo[0]?.ee ?? null)} />
          </Panel>
        </div>
      </div>

      <div id="comparacao" className="scroll-mt-20">
        <Panel title="Mercado regulado × livre" subtitle="Só a parcela de energia: a TUSD (fio) é paga nos dois ambientes">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-3">
              <Field label="Tarifa de energia regulada — TE (R$/MWh)" hint="Na conta ou na resolução da sua distribuidora, sem impostos e sem TUSD">
                <input className={inputCls} inputMode="decimal" value={te} onChange={(e) => setTe(e.target.value)} placeholder="ex.: 300" />
              </Field>
              <Field label="Bandeira média esperada">
                <select className={inputCls} value={bandeira} onChange={(e) => setBandeira(e.target.value as Bandeira)}>
                  {(Object.keys(BANDEIRA_LABEL) as Bandeira[]).map((b) => (
                    <option key={b} value={b}>
                      {BANDEIRA_LABEL[b]} (+{brl(data.bandeiras[b])}/MWh)
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Encargos no mercado livre (R$/MWh)"
                hint={essPerMwh !== null && !encIn.trim() ? `Vazio = ESS estimado da última semana (${brl(essPerMwh)}). Some EER, CCEE e a taxa da varejista.` : "ESS, EER, contribuição à CCEE e taxa da varejista"}
              >
                <input className={inputCls} inputMode="decimal" value={encIn} onChange={(e) => setEncIn(e.target.value)} placeholder={essPerMwh !== null ? num(essPerMwh, 2) : "0"} />
              </Field>
            </div>
            <div className="flex flex-col lg:col-span-2">
              <MetricRow label="Energia no ano" value={sim ? `${num(sim.energyMwh, 0)} MWh` : "—"} tone="muted" />
              <MetricRow label="Mercado regulado" hint="TE + bandeira" value={money(acr)} />
              <MetricRow label="Mercado livre, esperado" hint="contrato ótimo + liquidação + encargos" value={money(acl)} />
              <MetricRow label="Mercado livre, pior 5%" hint="CVaR 95%" value={money(aclBad)} tone="muted" />
              <MetricRow
                label="Economia esperada"
                value={acr !== null && acl !== null ? `${money(acr - acl)} (${pct((100 * (acr - acl)) / acr, 1)})` : "informe a TE"}
                tone={acr !== null && acl !== null ? (acr - acl >= 0 ? "good" : "critical") : "muted"}
              />
              <MetricRow
                label="Economia no pior 5%"
                value={acr !== null && aclBad !== null ? `${money(acr - aclBad)}` : "—"}
                tone={acr !== null && aclBad !== null ? (acr - aclBad >= 0 ? "good" : "warning") : "muted"}
              />
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Energia incentivada (com desconto na TUSD) e impostos ficam de fora. Para {SUB_NAMES[sub]}: faixas de preço do planejamento de {data.plano?.asof ?? "—"}, forma das horas do PLD real do último ano.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
