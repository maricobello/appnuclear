import type { Metadata } from "next";
import { Container, SectionTitle } from "@/components/ui";
import { VerifyReport } from "@/components/VerifyReport";

export const metadata: Metadata = { title: "Verificar relatório", description: "Confira a autenticidade de um relatório de auditoria da UFV Invest." };

export default function VerificarPage() {
  return (
    <Container className="py-12">
      <SectionTitle eyebrow="Verificação" title="Este relatório é autêntico?">
        Solte o PDF aqui. Tudo acontece no seu navegador: calculamos o SHA-256 do arquivo e comparamos com os documentos registrados nos contratos, e recalculamos a impressão
        digital dos dados a partir do JSON anexado ao PDF.
      </SectionTitle>
      <div className="mt-10 max-w-3xl">
        <VerifyReport />
      </div>
    </Container>
  );
}
