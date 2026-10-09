import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "./ui";

const cols = [
  {
    title: "Plataforma",
    links: [
      ["/usinas", "Usinas"],
      ["/simulador", "Simulador"],
      ["/como-funciona", "Como funciona"],
      ["/portfolio", "Meu portfólio"],
    ],
  },
  {
    title: "Institucional",
    links: [
      ["/sobre", "Sobre nós"],
      ["/seguranca", "Segurança e contratos"],
      ["/verificar", "Verificar relatório"],
      ["/portfolio/suporte", "Suporte"],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-24 bg-navy text-white/80">
      <Container className="grid gap-10 py-12 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo inverted />
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-white/70">
            Renda mensal com usinas solares.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="text-[14px]">
            <div className="font-semibold text-white">{c.title}</div>
            <ul className="mt-3 space-y-2">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Container>
      <div className="border-t border-white/10">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-5 text-[12px] text-white/70">
          <p>
            Demonstração. Rentabilidade é projeção, não garantia; há risco de perda.{" "}
            <Link href="/seguranca" className="underline underline-offset-2 hover:text-white">
              Avisos e riscos
            </Link>
          </p>
          <p>© {new Date().getFullYear()} Aferi Capital</p>
        </Container>
      </div>
    </footer>
  );
}
