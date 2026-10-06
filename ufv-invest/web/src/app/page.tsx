import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  FileCheck2,
  Fingerprint,
  LineChart,
  Lock,
  ShieldCheck,
  Sparkles,
  Sun,
  Undo2,
  Wallet,
  Zap,
} from "lucide-react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { brl, brlCompact, num, pct } from "@/lib/fmt";
import { buttonClass, Container, cx } from "@/components/ui";
import { PlantArt } from "@/components/landing/PlantArt";
import { Showcase } from "@/components/showcase/Showcase";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";

const steps = [
  { icon: Wallet, title: "Conecte a carteira", text: "Binance Wallet, MetaMask, Rabby, Trust ou WalletConnect. A custódia é sua — nunca pedimos a seed." },
  { icon: Fingerprint, title: "Valide a identidade", text: "KYC uma única vez. Sua carteira entra no registro de investidores habilitados do contrato." },
  { icon: Banknote, title: "Reserve cotas em USDT", text: "O valor fica em custódia no contrato. 5 dias para desistir; meta mínima não atingida = devolução integral." },
  { icon: Sun, title: "Receba a renda", text: "A receita líquida da usina é distribuída em USDT, pro-rata, direto no contrato. Resgate quando quiser." },
];

const trust = [
  { icon: LineChart, title: "Modelo de engenharia aberto", text: "Geração hora a hora com satélite da NASA, validação cruzada com o PVGIS (Comissão Europeia), P50/P90 e Monte Carlo com 2.000 cenários.", span: "lg:col-span-2" },
  { icon: FileCheck2, title: "Relatório verificável", text: "PDF de auditoria com os dados anexados; o hash SHA-256 é registrado no contrato e qualquer pessoa confere em /verificar." },
  { icon: Undo2, title: "Custódia com devolução", text: "Na captação o dinheiro fica no contrato, não na empresa. Meta não atingida, devolução para cada investidor." },
  { icon: ShieldCheck, title: "Contratos imutáveis e testados", text: "OpenZeppelin v5, sem proxy de atualização, 137 testes e auditoria interna com provas de ataque.", span: "lg:col-span-2" },
  { icon: Lock, title: "Conexão segura", text: "Descoberta EIP-6963, login por assinatura (SIWE), aprovação no valor exato e simulação antes de assinar." },
  { icon: BadgeCheck, title: "Transparência on-chain", text: "Cada reserva, distribuição e resgate é pública no BscScan; a análise de cada usina fica aberta em JSON." },
];

const faq = [
  {
    q: "O que eu compro ao investir?",
    a: "Uma cota digital (token BEP-20 com 0 casas decimais) que representa participação econômica na SPE dona da usina. Ela só circula entre carteiras com KYC aprovado, como exige um valor mobiliário.",
  },
  {
    q: "De onde vem o rendimento?",
    a: "A usina gera créditos de energia na distribuidora (geração compartilhada, Lei 14.300/2022) cedidos a assinantes com desconto na conta de luz. A receita, menos O&M, seguro, arrendamento, gestão e impostos, é distribuída aos cotistas.",
  },
  {
    q: "Os números são reais?",
    a: "Recurso solar, clima, dados do município e taxas (Selic, CDI, IPCA) vêm de APIs públicas, com a fonte de cada valor indicada. As usinas desta demonstração são projetos ilustrativos: engenharia e CAPEX são hipóteses de mercado.",
  },
  {
    q: "Qual carteira é a mais segura?",
    a: "Carteira de hardware (Ledger ou Trezor) conectada pela Rabby — que simula cada transação — ou pela MetaMask. A Binance Wallet é nativa da BNB Chain. A Phantom é focada em Solana.",
  },
  {
    q: "Posso desistir depois de investir?",
    a: "Sim: cada aporte pode ser desistido em até 5 dias, com devolução integral pelo contrato. Se a oferta não atingir a meta mínima, todo o valor é devolvido.",
  },
  {
    q: "Isso é regulado?",
    a: "No Brasil, ofertas públicas de valores mobiliários exigem registro ou dispensa na CVM. Para investidores reais, a oferta deve passar por plataforma de investimento participativo autorizada (Resolução CVM 88). Esta versão roda na testnet para demonstração.",
  },
];

export default async function Home() {
  const analyses = await getAllAnalyses();
  const all = analyses.map(summarize);
  const featured = [...all].sort((a, b) => Number(b.status === "captacao") - Number(a.status === "captacao"))[0];
  const featuredAnalysis = analyses.find((a) => a.plant.slug === featured?.slug);

  const totalKWp = all.reduce((s, x) => s + x.dcKWp, 0);
  const totalMWh = all.reduce((s, x) => s + x.p50MWh, 0);
  const totalCo2 = all.reduce((s, x) => s + x.co2, 0);
  const totalRaise = all.reduce((s, x) => s + x.investmentBRL, 0);
  const minTicket = Math.min(...all.map((x) => x.minInvestmentBRL));
  const irrMin = Math.min(...all.map((x) => x.irrNominalPct));
  const irrMax = Math.max(...all.map((x) => x.irrNominalPct));

  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <ShowcaseCard key={s.slug} s={s} priority={i === 0} />]));

  // comparação com renda fixa (usina em destaque, renda reinvestida no CDI × aplicações tradicionais)
  const bench = featuredAnalysis?.finance.benchmarks.filter((b) => !/acumuladas/i.test(b.name)) ?? [];
  const benchMax = Math.max(1, ...bench.map((b) => b.finalValueOf1000BRL));

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="hero-glow absolute inset-0" aria-hidden />
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <Container className="relative grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">
              <Sparkles className="size-4" /> Cotas de usinas solares na BNB Chain
            </div>
            <h1 className="mt-6 text-[42px] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-6xl lg:text-[68px]">
              Energia do sol,
              <br />
              <span className="bg-gradient-to-r from-[#ffd27a] via-brand to-[#e8892a] bg-clip-text text-transparent">renda no seu bolso.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2">
              Compre cotas de usinas fotovoltaicas a partir de <b className="text-ink">{brl(minTicket, 0)}</b>, acompanhe a geração em tempo real e receba a receita da
              energia em USDT direto na sua carteira — com números abertos e auditáveis.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#vitrine" className={cx(buttonClass.primary, "px-5 py-3 text-[15px]")}>
                Ver oportunidades <ArrowRight className="size-4" />
              </Link>
              <Link href="#como-funciona" className={cx(buttonClass.secondary, "px-5 py-3 text-[15px]")}>
                Como funciona
              </Link>
            </div>
            <ul className="mt-8 grid max-w-xl gap-2 text-[14px] text-ink-2 sm:grid-cols-2">
              {["Custódia no contrato até o fim da captação", "Desistência em até 5 dias por aporte", "Relatório de auditoria verificável", "Renda pro-rata distribuída on-chain"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-good" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {featured && (
            <div className="relative mx-auto w-full max-w-[560px]">
              <div className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-brand/25 via-transparent to-[#3987e5]/20 blur-2xl" aria-hidden />
              <Link href={`/usinas/${featured.slug}`} className="group relative block overflow-hidden rounded-3xl border border-line-strong shadow-2xl">
                {featured.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- capa estática em /public
                  <img src={featured.cover} alt={`${featured.illustrative ? "Ilustração" : "Vista"} da ${featured.name}`} className="aspect-[4/3.2] w-full object-cover" />
                ) : (
                  <PlantArt slug={featured.slug} mounting={featured.mounting} title={`Ilustração da ${featured.name}`} className="aspect-[4/3.2] w-full transition duration-700 group-hover:scale-[1.03]" />
                )}
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="text-[12px] font-medium uppercase tracking-wide text-brand">Em destaque</div>
                  <div className="mt-1 text-[22px] font-semibold text-white">{featured.name}</div>
                  <div className="text-[13px] text-white/75">
                    {featured.municipio}/{featured.uf} · {num(featured.dcKWp / 1000, 2)} MWp · {featured.distribuidora}
                  </div>
                </div>
              </Link>

              {/* cartões flutuantes com números reais do modelo */}
              <div className="absolute -left-4 top-6 hidden rounded-2xl border border-line-strong bg-surface/90 px-4 py-3 shadow-xl backdrop-blur sm:block">
                <div className="text-[11px] uppercase tracking-wide text-muted">Rentabilidade alvo</div>
                <div className="text-[24px] font-semibold text-brand tnum">{pct(featured.irrNominalPct)} a.a.</div>
                <div className="text-[11px] text-muted">TIR nominal P50 · real {pct(featured.irrRealPct)}</div>
              </div>
              <div className="absolute -right-4 top-1/3 hidden rounded-2xl border border-line-strong bg-surface/90 px-4 py-3 shadow-xl backdrop-blur sm:block">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
                  <Zap className="size-3.5 text-brand" /> Geração P50
                </div>
                <div className="text-[22px] font-semibold tnum">{num(featured.p50MWh)} MWh</div>
                <div className="text-[11px] text-muted">por ano · {num(featured.specificYield)} kWh/kWp</div>
              </div>
              <div className="absolute -bottom-5 right-8 hidden rounded-2xl border border-good/30 bg-surface/90 px-4 py-3 shadow-xl backdrop-blur sm:block">
                <div className="text-[11px] uppercase tracking-wide text-muted">Renda estimada</div>
                <div className="text-[20px] font-semibold text-good tnum">≈ {brl(featured.monthlyPerCotaBRL)}</div>
                <div className="text-[11px] text-muted">por cota de {brl(featured.cotaPriceBRL, 0)} / mês</div>
              </div>
            </div>
          )}
        </Container>
      </section>

      {/* NÚMEROS */}
      <section className="border-b border-line bg-surface/50">
        <Container className="grid grid-cols-2 gap-6 py-10 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { k: "Usinas na vitrine", v: num(all.length) },
            { k: "Potência instalada", v: `${num(totalKWp / 1000, 1)} MWp` },
            { k: "Geração P50", v: `${num(totalMWh / 1000, 1)} GWh/ano` },
            { k: "Volume de captação", v: brlCompact(totalRaise) },
            { k: "CO₂ evitado", v: `${num(totalCo2)} t/ano` },
          ].map((m) => (
            <div key={m.k}>
              <div className="text-[28px] font-semibold tracking-tight tnum">{m.v}</div>
              <div className="mt-1 text-[13px] text-muted">{m.k}</div>
            </div>
          ))}
        </Container>
      </section>

      {/* VITRINE */}
      <section id="vitrine" className="scroll-mt-24 py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Vitrine de oportunidades</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">Escolha a usina. Veja os números. Invista.</h2>
              <p className="mt-3 text-[16px] text-ink-2">
                Rentabilidade alvo de {pct(irrMin)} a {pct(irrMax)} a.a. (TIR nominal P50). Cada card abre a análise completa: geração mês a mês, cenários de risco, fluxo de caixa e o
                relatório de auditoria em PDF.
              </p>
            </div>
            <Link href="/usinas" className={buttonClass.ghost}>
              Página de usinas <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-10">
            <Showcase items={all} cards={cards} />
          </div>
          <p className="mt-6 text-[12px] text-muted">
            Projeções P50 de projetos ilustrativos, antes de impostos do investidor. Rentabilidade alvo não é garantia de resultado. P10 = cenário em que 90% das simulações foram
            melhores.
          </p>
        </Container>
      </section>

      {/* COMPARAÇÃO */}
      {featuredAnalysis && bench.length > 0 && (
        <section className="border-y border-line bg-surface/40 py-20">
          <Container className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Energia × renda fixa</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">Quanto vira R$ 1.000 em {featuredAnalysis.plant.finance.horizonYears} anos?</h2>
              <p className="mt-3 text-[16px] text-ink-2">
                Simulação da {featuredAnalysis.plant.name} com a renda reinvestida no CDI, comparada às aplicações tradicionais no mesmo prazo, com as taxas atuais do Banco Central
                e IR quando aplicável.
              </p>
              <Link href={`/usinas/${featuredAnalysis.plant.slug}#economia`} className={cx(buttonClass.secondary, "mt-6")}>
                Ver a análise econômica <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="space-y-4 rounded-2xl border border-line bg-surface p-6">
              {bench
                .slice()
                .sort((a, b) => b.finalValueOf1000BRL - a.finalValueOf1000BRL)
                .map((b) => {
                  const isPlant = b.name.startsWith("UFV");
                  return (
                    <div key={b.name}>
                      <div className="flex justify-between gap-3 text-[14px]">
                        <span className={isPlant ? "font-semibold text-ink" : "text-ink-2"}>{isPlant ? `${featuredAnalysis.plant.name} (renda reinvestida)` : b.name}</span>
                        <span className={cx("tnum", isPlant ? "font-semibold text-brand" : "text-ink-2")}>{brl(b.finalValueOf1000BRL, 0)}</span>
                      </div>
                      <div className="mt-2 h-2.5 rounded-full bg-surface-3">
                        <div className={cx("h-full rounded-full", isPlant ? "bg-gradient-to-r from-[#d98e04] to-brand" : "bg-[#3987e5]")} style={{ width: `${(b.finalValueOf1000BRL / benchMax) * 100}%` }} />
                      </div>
                      <div className="mt-1 text-[12px] text-muted">{pct(b.annualPct)} a.a.</div>
                    </div>
                  );
                })}
              <p className="border-t border-line pt-3 text-[12px] text-muted">Projeção, não garantia. Valores nominais; a tributação da renda das cotas deve ser confirmada com um contador.</p>
            </div>
          </Container>
        </section>
      )}

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="scroll-mt-24 py-20">
        <Container>
          <div className="max-w-2xl">
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Como funciona</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">Do sol à sua carteira, em quatro passos</h2>
          </div>
          <ol className="relative mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-line-strong to-transparent lg:block" aria-hidden />
            {steps.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="relative z-10 flex size-12 items-center justify-center rounded-2xl border border-brand/30 bg-page text-brand shadow-[0_0_0_6px_var(--page)]">
                  <s.icon className="size-5" />
                </span>
                <div className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-muted">Passo {i + 1}</div>
                <h3 className="mt-1 text-[18px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* CONFIANÇA */}
      <section className="border-y border-line bg-surface/40 py-20">
        <Container>
          <div className="max-w-2xl">
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Confiança</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">Feito para ser verificado, não para pedir confiança cega</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {trust.map((t) => (
              <div key={t.title} className={cx("rounded-2xl border border-line bg-surface p-6 transition hover:border-line-strong", t.span)}>
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <t.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold">{t.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{t.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-2 text-[12px] text-muted">
            {["NASA POWER", "PVGIS · JRC/UE", "Open-Meteo", "IBGE", "Banco Central (SGS · Focus)", "BNB Smart Chain", "OpenZeppelin"].map((x) => (
              <span key={x} className="rounded-full border border-line px-3 py-1">
                {x}
              </span>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">Perguntas frequentes</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-[40px]">Antes de investir</h2>
            <p className="mt-3 text-[15px] text-ink-2">
              Leia também a página de{" "}
              <Link href="/seguranca" className="text-brand underline-offset-2 hover:underline">
                segurança
              </Link>{" "}
              e os riscos no relatório de cada usina.
            </p>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
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
      <section className="pb-8">
        <Container>
          <div className="relative overflow-hidden rounded-3xl border border-brand/30 bg-gradient-to-br from-[#2a1d05] via-surface to-[#0d1b2e] px-6 py-14 text-center sm:px-12">
            <div className="hero-glow absolute inset-0 opacity-80" aria-hidden />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[40px]">Comece com {brl(minTicket, 0)} e acompanhe cada kWh.</h2>
              <p className="mx-auto mt-3 max-w-xl text-[16px] text-ink-2">Conecte sua carteira, valide a identidade e reserve suas cotas em minutos.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="#vitrine" className={cx(buttonClass.primary, "px-6 py-3 text-[15px]")}>
                  Explorar usinas <ArrowRight className="size-4" />
                </Link>
                <Link href="/seguranca" className={cx(buttonClass.secondary, "px-6 py-3 text-[15px]")}>
                  Como protegemos você
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
