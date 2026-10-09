import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Eye, Leaf, Lightbulb, ShieldCheck } from "lucide-react";
import { buttonClass, Container, cx, IconBubble } from "@/components/ui";

export const metadata: Metadata = { title: "Sobre nós", description: "A Aferi Capital conecta pessoas a projetos reais de geração de energia limpa." };

const values = [
  { icon: Eye, title: "Transparência", text: "Informações claras e atualizadas: dados abertos, premissas e fontes de cada número." },
  { icon: ShieldCheck, title: "Segurança", text: "Parceiros e processos auditados; contratos testados e custódia até o fim da oferta." },
  { icon: Leaf, title: "Sustentabilidade", text: "Energia limpa para um futuro melhor, com CO₂ evitado medido por usina." },
  { icon: Lightbulb, title: "Inovação", text: "Tecnologia a favor do seu investimento: cotas digitais e relatórios verificáveis." },
];

export default function Sobre() {
  return (
    <Container className="pt-8">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-ink">Sobre a Aferi Capital</h1>
          <p className="mt-1 text-[15px] font-medium text-good">Energia solar que gera valor.</p>
          <div className="mt-5 max-w-2xl space-y-4 text-[15px] leading-relaxed text-ink-2">
            <p>
              A Aferi Capital é uma plataforma de investimentos em usinas solares, conectando pessoas a projetos reais de geração de energia limpa e
              renovável.
            </p>
            <p>
              Nosso propósito é tornar o investimento em energia solar mais acessível, transparente e seguro, com uma equipe especializada em todo o
              processo: da análise técnica da usina ao acompanhamento das distribuições.
            </p>
            <p>
              Cada número da plataforma vem de um modelo aberto, alimentado por dados públicos de satélite (NASA POWER, PVGIS), do Banco Central e do IBGE
              — e cada relatório pode ser verificado por qualquer pessoa.
            </p>
          </div>
        </div>
        <div className="rounded-2xl glass bg-[linear-gradient(135deg,rgba(61,220,132,0.10)_0%,rgba(96,165,250,0.06)_100%)] p-8 text-ink">
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-leaf">Aferi Capital</div>
          <p className="mt-3 text-[22px] font-bold leading-snug">Ativos reais de energia solar, analisados com dados abertos e acompanhados de perto.</p>
          <p className="mt-4 text-[14px] text-ink-2">Cada usina publicada passa por levantamento técnico, econômico e regulatório antes de chegar à plataforma.</p>
        </div>
      </div>

      <section className="mt-14" aria-labelledby="valores">
        <h2 id="valores" className="text-[22px] font-bold text-ink">
          Nossos valores
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <li key={v.title} className="glass rounded-2xl p-5">
              <IconBubble>
                <v.icon className="size-5" />
              </IconBubble>
              <h3 className="mt-3 text-[15px] font-semibold text-ink">{v.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(61,220,132,0.25),transparent_70%)] border border-brand/25 p-8 text-center text-ink sm:p-10">
        <h2 className="text-[22px] font-bold">Junte-se a nós na transição energética.</h2>
        <Link href="/usinas" className={cx(buttonClass.secondary, "mt-5")}>
          Explorar usinas <ArrowRight className="size-4" />
        </Link>
      </section>
    </Container>
  );
}
