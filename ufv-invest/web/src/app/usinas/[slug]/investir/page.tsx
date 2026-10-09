import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { plants } from "@/data/plants";
import { getPlantAnalysis } from "@/lib/analysis";
import { getT } from "@/i18n/server";
import { Card, CardHeader, Container, Notice, StatusChip } from "@/components/ui";
import { InvestPanel } from "@/components/plant/InvestPanel";
import { FlowSteps } from "@/components/aferi/FlowSteps";
import { InterestButton } from "@/components/aferi/InterestDialog";

export async function generateMetadata({ params }: PageProps<"/usinas/[slug]/investir">): Promise<Metadata> {
  const { slug } = await params;
  const p = plants.find((x) => x.slug === slug);
  const { d, t } = await getT();
  return p ? { title: t(d.inv.meta, { name: p.name }) } : {};
}

export default async function InvestirPage({ params }: PageProps<"/usinas/[slug]/investir">) {
  const { slug } = await params;
  const a = await getPlantAnalysis(slug);
  if (!a) notFound();
  const { plant, finance: f, market } = a;
  const { d, t, f: fm } = await getT();
  const { brl, num, pct, date: dateBR } = fm;
  const iv = d.inv;
  return (
    <Container className="pt-5">
      <nav aria-label={d.pg.crumb} className="flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link href="/usinas" className="hover:text-ink">
          {d.nav.usinas}
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/usinas/${plant.slug}`} className="hover:text-ink">
          {plant.name}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-ink-2">{iv.crumb}</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-ink">{t(iv.h1, { name: plant.name })}</h1>
        <StatusChip status={plant.status} />
      </div>
      <p className="mt-1 text-[14px] text-muted">
        {t(iv.sub, { c: brl(plant.token.cotaPriceBRL, 0), m: brl(f.perCota.avgMonthlyIncomeBRL), r: pct(f.irrNominalPct) })}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-ink">{iv.flow}</h2>
            <div className="mt-4">
              <FlowSteps current={1} compact />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-[14px] font-semibold text-ink">{iv.before}</h2>
            <a href={`/api/usinas/${plant.slug}/relatorio`} className="mt-3 flex items-center gap-2 text-[13px] font-medium text-good hover:underline">
              <FileText className="size-4" /> {iv.reportPdf}
            </a>
            <Link href={`/usinas/${plant.slug}#riscos`} className="mt-2 flex items-center gap-2 text-[13px] font-medium text-good hover:underline">
              <FileText className="size-4" /> {iv.risks}
            </Link>
            <p className="mt-3 text-[12px] text-muted">
              {plant.token.offeringStart
                ? t(iv.period, { a: dateBR(plant.token.offeringStart), b: dateBR(plant.token.offeringEnd ?? ""), n: num(plant.token.softCapCotas) })
                : t(iv.periodTbd, { n: num(plant.token.softCapCotas) })}
            </p>
          </Card>
        </aside>
        <div className="space-y-4">
          {plant.status === "encerrada" ? (
            <Notice tone="info" title={iv.closed}>
              {iv.closedText}{" "}
              <Link href="/usinas" className="font-semibold underline">
                {iv.closedLink}
              </Link>
              .
            </Notice>
          ) : (
            <Card>
              <CardHeader title={iv.card} subtitle={t(iv.cardSub, { s: plant.token.symbol })} />
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
                <h2 className="text-[15px] font-semibold text-ink">{iv.talk}</h2>
                <p className="text-[13px] text-muted">{iv.talkSub}</p>
              </div>
              <InterestButton usina={{ slug: plant.slug, name: plant.name }} label={d.int.titleInterest} />
            </Card>
          )}
        </div>
      </div>
    </Container>
  );
}
