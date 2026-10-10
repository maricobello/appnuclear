import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container } from "@/components/ui";
import { PlantCard } from "@/components/aferi/PlantCard";
import { UsinasExplorer } from "@/components/aferi/UsinasExplorer";
import { WalletBanner } from "@/components/aferi/WalletBanner";
import { PageBackdrop } from "@/components/PageBackdrop";
import { getT } from "@/i18n/server";
import hero from "@/assets/lp/hero.jpg";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: d.vit.title, description: d.vit.metaDesc };
}

export default async function UsinasPage() {
  const all = (await getAllAnalyses()).map(summarize);
  const { d, t } = await getT();
  const cards = Object.fromEntries(all.map((s, i) => [s.slug, <PlantCard key={s.slug} s={s} cta="solid" priority={i < 2} />]));
  return (
    // a mesma foto da landing continua no topo da vitrine: a cena segue depois do "Invest now"
    <div className="relative isolate">
      <PageBackdrop src={hero} position="100% 12%" opacity={0.55} />
      <Container className="page-in pt-6">
        <WalletBanner />
        <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sun">{d.vit.eyebrow}</p>
            <h1 className="text-gradient mt-2 text-[44px] font-semibold leading-none tracking-[-0.03em] sm:text-[56px]">{d.vit.h1}</h1>
            <p className="mt-3 text-[16px] text-ink-2">{d.vit.sub}</p>
          </div>
          <p className="text-[13px] text-muted tnum">{t(d.vit.count, { n: all.length })}</p>
        </div>
        <div className="mt-8">
          <Suspense fallback={<div className="h-[640px]" />}>
            <UsinasExplorer items={all} cards={cards} />
          </Suspense>
        </div>
      </Container>
    </div>
  );
}
