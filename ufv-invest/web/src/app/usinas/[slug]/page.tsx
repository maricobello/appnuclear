import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileJson, MapPin } from "lucide-react";
import { plants } from "@/data/plants";
import { getPlantAnalysis } from "@/lib/analysis";
import { brl, brlCompact, dateBR, MONTHS, num, pct, statusLabel, years } from "@/lib/fmt";
import { Badge, buttonClass, Card, CardHeader, Container, Notice, SourceDot, Stat } from "@/components/ui";
import { BenchmarksChart, CashFlowChart, GenerationChart, IrradianceChart, MonteCarloChart, TornadoChart } from "@/components/plant/Charts";
import { Simulator } from "@/components/plant/Simulator";
import { LivePanel } from "@/components/plant/LivePanel";
import { InvestPanel } from "@/components/plant/InvestPanel";
import { OnChainPanel } from "@/components/plant/OnChainPanel";

export function generateStaticParams() {
  return plants.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/usinas/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = plants.find((x) => x.slug === slug);
  return p ? { title: p.name, description: `${p.tagline}. ${p.location.municipio}/${p.location.uf}, ${num(p.tech.dcKWp)} kWp.` } : {};
}

function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(1).replace(".", ",")}″ ${v >= 0 ? pos : neg}`;
}

export default async function PlantPage({ params }: PageProps<"/usinas/[slug]">) {
  const { slug } = await params;
  const a = await getPlantAnalysis(slug);
  if (!a) notFound();
  const { plant, generation: g, finance: f, resource, location, market } = a;
  const t = plant.tech;
  const p90Ratio = g.annualP50MWh > 0 ? g.p90MWh / g.annualP50MWh : 0.9;
  const cdi = f.benchmarks.find((b) => /cdi/i.test(b.name));
  const fallbackCount = a.provenance.filter((p) => p.status === "fallback" || p.status === "error").length;

  return (
    <div className="pb-10">
      {/* Cabeçalho */}
      <section className="hero-glow border-b border-line">
        <Container className="py-8 sm:py-10">
          <Link href="/usinas" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> Todas as usinas
          </Link>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={plant.status === "captacao" ? "brand" : plant.status === "operacao" ? "good" : "info"}>{statusLabel[plant.status]}</Badge>
                <Badge>{plant.token.symbol}</Badge>
                {plant.illustrative && <Badge tone="warning">Projeto ilustrativo</Badge>}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{plant.name}</h1>
              <p className="mt-2 flex items-center gap-1.5 text-[15px] text-ink-2">
                <MapPin className="size-4 text-brand" /> {plant.location.municipio}/{plant.location.uf} · {plant.location.distribuidora} · submercado {plant.location.submercado}
              </p>
              <p className="mt-3 text-[15px] text-ink-2">{plant.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/usinas/${plant.slug}/relatorio`} className={buttonClass.primary}>
                <Download className="size-4" /> Relatório de auditoria (PDF)
              </a>
              <a href={`/api/usinas/${plant.slug}/analise`} target="_blank" rel="noopener" className={buttonClass.secondary}>
                <FileJson className="size-4" /> Dados (JSON)
              </a>
            </div>
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl border border-line bg-surface/70 p-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Potência" value={`${num(t.dcKWp)} kWp`} hint={`${num(t.acKW)} kW AC`} />
            <Stat label="Geração P50" value={`${num(g.annualP50MWh)} MWh`} hint={`P90 ${num(g.p90MWh)} MWh/ano`} />
            <Stat label="TIR nominal" value={pct(f.irrNominalPct)} hint={`real ${pct(f.irrRealPct)} a.a.`} tone="brand" />
            <Stat label="Payback" value={f.paybackYears != null ? `${num(f.paybackYears, 1)} anos` : "—"} hint={`descontado ${f.discountedPaybackYears != null ? num(f.discountedPaybackYears, 1) : "—"}`} />
            <Stat label="Cota" value={brl(plant.token.cotaPriceBRL, 0)} hint={`${num(plant.token.totalCotas)} cotas`} />
            <Stat label="Renda/cota/mês" value={brl(f.perCota.avgMonthlyIncomeBRL)} hint="média P50" tone="good" />
          </dl>
        </Container>
      </section>

      <Container className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {plant.illustrative && (
            <Notice tone="warning" title="Projeto ilustrativo">
              Localização, regras regulatórias e recurso solar são reais (APIs públicas, consultadas em {dateBR(a.generatedAt, true)}); engenharia, CAPEX e
              tokenização são hipóteses de mercado para demonstrar a plataforma.
            </Notice>
          )}
          {plant.status === "operacao" && (
            <Notice tone="info" title={`Em operação desde ${plant.finance.startYear}`}>
              Os indicadores consideram o fluxo desde a emissão das cotas ({plant.finance.startYear - 1}). Quem compra cotas hoje no mercado secundário recebe só as
              distribuições futuras, ao preço negociado — o retorno efetivo depende desse preço.
            </Notice>
          )}
          {fallbackCount > 0 && (
            <Notice tone="info" title={`${fallbackCount} fonte(s) em modo referência`}>
              Alguma API pública não respondeu agora; os valores de referência embarcados foram usados e estão marcados em “Fontes de dados”.
            </Notice>
          )}

          {/* Geração */}
          <Card as="section">
            <CardHeader id="geracao" title="Geração de energia estimada" subtitle={`Modelo horário (dia médio mensal) com ${t.mounting === "fixed" ? `estrutura fixa ${num(t.tiltDeg)}°` : "seguidor de um eixo"} · ano 1`} />
            <div className="p-5">
              <GenerationChart monthly={g.monthly} p90Ratio={p90Ratio} />
              <div className="mt-5 grid gap-4 sm:grid-cols-4">
                <Stat label="Yield específico" value={`${num(g.specificYieldKWhPerKWp)}`} hint="kWh/kWp/ano" />
                <Stat label="Performance ratio" value={pct(g.performanceRatioPct)} />
                <Stat label="Fator de capacidade" value={pct(g.capacityFactorPct)} />
                <Stat label="CO₂ evitado" value={`${num(g.co2AvoidedTonsYear)} t`} hint="por ano (fator SIN)" />
              </div>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[520px] text-[13px]">
                  <caption className="mb-2 text-left text-[13px] font-medium text-ink-2">Probabilidade de excedência (energia anual)</caption>
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 text-left font-medium">Cenário</th>
                      <th className="py-2 text-right font-medium">MWh/ano</th>
                      <th className="py-2 text-right font-medium">vs P50</th>
                      <th className="py-2 text-left font-medium pl-4">Leitura</th>
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {[
                      ["P50", g.annualP50MWh, "50% de chance de gerar mais"],
                      ["P75", g.p75MWh, "75% de chance de gerar mais"],
                      ["P90", g.p90MWh, "90% de chance (ano isolado)"],
                      ["P90 (10 anos)", g.p90TenYearMWh, "média de 10 anos — usado por bancos"],
                      ["P99", g.p99MWh, "cenário extremo"],
                    ].map(([k, v, d]) => (
                      <tr key={k as string} className="border-b border-line/60">
                        <td className="py-2 font-medium text-ink">{k}</td>
                        <td className="py-2 text-right">{num(v as number)}</td>
                        <td className="py-2 text-right text-muted">{pct(((v as number) / g.annualP50MWh - 1) * 100, 1)}</td>
                        <td className="py-2 pl-4 text-muted">{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-muted">
                Incerteza total {pct(g.uncertainty.totalPct)} (variabilidade interanual {pct(g.uncertainty.interannualPct)}, dado de recurso {pct(g.uncertainty.resourceDataPct)}, modelo{" "}
                {pct(g.uncertainty.modelPct)}, degradação {pct(g.uncertainty.degradationPct)}).
                {g.crossCheck && (
                  <>
                    {" "}
                    Validação cruzada com o {g.crossCheck.source}: {num(g.crossCheck.annualMWh)} MWh/ano (desvio {pct(g.crossCheck.deviationPct, 1, true)}).
                  </>
                )}
              </p>
            </div>
          </Card>

          {/* Local e recurso */}
          <Card as="section">
            <CardHeader id="local" title="Local e recurso solar" subtitle="Dados do município (IBGE) e climatologia de satélite (NASA POWER)" />
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <div>
                <IrradianceChart ghi={resource.monthly.ghiKWhM2Day} />
                <p className="mt-2 text-[13px] text-muted">
                  Irradiação anual {num(resource.annualGhiKWhM2)} kWh/m² · variabilidade interanual {pct(resource.interannualCvPct)}
                  {resource.annualSeries?.length ? ` (${resource.annualSeries.length} anos)` : ""}.
                </p>
              </div>
              <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 text-[14px]">
                <div>
                  <dt className="text-[12px] text-muted">Município</dt>
                  <dd>
                    {location.municipio}/{location.uf}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Código IBGE</dt>
                  <dd className="tnum">{location.ibgeCode}</dd>
                </div>
                {location.regiaoImediata && (
                  <div>
                    <dt className="text-[12px] text-muted">Região imediata</dt>
                    <dd>{location.regiaoImediata}</dd>
                  </div>
                )}
                {location.regiao && (
                  <div>
                    <dt className="text-[12px] text-muted">Região</dt>
                    <dd>{location.regiao}</dd>
                  </div>
                )}
                {location.populacao != null && (
                  <div>
                    <dt className="text-[12px] text-muted">População{location.populacaoAno ? ` (${location.populacaoAno})` : ""}</dt>
                    <dd className="tnum">{num(location.populacao)}</dd>
                  </div>
                )}
                {location.pibPerCapitaBRL != null && (
                  <div>
                    <dt className="text-[12px] text-muted">PIB per capita{location.pibAno ? ` (${location.pibAno})` : ""}</dt>
                    <dd className="tnum">{brl(location.pibPerCapitaBRL, 0)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[12px] text-muted">Coordenadas</dt>
                  <dd className="tnum text-[13px]">
                    {dms(plant.location.lat, "N", "S")}
                    <br />
                    {dms(plant.location.lon, "L", "O")}
                  </dd>
                </div>
                {location.elevationM != null && (
                  <div>
                    <dt className="text-[12px] text-muted">Altitude</dt>
                    <dd className="tnum">{num(location.elevationM)} m</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[12px] text-muted">Distribuidora</dt>
                  <dd>{plant.location.distribuidora}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Área</dt>
                  <dd className="tnum">{num(t.landAreaHa, 1)} ha</dd>
                </div>
              </dl>
            </div>
            <div className="overflow-x-auto border-t border-line px-5 py-4">
              <table className="w-full min-w-[640px] text-[12px] tnum">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">Mês</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="py-1 text-right font-medium">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 text-muted">GHI kWh/m²/dia</td>
                    {resource.monthly.ghiKWhM2Day.map((v, i) => (
                      <td key={i} className="py-1 text-right">
                        {num(v, 2)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-1 text-muted">Temp. média °C</td>
                    {resource.monthly.tempC.map((v, i) => (
                      <td key={i} className="py-1 text-right">
                        {num(v, 1)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-1 text-muted">Geração MWh</td>
                    {g.monthly.map((m) => (
                      <td key={m.month} className="py-1 text-right">
                        {num(m.energyMWh)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Econômico */}
          <Card as="section">
            <CardHeader id="economia" title="Análise econômica" subtitle={`Perspectiva do cotista · ${plant.finance.horizonYears} anos · taxa de desconto ${pct(f.discountRatePct)} a.a.`} />
            <div className="p-5">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <Stat label="Captação" value={brlCompact(f.investmentBRL)} hint={`CAPEX ${brlCompact(f.capexBRL)}`} />
                <Stat label="VPL" value={brlCompact(f.npvBRL)} tone={f.npvBRL >= 0 ? "good" : "default"} />
                <Stat label="TIR nominal / real" value={`${pct(f.irrNominalPct)}`} hint={`real ${pct(f.irrRealPct)}`} tone="brand" />
                <Stat label="LCOE" value={`R$ ${num(f.lcoeBRLPerMWh)}`} hint="por MWh" />
                <Stat label="Payback simples" value={years(f.paybackYears)} />
                <Stat label="ROI no horizonte" value={pct(f.roiTotalPct, 0)} hint={`MOIC ${num(f.moic, 2)}×`} />
                <Stat label="Yield ano 1" value={pct(f.firstYearYieldPct)} hint={`médio ${pct(f.avgYieldPct)}`} />
                <Stat label="Renda total/cota" value={brl(f.perCota.totalIncomeBRL)} hint={`cota de ${brl(f.perCota.priceBRL, 0)}`} />
              </dl>
              <div className="mt-6">
                <CashFlowChart cashFlows={f.cashFlows} />
              </div>
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-[14px] font-semibold">R$ 1.000 em {plant.finance.horizonYears} anos</h3>
                  <BenchmarksChart benchmarks={f.benchmarks} highlight={plant.name} />
                </div>
                <ul className="space-y-2 text-[13px] text-muted">
                  {f.benchmarks.map((b) => (
                    <li key={b.name}>
                      <b className="text-ink-2">{b.name}</b> ({pct(b.annualPct)} a.a.): {b.note}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          {/* Risco */}
          <Card as="section">
            <CardHeader
              id="risco"
              title="Risco e incerteza"
              subtitle={`Monte Carlo com ${num(f.monteCarlo.runs)} cenários (semente ${f.monteCarlo.seed}) e sensibilidade por variável`}
            />
            <div className="p-5">
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat label="TIR P10" value={pct(f.monteCarlo.irrP10Pct)} hint="pessimista" />
                <Stat label="TIR P50" value={pct(f.monteCarlo.irrP50Pct)} tone="brand" />
                <Stat label="TIR P90" value={pct(f.monteCarlo.irrP90Pct)} hint="otimista" />
                <Stat label="Chance TIR < CDI" value={pct(f.monteCarlo.probIrrBelowCdiPct, 0)} hint={`VPL < 0: ${pct(f.monteCarlo.probNpvNegativePct, 0)}`} />
              </div>
              <div className="mt-5">
                <MonteCarloChart mc={f.monteCarlo} cdiPct={market.cdiPct} />
              </div>
              <p className="mt-2 text-[13px] text-muted">Variáveis sorteadas: {f.monteCarlo.variables.join(" · ")}.</p>
              <h3 className="mt-6 text-[14px] font-semibold">Sensibilidade da TIR (base {pct(f.irrNominalPct)})</h3>
              <TornadoChart rows={f.sensitivity} baseIrr={f.irrNominalPct} />
            </div>
          </Card>

          {/* Técnico */}
          <Card as="section">
            <CardHeader id="tecnico" title="Projeto técnico" subtitle="Equipamentos, orientação e perdas do sistema" />
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <dl className="space-y-3 text-[14px]">
                <div>
                  <dt className="text-[12px] text-muted">Módulos</dt>
                  <dd>
                    {num(t.module.count)} × {t.module.model} · {pct(t.module.efficiencyPct)} · γ {num(t.module.gammaPmaxPctPerC, 2)}%/°C
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Inversores</dt>
                  <dd>
                    {t.inverter.count} × {t.inverter.model} · {pct(t.inverter.euroEfficiencyPct)} (europeia)
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Estrutura</dt>
                  <dd>
                    {t.mounting === "fixed" ? `Fixa, inclinação ${t.tiltDeg}°, azimute ${t.azimuthDeg}° (Norte)` : `Seguidor de um eixo N-S, ±${t.trackerMaxAngleDeg ?? 55}°`} · albedo {num(t.albedo, 2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Razão DC/AC</dt>
                  <dd className="tnum">{num(t.dcKWp / t.acKW, 2)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Degradação</dt>
                  <dd>
                    {pct(t.degradation.firstYearPct)} no 1º ano, depois {pct(t.degradation.annualPct, 2)}/ano
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Modalidade</dt>
                  <dd>
                    {t.modalidade === "geracao-compartilhada" ? "Geração compartilhada (GD — Lei 14.300/2022)" : t.modalidade} · acesso solicitado em {plant.finance.accessRequestYear}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Comissionamento</dt>
                  <dd>{dateBR(t.commissioning)}</dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tnum">
                  <caption className="mb-2 text-left text-[13px] font-medium text-ink-2">Cascata de perdas (ano 1)</caption>
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="py-1.5 text-left font-medium">Etapa</th>
                      <th className="py-1.5 text-right font-medium">Δ</th>
                      <th className="py-1.5 text-right font-medium">MWh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lossWaterfall.map((l) => (
                      <tr key={l.label} className="border-b border-line/50">
                        <td className="py-1.5 pr-2">{l.label}</td>
                        <td className={`py-1.5 text-right ${l.pct < 0 ? "text-good" : l.pct > 0 ? "text-ink-2" : "text-muted"}`}>{l.pct === 0 ? "—" : pct(-l.pct, 1, true)}</td>
                        <td className="py-1.5 text-right">{num(l.energyMWhAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          {/* Fontes e método */}
          <Card as="section">
            <CardHeader id="fontes" title="Fontes de dados, premissas e método" subtitle={`Análise gerada em ${dateBR(a.generatedAt, true)} · SHA-256 ${a.dataHash.slice(0, 16)}…`} />
            <div className="space-y-6 p-5">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="py-1.5 text-left font-medium">Fonte</th>
                      <th className="py-1.5 text-left font-medium">Status</th>
                      <th className="py-1.5 text-left font-medium">Consulta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.provenance.map((p, i) => (
                      <tr key={`${p.id}-${i}`} className="border-b border-line/50 align-top">
                        <td className="py-2 pr-3">
                          <div className="text-ink">{p.name}</div>
                          {p.note && <div className="text-[12px] text-muted">{p.note}</div>}
                          {p.url.startsWith("http") && (
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="block max-w-[420px] truncate font-mono text-[11px] text-muted hover:text-ink-2">
                              {p.url}
                            </a>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <SourceDot status={p.status} />
                        </td>
                        <td className="py-2 text-muted tnum">{dateBR(p.fetchedAt, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-[14px] font-semibold">Premissas econômicas</h3>
                  <dl className="mt-2 divide-y divide-line/60 text-[13px]">
                    {f.assumptions.map((x) => (
                      <div key={x.label} className="flex justify-between gap-4 py-1.5">
                        <dt className="text-muted">{x.label}</dt>
                        <dd className="text-right text-ink-2 tnum">{x.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold">Método do modelo de geração</h3>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-muted">
                    {g.method.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Coluna lateral */}
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader id="investir" title="Investir" subtitle={`${plant.token.symbol} · BNB Smart Chain`} />
            <div className="p-5">
              <InvestPanel slug={plant.slug} symbol={plant.token.symbol} cotaPriceBRL={plant.token.cotaPriceBRL} cotaPriceUSDT={plant.token.cotaPriceUSDT} minCotas={plant.token.minCotas} monthlyPerCotaBRL={f.perCota.avgMonthlyIncomeBRL} usdtBrl={market.usdtBrl} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Simulador de rendimento" subtitle="Cenário P50" />
            <div className="p-5">
              <Simulator
                cashFlows={f.cashFlows}
                totalCotas={plant.token.totalCotas}
                cotaPriceBRL={plant.token.cotaPriceBRL}
                cotaPriceUSDT={plant.token.cotaPriceUSDT}
                minCotas={plant.token.minCotas}
                cdiNetFinalOf1000={cdi?.finalValueOf1000BRL}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Agora na usina" subtitle="Estimativa em tempo real e previsão" />
            <div className="p-5">
              <LivePanel slug={plant.slug} initial={a.live ?? null} acKW={t.acKW} municipio={plant.location.municipio} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Transparência on-chain" subtitle="Contratos e documentos registrados" />
            <div className="p-5">
              <OnChainPanel slug={plant.slug} dataHash={a.dataHash} />
            </div>
          </Card>
        </aside>
      </Container>
    </div>
  );
}
