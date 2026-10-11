import type { Metadata } from "next";
import { PtOnlyNote } from "@/components/i18n/PtOnlyNote";
import { Container, SectionTitle } from "@/components/ui";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { plants } from "@/data/plants";

export const metadata: Metadata = { title: "Administração", robots: { index: false, follow: false } };

/** Tela interna do operador (fora do menu). Tudo é feito com a carteira, direto nos contratos. */
export default function AdminPage() {
  const list = plants.map((p) => ({ slug: p.slug, name: p.name, symbol: p.token.symbol }));
  return (
    <Container className="py-10">
      <PtOnlyNote />
      <SectionTitle as="h1" eyebrow="Operação" title="Administração">
        Aceitar a administração dos contratos, aprovar KYC, encerrar ofertas e distribuir rendimentos com a sua carteira. O site não guarda chave nenhuma: cada ação é uma
        assinatura sua, e os próprios contratos conferem as permissões.
      </SectionTitle>
      <div className="mt-8 max-w-5xl">
        <AdminPanel plants={list} />
      </div>
    </Container>
  );
}
