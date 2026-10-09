import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookieToInitialState } from "wagmi";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { HideOnLanding } from "@/components/HideOnLanding";
import { wagmiConfig } from "@/lib/web3/config";
import { siteUrl } from "@/lib/web3/chains";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Aferi Capital — invista em usinas solares", template: "%s · Aferi Capital" },
  description:
    "Invista em usinas solares de forma simples, segura e transparente: cotas digitais na BNB Chain, análise P50/P90 com dados abertos (NASA POWER, PVGIS), TIR e Monte Carlo, relatório de auditoria verificável e distribuição mensal da receita.",
  openGraph: { title: "Aferi Capital", description: "Invista no sol. Cotas de usinas solares com renda mensal.", type: "website", locale: "pt_BR", images: ["/images/lp/usina.jpg"] },
};

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers initialState={initialState}>
          <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-ink">
            Pular para o conteúdo
          </a>
          <HideOnLanding>
            <Header />
          </HideOnLanding>
          <main id="conteudo" className="flex-1 bg-white">
            {children}
          </main>
          <HideOnLanding>
            <Footer />
          </HideOnLanding>
        </Providers>
      </body>
    </html>
  );
}
