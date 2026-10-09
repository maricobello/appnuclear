import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Download, ExternalLink, FileJson, FileText, MapPin, Receipt, ShieldCheck, Zap } from "lucide-react";
import { plants } from "@/data/plants";
import { getPlantAnalysis, plantScale } from "@/lib/analysis";
import { brl, brlCompact, dateBR, MONTHS, num, pct, years } from "@/lib/fmt";
import { Badge, buttonClass, Card, CardHeader, Container, cx, IconBubble, Notice, SourceDot, Stat, StatusChip } from "@/components/ui";
import { BenchmarksChart, CashFlowChart, GenerationChart, IrradianceChart, MonteCarloChart, TornadoChart } from "@/components/plant/Charts";
import { LivePanel } from "@/components/plant/LivePanel";
import { OnChainPanel } from "@/components/plant/OnChainPanel";
import { Gallery } from "@/components/aferi/Gallery";
import { Tabs } from "@/components/aferi/Tabs";
import { GenerationOverview } from "@/components/aferi/GenerationOverview";
import { QuickSimulator } from "@/components/aferi/QuickSimulator";
import { InterestButton } from "@/components/aferi/InterestDialog";
import { SoldPanel } from "@/components/aferi/Sold";
import { mwp } from "@/components/aferi/PlantCard";

export function generateStaticParams() {
  return plants.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/usinas/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = plants.find((x) => x.slug === slug);
  return p ? { title: p.name, description: `${p.tagline}. ${p.location.municipio}/${p.location.uf}, ${num(p.tech.dcKWp / 1000, 1)} MWp.`, openGraph: { images: p.cover ? [p.cover] : [] } } : {};
}

function dms(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}′${s.toFixed(1).replace(".", ",")}″ ${v >= 0 ? pos : neg}`;
}

function Indicator({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className={cx("text-[20px] font-bold tnum", tone === "good" ? "text-good" : "text-ink")}>{value}</div>
      <div className="mt-0.5 text-[12px] text-muted">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export default async function PlantPage({ params }: PageProps<"/usinas/[slug]">) {
  const { slug } = await params;
  const a = await getPlantAnalysis(slug);
  if (!a) notFound();
  const { plant, generation: g, finance: f, resource, location, market } = a;
  const t = plant.tech;
  const p90Ratio = g.annualP50MWh > 0 ? g.p90MWh / g.annualP50MWh : 0.9;
  const fallbackCount = a.provenance.filter((p) => p.status === "fallback" || p.status === "error").length;
  const gallery = plant.gallery?.length ? plant.gallery : plant.cover ? [plant.cover] : [];
  const com = plant.commercial;
  const scale = plantScale(plant);

  // Histórico: geração estimada com a irradiação medida por satélite (NASA POWER) no último ano completo
  let history: { year: number; values: (number | null)[] } | null = null;
  let historyNote = "";
  const comm = new Date(t.commissioning);
  if (plant.status === "implantacao") {
    historyNote = `Usina em implantação (comissionamento previsto para ${dateBR(t.commissioning)}): ainda sem histórico de geração.`;
  } else if (!resource.lastYear) {
    historyNote = "Série de irradiação do último ano indisponível agora (NASA POWER); mostrando a projeção.";
  } else {
    const ly = resource.lastYear;
    const values = g.monthly.map((m, i) => {
      const monthStart = new Date(Date.UTC(ly.year, i, 1));
      if (monthStart < new Date(Date.UTC(comm.getUTCFullYear(), comm.getUTCMonth(), 1))) return null;
      const clim = resource.monthly.ghiKWhM2Day[i];
      return clim > 0 ? m.energyMWh * (ly.ghiKWhM2Day[i] / clim) : null;
    });
    if (values.some((v) => v != null)) {
      history = { year: ly.year, values };
      historyNote = "Estimativa com a irradiação medida por satélite (NASA POWER) em cada mês — a medição do medidor da usina substitui este valor quando integrada.";
    } else {
      historyNote = `Usina em operação desde ${dateBR(t.commissioning)}: o histórico aparece após o primeiro ano completo.`;
    }
  }

  const docs = [
    { href: `/api/usinas/${plant.slug}/relatorio`, title: "Relatório para o investidor", meta: "PDF · 4 páginas · investimento × Selic", icon: FileText },
    { href: `/api/usinas/${plant.slug}/relatorio?versao=completa`, title: "Relatório de auditoria completo", meta: "PDF · geração, economia, riscos e fontes", icon: FileText },
    { href: `/api/usinas/${plant.slug}/analise`, title: "Dados da análise (JSON)", meta: `SHA-256 ${a.dataHash.slice(0, 12)}…`, icon: FileJson },
  ];

  const documentsList = (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.href}>
          <a href={d.href} className="group flex items-center gap-3 py-3" {...(d.href.endsWith("analise") ? { target: "_blank", rel: "noopener" } : {})}>
            <span className="flex size-9 items-center justify-center rounded-lg bg-[#fdecec] text-critical">
              <d.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink group-hover:text-good">{d.title}</span>
              <span className="block text-[11px] text-muted">{d.meta}</span>
            </span>
            <Download className="size-4 text-ink-2 group-hover:text-good" aria-label="Baixar" />
          </a>
        </li>
      ))}
    </ul>
  );

  const visaoGeral = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="p-5">
        <GenerationOverview projection={g.monthly.map((m) => m.energyMWh)} history={history} historyNote={historyNote} />
      </Card>
      <Card className="p-5">
        <QuickSimulator slug={plant.slug} cotaPriceBRL={plant.token.cotaPriceBRL} monthlyPerCotaBRL={f.perCota.avgMonthlyIncomeBRL} maxCotas={plant.token.totalCotas} minCotas={plant.token.minCotas} />
      </Card>
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">Documentos</h3>
        <div className="mt-1">{documentsList}</div>
      </Card>
      <Card className="flex flex-col p-5">
        <h3 className="text-[15px] font-semibold text-ink">Sobre o ativo</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{plant.about}</p>
        <div className="mt-auto pt-5">
          {plant.status === "encerrada" ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">Oferta encerrada: todas as cotas foram vendidas.</p>
          ) : (
            <InterestButton usina={{ slug: plant.slug, name: plant.name }} label="Tenho interesse →" className={cx(buttonClass.primary, "w-full")} />
          )}
        </div>
      </Card>
    </div>
  );

  const desempenho = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <Card as="section">
          <CardHeader title="Geração de energia estimada" subtitle={`Modelo horário com ${t.mounting === "fixed" ? `estrutura fixa ${num(t.tiltDeg)}°` : "seguidor de um eixo"} · ano 1`} />
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
                    <th className="py-2 pl-4 text-left font-medium">Leitura</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {(
                    [
                      ["P50", g.annualP50MWh, "50% de chance de gerar mais"],
                      ["P75", g.p75MWh, "75% de chance de gerar mais"],
                      ["P90", g.p90MWh, "90% de chance (ano isolado)"],
                      ["P90 (10 anos)", g.p90TenYearMWh, "média de 10 anos — usado por bancos"],
                      ["P99", g.p99MWh, "cenário extremo"],
                    ] as const
                  ).map(([k, v, d]) => (
                    <tr key={k} className="border-b border-line/60">
                      <td className="py-2 font-medium text-ink">{k}</td>
                      <td className="py-2 text-right">{num(v)}</td>
                      <td className="py-2 text-right text-muted">{pct((v / g.annualP50MWh - 1) * 100, 1)}</td>
                      <td className="py-2 pl-4 text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] text-muted">
              Incerteza total {pct(g.uncertainty.totalPct)} (variabilidade interanual {pct(g.uncertainty.interannualPct)}, dado de recurso {pct(g.uncertainty.resourceDataPct)}, modelo {pct(g.uncertainty.modelPct)}).
              {g.crossCheck && ` Validação cruzada com o ${g.crossCheck.source}: ${num(g.crossCheck.annualMWh)} MWh/ano (desvio ${pct(g.crossCheck.deviationPct, 1, true)}).`}
            </p>
          </div>
        </Card>
        <Card as="section">
          <CardHeader title="Retorno do investimento" subtitle={`Perspectiva do cotista · ${plant.finance.horizonYears} anos · taxa de desconto ${pct(f.discountRatePct)} a.a.`} />
          <div className="p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Captação" value={brlCompact(f.investmentBRL)} hint={`CAPEX ${brlCompact(f.capexBRL)}`} />
              <Stat label="VPL" value={brlCompact(f.npvBRL)} tone={f.npvBRL >= 0 ? "good" : "default"} />
              <Stat label="TIR nominal / real" value={pct(f.irrNominalPct)} hint={`real ${pct(f.irrRealPct)}`} tone="good" />
              <Stat label="LCOE" value={`R$ ${num(f.lcoeBRLPerMWh)}`} hint="por MWh" />
              <Stat label="Payback simples" value={f.paybackYears != null ? `${num(f.paybackYears, 1)} anos` : "—"} hint={years(f.paybackYears)} />
              <Stat label="ROI no horizonte" value={pct(f.roiTotalPct, 0)} hint={`MOIC ${num(f.moic, 2)}×`} />
              <Stat label="Yield ano 1" value={pct(f.firstYearYieldPct)} hint={`médio ${pct(f.avgYieldPct)}`} />
              <Stat label="Renda total/cota" value={brl(f.perCota.totalIncomeBRL)} hint={`cota de ${brl(f.perCota.priceBRL, 0)}`} />
            </div>
            <div className="mt-6">
              <CashFlowChart cashFlows={f.cashFlows} />
            </div>
            <div className="mt-6">
              <h3 className="text-[14px] font-semibold">Quanto vira R$ 1.000 em {plant.finance.horizonYears} anos × Selic, CDI, Tesouro e poupança</h3>
              <BenchmarksChart benchmarks={f.benchmarks} />
              <ul className="mt-3 space-y-2 text-[13px] text-muted">
                {f.benchmarks.map((b) => (
                  <li key={b.name}>
                    <b className="text-ink-2">{b.name}</b> ({pct(b.annualPct)} a.a.): {b.note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>
      <aside className="space-y-6">
        <Card>
          <CardHeader title="Agora na usina" subtitle="Estimativa em tempo real e previsão" />
          <div className="p-5">
            <LivePanel slug={plant.slug} initial={a.live ?? null} acKW={t.acKW} municipio={plant.location.municipio} />
          </div>
        </Card>
      </aside>
    </div>
  );

  const tecnico = (
    <div className="space-y-6">
      <Card as="section">
        <CardHeader title="Projeto técnico" subtitle="Equipamentos, orientação e perdas do sistema" />
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <dl className="space-y-3 text-[14px]">
            {(
              [
                ["Módulos", `${num(t.module.count)} × ${t.module.model} · ${pct(t.module.efficiencyPct)} · γ ${num(t.module.gammaPmaxPctPerC, 2)}%/°C`],
                ["Inversores", `${t.inverter.count} × ${t.inverter.model} · ${pct(t.inverter.euroEfficiencyPct)} (europeia)`],
                ["Potência", `${num(t.dcKWp)} kWp (CC) · ${num(t.acKW)} kW (CA) · razão ${num(t.dcKWp / t.acKW, 2)}`],
                ["Estrutura", t.mounting === "fixed" ? `Fixa, inclinação ${t.tiltDeg}°, voltada ao Norte · albedo ${num(t.albedo, 2)}` : `Seguidor de um eixo N-S, ±${t.trackerMaxAngleDeg ?? 55}° · albedo ${num(t.albedo, 2)}`],
                ["Degradação", `${pct(t.degradation.firstYearPct)} no 1º ano, depois ${pct(t.degradation.annualPct, 2)}/ano`],
                ["Modalidade", `${t.modalidade === "geracao-compartilhada" ? "Geração compartilhada (GD — Lei 14.300/2022)" : t.modalidade} · acesso solicitado em ${plant.finance.accessRequestYear}`],
                ["Comissionamento", dateBR(t.commissioning)],
                ["Área", `${num(t.landAreaHa, 1)} ha`],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
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

      <Card as="section">
        <CardHeader title="Local e recurso solar" subtitle="Dados do município (IBGE) e climatologia de satélite (NASA POWER)" />
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
              <dd>
                {plant.location.distribuidora} · {plant.location.submercado}
              </dd>
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

      <Card as="section">
        <CardHeader title="Fontes de dados, premissas e método" subtitle={`Análise gerada em ${dateBR(a.generatedAt, true)} · SHA-256 ${a.dataHash.slice(0, 16)}…`} />
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
                      {p.note && <div className="max-w-[560px] break-words text-[12px] text-muted">{p.note}</div>}
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
  );

  const documentos = (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-ink">Documentos da usina</h3>
        <p className="mt-1 text-[13px] text-muted">Gerados na hora a partir da análise atual. O JSON canônico vai anexado aos PDFs e reproduz o hash impresso.</p>
        <div className="mt-2">{documentsList}</div>
        <Link href="/verificar" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline">
          <ShieldCheck className="size-4" /> Verificar a autenticidade de um relatório
        </Link>
      </Card>
      <Card>
        <CardHeader title="Transparência on-chain" subtitle="Contratos e documentos registrados na BNB Chain" />
        <div className="p-5">
          <OnChainPanel slug={plant.slug} dataHash={a.dataHash} />
        </div>
      </Card>
    </div>
  );

  const riscos = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card as="section">
        <CardHeader title="Risco e incerteza" subtitle={`Monte Carlo com ${num(f.monteCarlo.runs)} cenários e sensibilidade por variável`} />
        <div className="p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="TIR P10" value={pct(f.monteCarlo.irrP10Pct)} hint="pessimista" />
            <Stat label="TIR P50" value={pct(f.monteCarlo.irrP50Pct)} tone="good" />
            <Stat label="TIR P90" value={pct(f.monteCarlo.irrP90Pct)} hint="otimista" />
            <Stat label="Chance TIR < CDI" value={pct(f.monteCarlo.probIrrBelowCdiPct, 0)} hint={`VPL < 0: ${pct(f.monteCarlo.probNpvNegativePct, 0)}`} />
          </div>
          <div className="mt-5">
            <MonteCarloChart mc={f.monteCarlo} cdiPct={market.cdiPct} />
          </div>
          <p className="mt-2 text-[13px] text-muted">Variáveis sorteadas: {f.monteCarlo.variables.join(" · ")}.</p>
          <h3 className="mt-6 text-[14px] font-semibold">Sensibilidade da TIR — variação em p.p. sobre a base de {pct(f.irrNominalPct)}</h3>
          <TornadoChart rows={f.sensitivity} baseIrr={f.irrNominalPct} />
        </div>
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold text-ink">Condições da oferta</h3>
          <ul className="mt-3 space-y-2.5 text-[13px] text-ink-2">
            <li>
              <b className="text-ink">Meta mínima:</b> {num(plant.token.softCapCotas)} cotas ({brlCompact(plant.token.softCapCotas * plant.token.cotaPriceBRL)}). Se não for atingida, todo o valor é devolvido pelo contrato.
            </li>
            <li>
              <b className="text-ink">Desistência:</b> até 5 dias após cada aporte, com devolução integral.
            </li>
            <li>
              <b className="text-ink">Custódia:</b> o pagamento (USDT) fica no contrato da oferta até o encerramento; as cotas são entregues depois.
            </li>
            <li>
              <b className="text-ink">Prazo contratual:</b> {plant.finance.horizonYears} anos de distribuição da receita líquida, mensalmente.
            </li>
            <li>
              <b className="text-ink">Período:</b> {plant.token.offeringStart ? `${dateBR(plant.token.offeringStart)} a ${dateBR(plant.token.offeringEnd ?? "")}` : "a definir"}.
            </li>
            <li>
              <b className="text-ink">Liquidez:</b> as cotas só circulam entre carteiras com KYC aprovado; não há garantia de recompra.
            </li>
          </ul>
        </Card>
        {plant.illustrative && (
          <Notice tone="warning" title="Projeto ilustrativo">
            Local, regras regulatórias e recurso solar são reais; engenharia, CAPEX, subscrição e tokenização são hipóteses de mercado para demonstrar a plataforma.
          </Notice>
        )}
        {plant.status === "operacao" && (
          <Notice tone="info" title={`Em operação desde ${dateBR(t.commissioning)}`}>
            Os indicadores consideram o fluxo desde a emissão das cotas ({plant.finance.startYear}). O retorno efetivo de quem entra agora depende do preço pago pela cota.
          </Notice>
        )}
        <Notice tone="info" title="Não é garantia de rentabilidade">
          Projeções de modelos, antes de impostos do investidor. Há risco de geração abaixo do esperado, mudança regulatória, inadimplência de assinantes e perda do capital.
        </Notice>
      </div>
    </div>
  );

  return (
    <Container className="pt-5">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link href="/" className="hover:text-ink">
          Início
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href="/usinas" className="hover:text-ink">
          Usinas
        </Link>
        <ChevronRight className="size-3.5" />
        <span aria-current="page" className="text-ink-2">
          {plant.name}
        </span>
      </nav>

      <div className="mt-3">
        <Gallery images={gallery} name={plant.name} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={plant.status} />
            {plant.illustrative && <Badge tone="warning">Projeto ilustrativo</Badge>}
            <Badge>{plant.token.symbol}</Badge>
          </div>
          <h1 className="mt-2 text-[28px] font-bold tracking-tight text-navy sm:text-[32px]">{plant.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-[14px] text-muted">
            <MapPin className="size-4" /> {plant.location.municipio} - {plant.location.uf} · {plant.location.distribuidora}
          </p>
          <div className="mt-5 flex flex-wrap gap-8">
            <div className="flex items-center gap-3">
              <IconBubble>
                <Zap className="size-5" />
              </IconBubble>
              <div>
                <div className="text-[18px] font-bold text-ink tnum">{mwp(t.dcKWp)}</div>
                <div className="text-[12px] text-muted">Potência instalada</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <IconBubble>
                <Receipt className="size-5" />
              </IconBubble>
              <div>
                <div className="text-[18px] font-bold text-ink tnum">{brl(plant.token.cotaPriceBRL, 0)}</div>
                <div className="text-[12px] text-muted">Valor da cota</div>
              </div>
            </div>
          </div>
        </div>
        <Card className="p-5">
          <SoldPanel illustrative={plant.illustrative} slug={plant.slug} total={plant.token.totalCotas} demoSold={plant.token.demoSoldCotas ?? 0} status={plant.status} />
          {plant.status !== "encerrada" ? (
            <Link href={`/usinas/${plant.slug}/investir`} className={cx(buttonClass.primary, "mt-4 w-full")}>
              Investir nesta usina
            </Link>
          ) : (
            <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-center text-[13px] font-medium text-ink-2">Oferta encerrada</div>
          )}
        </Card>
      </div>

      <section className="mt-8" aria-labelledby="indicadores">
        <h2 id="indicadores" className="text-[17px] font-semibold text-ink">
          Indicadores financeiros
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Indicator label="Investimento mínimo" value={brl(plant.token.minCotas * plant.token.cotaPriceBRL, 0)} />
          <Indicator label="Distribuição mensal (por cota)" value={brl(f.perCota.avgMonthlyIncomeBRL)} tone="good" hint="média no cenário P50" />
          <Indicator label="Rentabilidade anual (estimada)" value={`${pct(f.irrNominalPct)} a.a.`} hint={`TIR nominal · Selic hoje ${pct(market.selicPct, 2)}`} />
          <Indicator label={`ROI estimado (${plant.finance.horizonYears} anos)`} value={pct(f.roiTotalPct, 0)} tone="good" hint={f.paybackYears != null ? `capital de volta em ~${num(Math.ceil(f.paybackYears))} anos` : undefined} />
          <Indicator label="Prazo contratual" value={`${plant.finance.horizonYears} anos`} />
          <div className="col-span-1 rounded-xl border border-line bg-white p-4 md:col-span-3">
            <div className="text-[13px] font-semibold text-ink">Atualizado em {dateBR(a.generatedAt, true)}</div>
            <div className="mt-0.5 text-[12px] text-muted">
              Data de referência dos indicadores · fontes {a.provenance.length - fallbackCount} ao vivo/cache, {fallbackCount} em modo referência ·{" "}
              <a href={`/api/usinas/${plant.slug}/analise`} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 font-medium text-good hover:underline">
                ver dados <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="comercial">
        <h2 id="comercial" className="text-[17px] font-semibold text-ink">
          Dados do ativo
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-[12px] text-muted">Contrato de energia (PPA)</div>
            <div className={cx("mt-1 text-[16px] font-bold", com?.ppaActive ? "text-good" : "text-ink-2")}>{com?.ppaActive ? "PPA ativo" : "Sem PPA ativo"}</div>
            <div className="mt-1 text-[12px] text-muted">
              {com?.ppaActive ? [com.ppaCounterparty, com.ppaEndDate && `vigente até ${dateBR(com.ppaEndDate)}`].filter(Boolean).join(" · ") : (com?.notes ?? "Energia sem contrato de longo prazo")}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-[12px] text-muted">Preço de venda do ativo</div>
            <div className="mt-1 text-[16px] font-bold text-ink tnum">{brlCompact(com?.askingPriceBRL ?? f.investmentBRL)}</div>
            <div className="mt-1 text-[12px] text-muted tnum">
              {brl((com?.askingPriceBRL ?? f.investmentBRL) / (t.dcKWp * 1000), 2)}/Wp · {num(plant.token.totalCotas)} cotas
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-[12px] text-muted">Escala e tamanho</div>
            <div className="mt-1 text-[16px] font-bold text-ink">{scale}</div>
            <div className="mt-1 text-[12px] text-muted tnum">
              {num(t.dcKWp)} kWp CC · {num(t.acKW)} kW CA · {num(t.landAreaHa, 1)} ha
            </div>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="text-[12px] text-muted">Equipamentos</div>
            <div className="mt-1 text-[13px] font-semibold leading-snug text-ink">
              {num(t.module.count)} × {t.module.wp} Wp
            </div>
            <div className="mt-1 text-[12px] leading-snug text-muted">
              {t.module.model} · {t.inverter.count} × {t.inverter.model} · {t.mounting === "fixed" ? `estrutura fixa ${t.tiltDeg}°` : "seguidor solar"}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8">
        <Tabs
          tabs={[
            { id: "visao-geral", label: "Visão geral", content: visaoGeral },
            { id: "desempenho", label: "Desempenho", content: desempenho },
            { id: "dados-tecnicos", label: "Dados técnicos", content: tecnico },
            { id: "documentos", label: "Documentos", content: documentos },
            { id: "riscos", label: "Riscos e condições", content: riscos },
          ]}
        />
      </div>
    </Container>
  );
}
