import type { Metadata } from "next";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container, SectionTitle } from "@/components/ui";
import { Showcase } from "@/components/showcase/Showcase";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";

export const metadata: Metadata = { title: "Usinas", description: "Vitrine de usinas fotovoltaicas tokenizadas na UFV Invest." };

export default async function UsinasPage() {
  const all = (await getAllAnalyses()).map(summarize);
  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <ShowcaseCard key={s.slug} s={s} priority={i === 0} />]));
  return (
    <Container className="py-12">
      <SectionTitle eyebrow="Vitrine" title="Usinas disponíveis">
        Cada usina tem modelo de geração P50/P90, análise econômica completa e relatório de auditoria em PDF com os dados de origem anexados.
      </SectionTitle>
      <div className="mt-10">
        <Showcase items={all} cards={cards} />
      </div>
    </Container>
  );
}
