import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { plants } from "@/data/plants";
import { getPlantAnalysis } from "@/lib/analysis";
import { brl, dateBR, num, pct } from "@/lib/fmt";
import { Card, CardHeader, Container, Notice, StatusChip } from "@/components/ui";
import { InvestPanel } from "@/components/plant/InvestPanel";
import { FlowSteps } from "@/components/aferi/FlowSteps";
import { InterestButton } from "@/components/aferi/InterestDialog";

export async function generateMetadata({ params }: PageProps<"/usinas/[slug]/investir">): Promise<Metadata> {
  const { slug } = await params;
  const p = plants.find((x) => x.slug === slug);
  return p ? { title: `Investir — ${p.name}` } : {};
}

export default async function InvestirPage({ params }: PageProps<"/usinas/[slug]/investir">) {
  const { slug } = await params;
  const a = await getPlantAnalysis(slug);
  if (!a) notFound();
  const { plant, finance: f, market } = a;
  return (
    <Container className="pt-5">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link href="/usinas" className="hover:text-ink">
          Usinas
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/usinas/${plant.slug}`} className="hover:text-ink">
          {plant.name}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-ink-2">Investir</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-navy">Investir na {plant.name}</h1>
        <StatusChip status={plant.status} />
      </div>
      <p className="mt-1 text-[14px] text-muted">
        Cota de {brl(plant.token.cotaPriceBRL, 0)} · distribuição média de {brl(f.perCota.avgMonthlyIncomeBRL)}/cota/mês · rentabilidade estimada {pct(f.irrNominalPct)} a.a.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-ink">Fluxo de aquisição</h2>
            <div className="mt-4">
              <FlowSteps current={1} compact />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-[14px] font-semibold text-ink">Antes de investir</h2>
            <a href={`/api/usinas/${plant.slug}/relatorio`} className="mt-3 flex items-center gap-2 text-[13px] font-medium text-good hover:underline">
              <FileText className="size-4" /> Relatório para o investidor (PDF)
            </a>
            <Link href={`/usinas/${plant.slug}#riscos`} className="mt-2 flex items-center gap-2 text-[13px] font-medium text-good hover:underline">
              <FileText className="size-4" /> Riscos e condições da oferta
            </Link>
            <p className="mt-3 text-[12px] text-muted">
              Oferta de {plant.token.offeringStart ? `${dateBR(plant.token.offeringStart)} a ${dateBR(plant.token.offeringEnd ?? "")}` : "período a definir"} · meta mínima de {num(plant.token.softCapCotas)} cotas.
            </p>
          </Card>
        </aside>
        <div className="space-y-4">
          {plant.status === "encerrada" ? (
            <Notice tone="info" title="Oferta encerrada">
              Todas as cotas desta usina foram vendidas. Veja as outras <Link href="/usinas" className="font-semibold underline">usinas disponíveis</Link>.
            </Notice>
          ) : (
            <Card>
              <CardHeader title="Aporte com a sua carteira" subtitle={`${plant.token.symbol} · BNB Smart Chain · pagamento em USDT`} />
              <div className="p-5">
                <InvestPanel
                  slug={plant.slug}
                  symbol={plant.token.symbol}
                  cotaPriceBRL={plant.token.cotaPriceBRL}
                  cotaPriceUSDT={plant.token.cotaPriceUSDT}
                  minCotas={plant.token.minCotas}
                  monthlyPerCotaBRL={f.perCota.avgMonthlyIncomeBRL}
                  usdtBrl={market.usdtBrl}
                />
              </div>
            </Card>
          )}
          {plant.status !== "encerrada" && (
            <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">Prefere falar com a equipe antes?</h2>
                <p className="text-[13px] text-muted">Registre seu interesse e tire dúvidas sem compromisso.</p>
              </div>
              <InterestButton usina={{ slug: plant.slug, name: plant.name }} label="Demonstrar interesse" />
            </Card>
          )}
        </div>
      </div>
    </Container>
  );
}
