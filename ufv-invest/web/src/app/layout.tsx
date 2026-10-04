import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookieToInitialState } from "wagmi";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { wagmiConfig } from "@/lib/web3/config";
import { siteUrl } from "@/lib/web3/chains";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "UFV Invest — cotas tokenizadas de usinas solares", template: "%s · UFV Invest" },
  description:
    "Invista em usinas fotovoltaicas com cotas digitais na BNB Chain: análise P50/P90 com dados abertos (NASA POWER, PVGIS), TIR, VPL e Monte Carlo, relatório de auditoria em PDF verificável on-chain e receita distribuída em USDT.",
  openGraph: { title: "UFV Invest", description: "Cotas tokenizadas de usinas solares na BNB Chain", type: "website", locale: "pt_BR" },
};

export const viewport: Viewport = { themeColor: "#070b10", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers initialState={initialState}>
          <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-ink">
            Pular para o conteúdo
          </a>
          <Header />
          <main id="conteudo" className="flex-1">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
