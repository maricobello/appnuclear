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
    <Container className="pt-6">
      <section className="relative overflow-hidden rounded-2xl bg-navy text-white">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,#0f2a44_0%,#123a5c_65%,#0f4a46_100%)]" />
        <div className="relative px-6 py-10 sm:px-10 sm:py-14">
          <h1 className="text-[30px] font-bold tracking-tight sm:text-[36px]">Nossas usinas</h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/80">
            Explore os ativos disponíveis e encontre a oportunidade ideal para o seu perfil de investidor.
          </p>
        </div>
      </section>
      <div className="mt-6">
        <Suspense>
          <UsinasExplorer items={all} cards={cards} />
        </Suspense>
      </div>
    </Container>
  );
}
