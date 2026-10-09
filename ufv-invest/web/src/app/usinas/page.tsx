import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container } from "@/components/ui";
import { PlantCard } from "@/components/aferi/PlantCard";
import { UsinasExplorer } from "@/components/aferi/UsinasExplorer";

export const metadata: Metadata = { title: "Nossas usinas", description: "Explore as usinas solares disponíveis e encontre a oportunidade ideal para o seu perfil de investidor." };

export default async function UsinasPage() {
  const all = (await getAllAnalyses()).map(summarize);
  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <PlantCard key={s.slug} s={s} cta="solid" priority={i < 2} />]));
  return (
    <Container className="pt-10">
      <h1 className="text-[32px] font-bold tracking-tight text-navy">Usinas</h1>
      <p className="mt-1 text-[15px] text-ink-2">Escolha onde investir.</p>
      <div className="mt-6">
        <Suspense fallback={<div className="h-[640px]" />}>
          <UsinasExplorer items={all} cards={cards} />
        </Suspense>
      </div>
    </Container>
  );
}
