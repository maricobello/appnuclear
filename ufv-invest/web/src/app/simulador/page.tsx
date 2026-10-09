import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { Container } from "@/components/ui";
import { SimulatorView } from "@/components/aferi/SimulatorView";

export const metadata: Metadata = { title: "Simulador de investimento", description: "Faça uma estimativa de quanto você pode receber com base na quantidade de cotas escolhida." };

export default async function SimuladorPage() {
  const all = (await getAllAnalyses()).map(summarize);
  return (
    <Container className="pt-8">
      <h1 className="text-[26px] font-bold tracking-tight text-ink">Simulador de investimento</h1>
      <p className="mt-1 text-[14px] text-muted">Faça uma estimativa de quanto você pode receber com base na quantidade de cotas escolhida.</p>
      <div className="mt-6">
        <Suspense>
          <SimulatorView items={all} />
        </Suspense>
      </div>
    </Container>
  );
}
