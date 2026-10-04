import type { Metadata } from "next";
import { Container, SectionTitle } from "@/components/ui";
import { Portfolio } from "@/components/wallet/Portfolio";

export const metadata: Metadata = { title: "Minha carteira" };

export default function CarteiraPage() {
  return (
    <Container className="py-12">
      <SectionTitle eyebrow="Minha carteira" title="Suas cotas e rendimentos">
        Tudo lido direto dos contratos na BNB Chain. O rendimento distribuído fica disponível no contrato até você resgatar.
      </SectionTitle>
      <div className="mt-10">
        <Portfolio />
      </div>
    </Container>
  );
}
