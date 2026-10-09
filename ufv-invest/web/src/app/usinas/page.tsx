import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container } from "@/components/ui";
import { PlantCard } from "@/components/aferi/PlantCard";
import { UsinasExplorer } from "@/components/aferi/UsinasExplorer";
import { WalletBanner } from "@/components/aferi/WalletBanner";

export const metadata: Metadata = { title: "Nossas usinas", description: "Explore as usinas solares disponíveis e encontre a oportunidade ideal para o seu perfil de investidor." };

export default async function UsinasPage() {
  const all = (await getAllAnalyses()).map(summarize);
  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <PlantCard key={s.slug} s={s} cta="solid" priority={i < 2} />]));
  return (
    <Container className="page-in pt-6">
      <WalletBanner />
      <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sun">Ofertas abertas</p>
          <h1 className="text-gradient mt-2 text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[56px]">Usinas</h1>
          <p className="mt-3 text-[16px] text-ink-2">Escolha onde investir. Renda todo mês.</p>
        </div>
        <p className="text-[13px] text-muted tnum">{all.length} usinas · cotas a partir de R$ 1.000</p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<div className="h-[640px]" />}>
          <UsinasExplorer items={all} cards={cards} />
        </Suspense>
      </div>
    </Container>
  );
}
