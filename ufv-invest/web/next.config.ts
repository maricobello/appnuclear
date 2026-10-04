import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // fontes TTF lidas via fs pelo gerador de PDF (rotas de relatório)
  outputFileTracingIncludes: { "/api/usinas/**": ["./src/lib/report/fonts/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
