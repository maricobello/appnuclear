import Link from "next/link";
import { Logo } from "./Logo";
import { Container } from "./ui";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface/40">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-md text-[13px] text-muted">
            Cotas digitais de usinas fotovoltaicas registradas na BNB Smart Chain, com análise técnica e econômica aberta, relatório de
            auditoria verificável on-chain e distribuição de receita direto na sua carteira.
          </p>
        </div>
        <div className="text-[14px]">
          <div className="font-semibold text-ink">Plataforma</div>
          <ul className="mt-3 space-y-2 text-ink-2">
            <li><Link href="/usinas" className="hover:text-ink">Usinas</Link></li>
            <li><Link href="/carteira" className="hover:text-ink">Minha carteira</Link></li>
            <li><Link href="/seguranca" className="hover:text-ink">Segurança e contratos</Link></li>
            <li><Link href="/verificar" className="hover:text-ink">Verificar relatório</Link></li>
          </ul>
        </div>
        <div className="text-[14px]">
          <div className="font-semibold text-ink">Dados abertos usados</div>
          <ul className="mt-3 space-y-2 text-ink-2">
            <li>NASA POWER · PVGIS (JRC/UE)</li>
            <li>Open-Meteo · IBGE</li>
            <li>Banco Central (SGS e Focus)</li>
            <li>BNB Smart Chain (BscScan)</li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-line">
        <Container className="py-6 text-[12px] leading-relaxed text-muted">
          <p>
            <b className="text-ink-2">Aviso importante.</b> Este site é uma demonstração tecnológica. As usinas exibidas são projetos ilustrativos e nada aqui
            é oferta, recomendação ou consultoria de investimento. Rentabilidades são projeções de modelos e não garantem resultados futuros. No Brasil,
            ofertas públicas de valores mobiliários (incluindo cotas tokenizadas) exigem registro ou dispensa na CVM — por exemplo, via plataforma de
            investimento participativo autorizada nos termos da Resolução CVM 88. Investimentos em ativos digitais envolvem risco de perda do capital.
          </p>
        </Container>
      </div>
    </footer>
  );
}
