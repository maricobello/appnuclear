import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIN OS — Terminal de Arbitragem de Energia",
  description:
    "PLD em tempo real, previsão probabilística (LEAR, conformal, QRA, MRJD, HMM, GARCH), arbitragem com armazenamento (DP/LSMC), spreads entre submercados e mercados globais, com agente IA auditando as APIs públicas.",
};

export const viewport: Viewport = { themeColor: "#0a0d12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
