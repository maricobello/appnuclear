import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy com nonce por requisição (proteção contra XSS — num dApp, um script
 * injetado poderia trocar o endereço do contrato antes da assinatura) e frame-ancestors 'none'
 * (anti-clickjacking: o site não pode ser embutido em iframe para enganar cliques de assinatura).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const rpc = [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-rpc.publicnode.com",
    "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    "https://bsc-testnet-rpc.publicnode.com",
    process.env.NEXT_PUBLIC_BSC_RPC_URL,
    process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL,
  ]
    .filter(Boolean)
    .map((u) => new URL(u as string).origin);
  const walletConnect = ["https://*.walletconnect.com", "https://*.walletconnect.org", "wss://*.walletconnect.com", "wss://*.walletconnect.org", "https://*.reown.com", "wss://*.reown.com"];
  // O modal QR do WalletConnect (Reown AppKit) injeta <style> SEM nonce no <head> (variáveis de
  // tema), busca config/ícones em api.web3modal.org e fontes em fonts.reown.com. Com um nonce na
  // diretiva, 'unsafe-inline' é ignorado (CSP2+), então, só quando o WalletConnect está ativo,
  // style-src fica 'self' 'unsafe-inline' (CSS não executa código; script-src segue estrito).
  const wcEnabled = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
  const appKit = wcEnabled ? " https://api.web3modal.org" : "";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    wcEnabled || isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // atributos style="" gerados pelo React/ECharts (sem execução de código)
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: https://*.walletconnect.com https://*.reown.com${appKit}`,
    `font-src 'self' data:${wcEnabled ? " https://fonts.reown.com" : ""}`,
    `connect-src 'self' ${[...new Set(rpc)].join(" ")} ${walletConnect.join(" ")}${appKit}`,
    "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.org",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
