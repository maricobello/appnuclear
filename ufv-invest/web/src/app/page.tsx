import Link from "next/link";
import { ArrowRight, Banknote, CloudSun, Database, FileCheck2, Fingerprint, Landmark, LineChart, Lock, MapPin, ShieldCheck, Sun, Undo2, Wallet } from "lucide-react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { brl, brlCompact, num, pct } from "@/lib/fmt";
import { buttonClass, Container, cx } from "@/components/ui";
import { PlantArt } from "@/components/landing/PlantArt";
import { Showcase } from "@/components/showcase/Showcase";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import { OfferProgress } from "@/components/showcase/OfferProgress";
import { BentoCard, BentoGrid, BorderBeam, DotPattern, Marquee, ShinyText } from "@/components/magicui";
import { NumberTicker } from "@/components/magicui/NumberTicker";

const steps = [
  { icon: Wallet, title: "Conecte a carteira", text: "Binance Wallet, MetaMask, Rabby ou WalletConnect. A custódia é sua; nunca pedimos a frase de recuperação." },
  { icon: Fingerprint, title: "Valide a identidade", text: "KYC uma única vez. Sua carteira entra no registro de investidores habilitados do contrato." },
  { icon: Banknote, title: "Reserve cotas em USDT", text: "O valor fica em custódia no contrato. Cada aporte pode ser desistido em até 5 dias." },
  { icon: Sun, title: "Receba a renda", text: "A receita líquida da usina é distribuída em USDT, na proporção das suas cotas." },
];

const sources = ["NASA POWER", "PVGIS · Comissão Europeia", "Banco Central do Brasil", "Relatório Focus", "IBGE", "Open-Meteo", "BNB Smart Chain", "OpenZeppelin"];

const faq = [
  {
    q: "O que eu compro ao investir?",
    a: "Uma cota digital (token BEP-20, sem casas decimais) que representa participação econômica na SPE dona da usina. Ela só circula entre carteiras com KYC aprovado.",
  },
  {
    q: "De onde vem o rendimento?",
    a: "A usina gera créditos de energia na distribuidora (geração compartilhada, Lei 14.300/2022), cedidos a assinantes com desconto na conta de luz. A receita, menos O&M, seguro, arrendamento, gestão e impostos, é distribuída aos cotistas.",
  },
  {
    q: "Como a rentabilidade se compara à Selic?",
    a: "Cada usina mostra a TIR projetada (cenário P50) ao lado da Selic do dia, lida no Banco Central. O relatório em PDF traz a simulação de R$ 10.000 contra Selic/CDI, Tesouro IPCA+ e Poupança no mesmo prazo.",
  },
  {
    q: "Os números são reais?",
    a: "Recurso solar, clima, município e taxas vêm de APIs públicas, com a fonte de cada valor indicada. As usinas desta demonstração são projetos ilustrativos: engenharia e CAPEX são hipóteses de mercado.",
  },
  {
    q: "Posso desistir depois de investir?",
    a: "Sim: cada aporte pode ser desistido em até 5 dias, com devolução integral pelo contrato. Se a oferta não atingir a meta mínima, todo o valor é devolvido.",
  },
  {
    q: "Isso é regulado?",
    a: "No Brasil, ofertas públicas de valores mobiliários exigem registro ou dispensa na CVM. Para investidores reais, a oferta deve passar por plataforma autorizada (Resolução CVM 88). Esta versão roda na testnet.",
  },
];

export default async function Home() {
  const analyses = await getAllAnalyses();
  const all = analyses.map(summarize);
  const featured = [...all].sort((a, b) => Number(b.status === "captacao") - Number(a.status === "captacao") || b.irrNominalPct - a.irrNominalPct)[0];
  const fa = analyses.find((a) => a.plant.slug === featured?.slug);

  const totalKWp = all.reduce((s, x) => s + x.dcKWp, 0);
  const totalMWh = all.reduce((s, x) => s + x.p50MWh, 0);
  const totalCo2 = all.reduce((s, x) => s + x.co2, 0);
  const totalRaise = all.reduce((s, x) => s + x.investmentBRL, 0);
  const minTicket = Math.min(...all.map((x) => x.minInvestmentBRL));
  const selic = fa?.market.selicPct ?? featured?.selicPct ?? 0;

  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <ShowcaseCard key={s.slug} s={s} priority={i === 0} />]));

  // taxas anuais para a comparação com a Selic (usina = TIR nominal P50)
  const cdiNet = fa?.finance.benchmarks.find((b) => b.name.startsWith("CDI"));
  const tesouro = fa?.finance.benchmarks.find((b) => b.name.startsWith("Tesouro"));
  const poup = fa?.finance.benchmarks.find((b) => b.name.startsWith("Poupan"));
  const rates = fa
    ? [
        { label: fa.plant.name, sub: "TIR nominal P50 projetada", v: fa.finance.irrNominalPct, plant: true },
        { label: "Selic (meta)", sub: "Banco Central, hoje", v: selic },
        ...(cdiNet ? [{ label: "CDI médio no prazo", sub: "convergindo ao juro neutro", v: cdiNet.annualPct }] : []),
        ...(tesouro ? [{ label: "Tesouro IPCA+", sub: "juro real + IPCA de longo prazo", v: tesouro.annualPct }] : []),
        ...(poup ? [{ label: "Poupança", sub: "regra da Lei 12.703", v: poup.annualPct }] : []),
      ]
    : [];
  const rateMax = Math.max(1, ...rates.map((r) => r.v));
  const reinvested = fa?.finance.benchmarks.find((b) => /reinvest/i.test(b.name));
  const cdiFinal = cdiNet?.finalValueOf1000BRL;

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-line bg-surface">
        <div className="hero-glow absolute inset-0" aria-hidden />
        <DotPattern />
        <Container className="relative grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            {featured && (
              <Link
                href={`/usinas/${featured.slug}`}
                className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1 text-[13px] font-medium shadow-sm transition hover:border-sun"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-sun opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-sun" />
                </span>
                <ShinyText>Captação aberta · {featured.name}</ShinyText>
                <ArrowRight className="size-3.5 text-muted" />
              </Link>
            )}
            <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink [text-wrap:balance] sm:text-[56px] lg:text-[64px]">
              Invista em usinas solares. <span className="text-muted">Receba a renda da energia.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
              Cotas a partir de <b className="font-semibold text-ink">{brl(minTicket, 0)}</b> em usinas fotovoltaicas no Brasil, com contratos na BNB Chain, custódia até o fim da captação e relatório
              de auditoria verificável.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#vitrine" className={cx(buttonClass.primary, "shimmer-btn px-5 py-3 text-[15px]")}>
                Ver oportunidades <ArrowRight className="size-4" />
              </Link>
              {featured && (
                <Link href={`/usinas/${featured.slug}#investir`} className={cx(buttonClass.secondary, "px-5 py-3 text-[15px]")}>
                  Simular investimento
                </Link>
              )}
            </div>
            {featured && (
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6">
                <div>
                  <dt className="text-[12px] text-muted">TIR alvo</dt>
                  <dd className="mt-1 text-[24px] font-semibold tracking-tight tnum">
                    <NumberTicker value={featured.irrNominalPct} decimals={1} suffix="%" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Selic hoje</dt>
                  <dd className="mt-1 text-[24px] font-semibold tracking-tight text-muted tnum">
                    <NumberTicker value={selic} decimals={2} suffix="%" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">Investimento mínimo</dt>
                  <dd className="mt-1 text-[24px] font-semibold tracking-tight tnum">{brl(minTicket, 0)}</dd>
                </div>
              </dl>
            )}
          </div>

          {featured && (
            <div className="relative mx-auto w-full max-w-[520px]">
              <div className="relative rounded-3xl border border-line bg-surface p-3 shadow-[0_30px_80px_-30px_rgba(15,30,50,0.35)]">
                <BorderBeam />
                <Link href={`/usinas/${featured.slug}`} className="group block overflow-hidden rounded-2xl">
                  {featured.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- capa estática em /public
                    <img src={featured.cover} alt={`${featured.illustrative ? "Ilustração" : "Vista"} da ${featured.name}`} className="aspect-[16/9] w-full object-cover" />
                  ) : (
                    <PlantArt slug={featured.slug} mounting={featured.mounting} title={`Ilustração da ${featured.name}`} className="aspect-[16/9] w-full transition duration-700 group-hover:scale-[1.03]" />
                  )}
                </Link>
                <div className="px-3 pb-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[19px] font-semibold tracking-tight">{featured.name}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
                        <MapPin className="size-3.5" /> {featured.municipio}/{featured.uf} · {num(featured.dcKWp / 1000, 2)} MWp
                      </div>
                    </div>
                    <span className="rounded-full bg-sun px-2.5 py-1 text-[11px] font-semibold text-ink">Em captação</span>
                  </div>

                  <div className="mt-5 space-y-2.5">
                    {[
                      { k: "Usina (TIR P50)", v: featured.irrNominalPct, c: "bg-gradient-to-r from-[#f5a524] to-[#e08600]" },
                      { k: "Selic", v: selic, c: "bg-[#94a3b8]" },
                    ].map((r) => (
                      <div key={r.k} className="grid grid-cols-[96px_1fr_56px] items-center gap-3 text-[13px]">
                        <span className="text-ink-2">{r.k}</span>
                        <div className="h-2 rounded-full bg-surface-3">
                          <div className={cx("h-full rounded-full", r.c)} style={{ width: `${(r.v / Math.max(featured.irrNominalPct, selic)) * 100}%` }} />
                        </div>
                        <span className="text-right font-semibold tnum">{pct(r.v, 1)}</span>
                      </div>
                    ))}
                  </div>

                  <dl className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-surface-2 p-3 text-[13px]">
                    <div>
                      <dt className="text-[11px] text-muted">Renda/cota/mês</dt>
                      <dd className="font-semibold tnum">{brl(featured.monthlyPerCotaBRL)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Payback</dt>
                      <dd className="font-semibold tnum">{featured.paybackYears != null ? `${num(featured.paybackYears, 1)} anos` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-muted">Geração P50</dt>
                      <dd className="font-semibold tnum">{num(featured.p50MWh / 1000, 1)} GWh</dd>
                    </div>
                  </dl>
                  <div className="mt-4">
                    <OfferProgress slug={featured.slug} status={featured.status} totalCotas={featured.totalCotas} softCapCotas={featured.softCapCotas} offeringStart={featured.offeringStart} offeringEnd={featured.offeringEnd} />
                  </div>
                </div>
              </div>

              {featured.forecastNextMWh != null && featured.forecastNextMWh > 0 && (
                <div className="absolute -bottom-6 -left-6 hidden items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-xl backdrop-blur sm:flex">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <CloudSun className="size-5" />
                  </span>
                  <div>
                    <div className="text-[11px] text-muted">Previsão de geração amanhã</div>
                    <div className="text-[16px] font-semibold tnum">{num(featured.forecastNextMWh, 1)} MWh</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Container>
      </section>

      {/* FONTES DE DADOS (marquee) */}
      <section className="border-b border-line bg-surface py-6">
        <Container className="flex flex-col items-center gap-4 sm:flex-row">
          <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-muted">Dados e infraestrutura</span>
          <Marquee className="w-full">
            {sources.map((s) => (
              <span key={s} className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold text-ink-2/70">
                <Database className="size-4 text-muted" /> {s}
              </span>
            ))}
          </Marquee>
        </Container>
      </section>

      {/* NÚMEROS */}
      <section className="bg-page">
        <Container className="grid grid-cols-2 gap-8 py-14 lg:grid-cols-4">
          {[
            { k: "Potência na vitrine", node: <NumberTicker value={totalKWp / 1000} decimals={1} suffix=" MWp" /> },
            { k: "Geração anual (P50)", node: <NumberTicker value={totalMWh / 1000} decimals={1} suffix=" GWh" /> },
            { k: "Volume de captação", node: <NumberTicker value={totalRaise / 1e6} decimals={1} prefix="R$ " suffix=" mi" /> },
            { k: "CO₂ evitado por ano", node: <NumberTicker value={totalCo2} suffix=" t" /> },
          ].map((m) => (
            <div key={m.k} className="border-l border-line-strong pl-5">
              <div className="text-[30px] font-semibold tracking-tight tnum sm:text-[34px]">{m.node}</div>
              <div className="mt-1 text-[13px] text-muted">{m.k}</div>
            </div>
          ))}
        </Container>
      </section>

      {/* SELIC × USINA */}
      {fa && rates.length > 0 && (
        <section className="border-y border-line bg-surface py-20">
          <Container className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Energia solar × Selic</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight [text-wrap:balance] sm:text-[42px] sm:leading-[1.1]">
                {pct(fa.finance.irrNominalPct - selic, 1)} acima da Selic, com lastro em um ativo real.
              </h2>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
                A Selic de hoje ({pct(selic, 2)} a.a., Banco Central) ao lado da TIR projetada da {fa.plant.name}. No prazo de {fa.plant.finance.horizonYears} anos, R$ 10.000 com a renda reinvestida
                no CDI chegariam a <b className="text-ink">{reinvested ? brl(reinvested.finalValueOf1000BRL * 10, 0) : "—"}</b>, contra{" "}
                <b className="text-ink">{cdiFinal ? brl(cdiFinal * 10, 0) : "—"}</b> aplicando tudo direto no CDI.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href={`/api/usinas/${fa.plant.slug}/relatorio`} className={buttonClass.primary}>
                  <FileCheck2 className="size-4" /> Baixar o relatório (PDF)
                </a>
                <Link href={`/usinas/${fa.plant.slug}#economia`} className={buttonClass.secondary}>
                  Ver a análise completa
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
              <div className="flex items-baseline justify-between text-[13px] text-muted">
                <span>Rentabilidade anual</span>
                <span>% a.a.</span>
              </div>
              <ul className="mt-5 space-y-5">
                {rates.map((r) => (
                  <li key={r.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <div className={cx("text-[15px]", r.plant ? "font-semibold text-ink" : "text-ink-2")}>{r.label}</div>
                        <div className="text-[12px] text-muted">{r.sub}</div>
                      </div>
                      <div className={cx("text-[18px] font-semibold tnum", r.plant ? "text-brand" : "text-ink-2")}>{pct(r.v, r.v < 10 ? 2 : 1)}</div>
                    </div>
                    <div className="mt-2 h-2.5 rounded-full bg-surface-3">
                      <div className={cx("h-full rounded-full", r.plant ? "bg-gradient-to-r from-[#f5a524] to-[#e08600]" : "bg-[#2a78d6]/70")} style={{ width: `${(r.v / rateMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-line pt-4 text-[12px] text-muted">
                Projeção do cenário P50, antes de impostos do investidor; não é garantia. Selic e CDI lidos no Banco Central (SGS); CDI e Tesouro como média do prazo.
              </p>
            </div>
          </Container>
        </section>
      )}

      {/* VITRINE */}
      <section id="vitrine" className="scroll-mt-24 bg-page py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Oportunidades</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Usinas disponíveis</h2>
              <p className="mt-3 text-[16px] text-ink-2">Cada usina abre com geração mês a mês, cenários de risco, fluxo de caixa e o relatório de auditoria em PDF.</p>
            </div>
            <Link href="/usinas" className={buttonClass.ghost}>
              Todas as usinas <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-10">
            <Showcase items={all} cards={cards} />
          </div>
          <p className="mt-6 text-[12px] text-muted">Projeções P50 de projetos ilustrativos, antes de impostos do investidor. Rentabilidade alvo não é garantia de resultado.</p>
        </Container>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="scroll-mt-24 border-y border-line bg-surface py-20">
        <Container>
          <div className="max-w-2xl">
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Como funciona</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Do sol à sua carteira, em quatro passos</h2>
          </div>
          <ol className="relative mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-line-strong lg:block" aria-hidden />
            {steps.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="relative z-10 flex size-12 items-center justify-center rounded-2xl border border-line-strong bg-surface text-ink shadow-sm">
                  <s.icon className="size-5" />
                </span>
                <div className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-muted">Passo {i + 1}</div>
                <h3 className="mt-1 text-[18px] font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* CONFIANÇA — bento */}
      <section className="bg-page py-20">
        <Container>
          <div className="max-w-2xl">
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Confiança</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Feito para ser verificado</h2>
          </div>
          <BentoGrid className="mt-10">
            <BentoCard
              className="md:col-span-2"
              icon={<LineChart className="size-5" />}
              title="Modelo de engenharia aberto"
              text="Geração hora a hora com satélite da NASA, validação cruzada com o PVGIS (Comissão Europeia), cenários P50/P90 e Monte Carlo com 2.000 simulações."
            >
              <div className="dot-pattern absolute -right-10 -top-10 size-64 opacity-60" />
            </BentoCard>
            <BentoCard icon={<Undo2 className="size-5" />} title="Custódia com devolução" text="Na captação o dinheiro fica no contrato. Meta não atingida, devolução integral para cada investidor." />
            <BentoCard icon={<FileCheck2 className="size-5" />} title="Relatório verificável" text="PDF com os dados anexados; o hash SHA-256 fica registrado no contrato e qualquer pessoa confere em /verificar." />
            <BentoCard icon={<Landmark className="size-5" />} title="Comparado à Selic" text="Selic, CDI e IPCA lidos no Banco Central a cada análise; o retorno é sempre mostrado contra a renda fixa." />
            <BentoCard icon={<ShieldCheck className="size-5" />} title="Contratos testados e imutáveis" text="OpenZeppelin v5, sem proxy de atualização, 137 testes e auditoria interna com provas de ataque." />
            <BentoCard
              className="md:col-span-3"
              icon={<Lock className="size-5" />}
              title="Conexão segura e não-custodial"
              text="Descoberta de carteiras EIP-6963, login por assinatura (SIWE), aprovação no valor exato e simulação de cada transação antes de assinar. Toda reserva, distribuição e resgate é pública no BscScan."
            />
          </BentoGrid>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-line bg-surface py-20">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Perguntas frequentes</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Antes de investir</h2>
            <p className="mt-3 text-[15px] text-ink-2">
              Veja também a página de{" "}
              <Link href="/seguranca" className="font-medium text-ink underline underline-offset-4">
                segurança
              </Link>{" "}
              e os riscos no relatório de cada usina.
            </p>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {faq.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {f.q}
                  <span className="text-[20px] leading-none text-muted transition group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* CTA FINAL */}
      <section className="bg-surface pb-8">
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center sm:px-12">
            <BorderBeam />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_-10%,rgba(245,165,36,0.25),transparent_60%)]" aria-hidden />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white [text-wrap:balance] sm:text-[42px] sm:leading-[1.1]">
                Comece com {brl(minTicket, 0)} e acompanhe cada kWh.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[16px] text-white/70">Conecte a carteira, valide a identidade e reserve suas cotas em minutos.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="#vitrine" className="shimmer-btn inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-[15px] font-semibold text-ink transition hover:bg-white/90">
                  Explorar usinas <ArrowRight className="size-4" />
                </Link>
                <Link href="/seguranca" className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-white/10">
                  Como protegemos você
                </Link>
              </div>
              <p className="mx-auto mt-8 max-w-xl text-[12px] text-white/50">{brlCompact(totalRaise)} em captação na vitrine · contratos na BNB Smart Chain Testnet</p>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
