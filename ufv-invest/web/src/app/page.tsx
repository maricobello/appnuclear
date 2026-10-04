import Link from "next/link";
import { ArrowRight, BadgeCheck, Banknote, FileCheck2, Fingerprint, LineChart, Lock, ShieldCheck, Sun, Undo2, Wallet } from "lucide-react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { brl, num, pct } from "@/lib/fmt";
import { buttonClass, Container, SectionTitle } from "@/components/ui";
import { PlantCard } from "@/components/plant/PlantCard";

const steps = [
  { icon: Wallet, title: "Conecte sua carteira", text: "Binance Wallet, MetaMask, Rabby, Trust ou WalletConnect. Você mantém a custódia — nunca pedimos sua seed." },
  { icon: Fingerprint, title: "Verifique sua identidade", text: "KYC uma única vez. Sua carteira entra na lista de investidores habilitados do contrato." },
  { icon: Banknote, title: "Compre cotas em USDT", text: "O valor fica em custódia no contrato da oferta. Você tem 5 dias para desistir; se a meta mínima não for atingida, o dinheiro volta." },
  { icon: Sun, title: "Receba a energia em renda", text: "A receita líquida da usina é distribuída em USDT, pro-rata, direto no contrato. Você resgata quando quiser." },
];

const trust = [
  { icon: LineChart, title: "Números auditáveis", text: "Modelo horário de geração (P50/P90) com dados de satélite da NASA, validação cruzada com o PVGIS da Comissão Europeia e análise econômica com Monte Carlo." },
  { icon: FileCheck2, title: "Relatório verificável", text: "Cada usina tem um relatório de auditoria em PDF com os dados de origem anexados. O hash SHA-256 pode ser registrado no contrato e conferido por qualquer pessoa." },
  { icon: Undo2, title: "Custódia com devolução", text: "Na captação o dinheiro fica no contrato, não com a empresa: meta mínima não atingida = reembolso automático para cada investidor." },
  { icon: ShieldCheck, title: "Contratos imutáveis", text: "OpenZeppelin v5, sem proxy de atualização, papéis administrativos separados e transferências só entre carteiras verificadas." },
  { icon: Lock, title: "Conexão segura", text: "Descoberta de carteiras EIP-6963, login por assinatura (SIWE), aprovações no valor exato e simulação de cada transação antes de assinar." },
  { icon: BadgeCheck, title: "Transparência total", text: "Toda compra, distribuição e resgate é pública no BscScan. Os dados da análise ficam abertos em JSON." },
];

const faq = [
  {
    q: "O que exatamente eu compro?",
    a: "Uma cota digital (token BEP-20 com 0 casas decimais) que representa participação econômica na SPE dona da usina. O token só circula entre carteiras com KYC aprovado, como exige um valor mobiliário.",
  },
  {
    q: "De onde vem o rendimento?",
    a: "A usina gera créditos de energia na distribuidora (geração compartilhada, Lei 14.300/2022) cedidos a assinantes com desconto na conta de luz. A receita, menos O&M, seguro, arrendamento, gestão e impostos, é distribuída aos cotistas.",
  },
  {
    q: "Os números são reais?",
    a: "O recurso solar, o clima, os dados do município e as taxas (Selic, CDI, IPCA) vêm de APIs públicas em tempo real, com a fonte de cada valor indicada. As usinas desta demonstração são projetos ilustrativos: os dados de engenharia e CAPEX são hipóteses de mercado.",
  },
  {
    q: "Qual carteira é a mais segura?",
    a: "Uma carteira de hardware (Ledger ou Trezor) conectada pela Rabby — que simula cada transação antes de assinar — ou pela MetaMask. A Binance Wallet também é nativa da BNB Chain. A Phantom é focada em Solana; para a BNB Chain prefira as anteriores.",
  },
  {
    q: "Isso é regulado?",
    a: "No Brasil, ofertas públicas de valores mobiliários exigem registro ou dispensa na CVM. Para operar com investidores reais, a oferta deve passar por uma plataforma de investimento participativo autorizada (Resolução CVM 88) ou outro rito aplicável. Esta versão roda na testnet para demonstração.",
  },
];

export default async function Home() {
  const all = (await getAllAnalyses()).map(summarize);
  const totalKWp = all.reduce((s, x) => s + x.dcKWp, 0);
  const totalMWh = all.reduce((s, x) => s + x.p50MWh, 0);
  const totalCo2 = all.reduce((s, x) => s + x.co2, 0);
  const avgIrr = all.reduce((s, x) => s + x.irrNominalPct * x.investmentBRL, 0) / Math.max(1, all.reduce((s, x) => s + x.investmentBRL, 0));
  const minCota = Math.min(...all.map((x) => x.cotaPriceBRL));

  return (
    <>
      <section className="hero-glow relative overflow-hidden border-b border-line">
        <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />
        <Container className="relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[13px] text-brand">
              <Sun className="size-4" /> Energia solar tokenizada na BNB Chain
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Seja dono de um pedaço de uma <span className="text-brand">usina solar</span>.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] text-ink-2">
              Cotas a partir de {brl(minCota, 0)} em usinas fotovoltaicas reais do Brasil, com geração e rentabilidade calculadas por modelos abertos, relatório de
              auditoria verificável e renda em USDT direto na sua carteira.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/usinas" className={buttonClass.primary}>
                Ver usinas <ArrowRight className="size-4" />
              </Link>
              <Link href="/seguranca" className={buttonClass.secondary}>
                Como protegemos você
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-line-strong bg-surface/80 p-6 shadow-2xl backdrop-blur">
            <div className="text-[13px] font-medium text-muted">Portfólio da plataforma</div>
            <dl className="mt-4 grid grid-cols-2 gap-5">
              <div>
                <dt className="text-[12px] text-muted">Potência instalada</dt>
                <dd className="mt-1 text-3xl font-semibold tnum">{num(totalKWp / 1000, 1)} MWp</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Geração P50</dt>
                <dd className="mt-1 text-3xl font-semibold tnum">{num(totalMWh / 1000, 1)} GWh/ano</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">TIR média ponderada</dt>
                <dd className="mt-1 text-3xl font-semibold text-brand tnum">{pct(avgIrr)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">CO₂ evitado</dt>
                <dd className="mt-1 text-3xl font-semibold text-good tnum">{num(totalCo2)} t/ano</dd>
              </div>
            </dl>
            <div className="mt-6 space-y-2 border-t border-line pt-4">
              {all.map((s) => (
                <Link key={s.slug} href={`/usinas/${s.slug}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[14px] hover:bg-surface-2">
                  <span className="text-ink-2">{s.name}</span>
                  <span className="tnum text-muted">
                    {num(s.dcKWp)} kWp · <span className="text-brand">{pct(s.irrNominalPct)}</span>
                  </span>
                </Link>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">Projeções P50 de projetos ilustrativos. Rentabilidade não garantida.</p>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <SectionTitle eyebrow="Como funciona" title="Do sol à sua carteira, em quatro passos" />
          <ol className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-[13px] font-semibold text-muted">Passo {i + 1}</span>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-[14px] text-ink-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-y border-line bg-surface/40 py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionTitle eyebrow="Usinas" title="Oportunidades abertas">
              Cada card mostra a projeção P50. Abra a usina para ver geração mês a mês, cenários de risco e o relatório de auditoria.
            </SectionTitle>
            <Link href="/usinas" className={buttonClass.ghost}>
              Todas as usinas <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((s) => (
              <PlantCard key={s.slug} s={s} />
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <SectionTitle eyebrow="Confiança" title="Feito para ser verificado, não para pedir confiança cega" />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {trust.map((t) => (
              <div key={t.title} className="rounded-2xl border border-line bg-surface p-5">
                <t.icon className="size-6 text-brand" />
                <h3 className="mt-3 text-[17px] font-semibold">{t.title}</h3>
                <p className="mt-2 text-[14px] text-ink-2">{t.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-surface/40 py-20">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <SectionTitle eyebrow="Perguntas frequentes" title="O que você precisa saber antes de investir" />
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {faq.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {f.q}
                  <span className="text-muted transition group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[14px] text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
