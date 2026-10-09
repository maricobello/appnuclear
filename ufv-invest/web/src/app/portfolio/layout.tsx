import type { Metadata } from "next";
import { getAllAnalyses, summarize } from "@/lib/analysis";
import { PortfolioProvider } from "@/components/portfolio/data";
import { PortfolioShell } from "@/components/portfolio/Shell";

export const metadata: Metadata = { title: "Meu portfólio", robots: { index: false } };

export default async function PortfolioLayout({ children }: { children: React.ReactNode }) {
  const items = (await getAllAnalyses()).map(summarize);
  return (
    <PortfolioProvider items={items}>
      <PortfolioShell>{children}</PortfolioShell>
    </PortfolioProvider>
  );
}
