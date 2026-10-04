import type { Metadata } from "next";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container, SectionTitle } from "@/components/ui";
import { PlantCard } from "@/components/plant/PlantCard";

export const metadata: Metadata = { title: "Usinas", description: "Usinas fotovoltaicas tokenizadas disponíveis na UFV Invest." };

export default async function UsinasPage() {
  const all = (await getAllAnalyses()).map(summarize);
  return (
    <Container className="py-12">
      <SectionTitle eyebrow="Usinas" title="Escolha a usina, veja os números, invista em cotas">
        Cada usina tem modelo de geração P50/P90, análise econômica completa e relatório de auditoria em PDF com os dados de origem anexados.
      </SectionTitle>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((s) => (
          <PlantCard key={s.slug} s={s} />
        ))}
      </div>
    </Container>
  );
}
