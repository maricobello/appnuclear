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
import { getT } from "@/i18n/server";
import { OG_IMAGE } from "@/lib/og";
import { I18nProvider } from "@/i18n/client";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { d, f } = await getT();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: d.meta.default, template: "%s · Aferi Capital" },
    description: d.meta.description,
    openGraph: { title: "Aferi Capital", description: d.lp.desc, type: "website", locale: f.tag.replace("-", "_"), images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
  };
}

export const viewport: Viewport = { themeColor: "#06090e", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));
  const { locale, d } = await getT();
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale} dict={d}>
        <Providers initialState={initialState}>
          <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-ink">
            {d.common.skip}
          </a>
          <HideOnLanding>
            <Header />
          </HideOnLanding>
          <main id="conteudo" className="flex-1">
            {children}
          </main>
          <HideOnLanding>
            <Footer />
          </HideOnLanding>
        </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
