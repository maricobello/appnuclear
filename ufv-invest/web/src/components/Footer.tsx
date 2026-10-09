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
    <footer className="mt-20 bg-navy text-white/80">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr_1.2fr]">
        <div>
          <Logo inverted />
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-white/70">
            Energia solar que gera valor. Cotas digitais de usinas fotovoltaicas com dados abertos, relatório de auditoria verificável e
            distribuição mensal da receita.
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
        <div className="text-[14px]">
          <div className="font-semibold text-white">Dados abertos usados</div>
          <ul className="mt-3 space-y-2 text-white/70">
            <li>NASA POWER · PVGIS (JRC/UE)</li>
            <li>Open-Meteo · IBGE</li>
            <li>Banco Central (SGS e Focus)</li>
            <li>BNB Smart Chain (BscScan)</li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-white/10">
        <Container className="py-6 text-[12px] leading-relaxed text-white/60">
          <p>
            <b className="text-white/80">Aviso importante.</b> Este site é uma demonstração tecnológica. As usinas exibidas são projetos ilustrativos
            e nada aqui é oferta, recomendação ou consultoria de investimento. Rentabilidades são projeções de modelos e
            não garantem resultados futuros. No Brasil, ofertas públicas de valores mobiliários (incluindo cotas tokenizadas) exigem registro ou dispensa
            na CVM — por exemplo, via plataforma de investimento participativo autorizada nos termos da Resolução CVM 88. Há risco de perda do capital.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} Aferi Capital</p>
        </Container>
      </div>
    </footer>
  );
}
