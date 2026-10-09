import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container } from "@/components/ui";
import { SimulatorView } from "@/components/aferi/SimulatorView";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: d.sim.title, description: d.sim.sub };
}

export default async function SimuladorPage() {
  const all = (await getAllAnalyses()).map(summarize);
  const { d } = await getT();
  return (
    <Container className="pt-8">
      <h1 className="text-[26px] font-bold tracking-tight text-ink">{d.sim.title}</h1>
      <p className="mt-1 text-[14px] text-muted">{d.sim.sub}</p>
      <div className="mt-6">
        <Suspense>
          <SimulatorView items={all} />
        </Suspense>
      </div>
    </Container>
  );
}
