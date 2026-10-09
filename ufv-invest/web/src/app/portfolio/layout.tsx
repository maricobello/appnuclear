import type { Metadata } from "next";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { PortfolioProvider } from "@/components/portfolio/data";
import { PortfolioShell } from "@/components/portfolio/Shell";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: d.pf.meta, robots: { index: false } };
}

export default async function PortfolioLayout({ children }: { children: React.ReactNode }) {
  const items = (await getAllAnalyses()).map(summarize);
  return (
    <PortfolioProvider items={items}>
      <PortfolioShell>{children}</PortfolioShell>
    </PortfolioProvider>
  );
}
