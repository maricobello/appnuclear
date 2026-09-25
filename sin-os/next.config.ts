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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
