import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { buttonClass, Container, cx } from "@/components/ui";
import { ContactButton } from "@/components/aferi/ContactButton";

export const metadata: Metadata = { title: "Como funciona", description: "Um processo simples, seguro e transparente para investir em usinas solares." };

const steps = [
  { title: "Explore os ativos disponíveis", text: "Conheça as usinas, indicadores e documentos de cada oferta.", href: "/usinas", cta: "Ver usinas" },
  { title: "Analise os dados", text: "Acesse dados técnicos, geração estimada com dados de satélite, riscos e o relatório de auditoria em PDF.", href: "/usinas", cta: "Ver uma usina" },
  { title: "Confira as condições", text: "Entenda prazos, custos, valor da cota, meta mínima e as regras de desistência e reembolso.", href: "/simulador", cta: "Simular" },
  { title: "Invista", text: "Entre com a sua carteira, envie seus dados (KYC) e confirme o aporte em USDT. O valor fica em custódia no contrato até o fim da oferta.", href: "/simulador", cta: "Começar" },
  { title: "Acompanhe seu investimento", text: "Receba as distribuições mensais e acompanhe cotas, extrato e documentos no seu portfólio.", href: "/portfolio", cta: "Meu portfólio" },
];

const faq = [
  ["O que eu compro ao investir?", "Cotas digitais (tokens) de uma sociedade de propósito específico (SPE) dona da usina. A receita líquida da energia é distribuída em USDT na proporção das suas cotas."],
  ["De onde vem o rendimento?", "A usina gera créditos de energia que são cedidos a assinantes com desconto na conta de luz (geração compartilhada, Lei 14.300/2022). Descontados operação, seguro, impostos e taxa de administração, o restante vai para os cotistas."],
  ["Como a rentabilidade se compara à Selic?", "Cada usina mostra a rentabilidade estimada ao lado da Selic, do CDI, do Tesouro IPCA+ e da poupança, com o mesmo horizonte. O relatório em PDF traz essa comparação."],
  ["E se a oferta não atingir a meta?", "O contrato devolve integralmente o valor de todos os investidores. Também é possível desistir até 5 dias após cada aporte."],
  ["Preciso de carteira cripto?", "Sim. O login e os aportes usam uma carteira da BNB Chain (Binance Wallet, MetaMask, Rabby ou Trust). Nunca pedimos sua frase de recuperação."],
];

export default function ComoFunciona() {
  return (
    <Container className="pt-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-navy">Como funciona</h1>
          <p className="mt-1 text-[15px] text-muted">Um processo simples, seguro e transparente.</p>
          <ol className="mt-8 space-y-0">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-5 pb-8 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[19px] top-11 h-[calc(100%-36px)] w-px bg-line-strong" aria-hidden />}
                <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf text-[16px] font-bold text-white shadow-[0_0_0_6px_var(--brand-soft)]">{i + 1}</span>
                <div className="pt-1.5">
                  <h2 className="text-[16px] font-semibold text-ink">
                    {i + 1}. {s.title}
                  </h2>
                  <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-ink-2">{s.text}</p>
                  <Link href={s.href} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline">
                    {s.cta} <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <aside className="space-y-4 lg:pt-16">
          <div className="rounded-2xl bg-brand-soft p-6">
            <h2 className="text-[17px] font-semibold text-ink">Dúvidas?</h2>
            <p className="mt-1 text-[14px] text-ink-2">Nossa equipe está pronta para te ajudar.</p>
            <ContactButton className={cx(buttonClass.outline, "mt-4")} />
          </div>
        </aside>
      </div>

      <section className="mt-16" aria-labelledby="faq">
        <h2 id="faq" className="text-[22px] font-bold text-navy">
          Perguntas frequentes
        </h2>
        <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-white">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-ink">
                {q} <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Detalhes de contratos e proteções em <Link href="/seguranca" className="font-semibold text-good hover:underline">Segurança</Link>.
        </p>
      </section>
    </Container>
  );
}
