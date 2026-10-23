import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // highs: solver LP/MILP em WebAssembly — carregado pelo Node em runtime; o .wasm é lido via fs
  serverExternalPackages: ["firebase-admin", "highs"],
  outputFileTracingIncludes: { "/api/**": ["./node_modules/highs/build/highs.wasm"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          // plataforma fechada: nada de indexação, cache de buscador ou uso para treino de IA
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai" },
        ],
      },
    ];
  },
};

export default nextConfig;
