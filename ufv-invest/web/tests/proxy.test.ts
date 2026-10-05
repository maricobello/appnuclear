import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function csp(): Record<string, string> {
  const res = proxy(new NextRequest("https://ufv.example/usinas"));
  const header = res.headers.get("Content-Security-Policy") ?? "";
  return Object.fromEntries(
    header.split(";").map((d) => {
      const [k, ...v] = d.trim().split(/\s+/);
      return [k, v.join(" ")];
    }),
  );
}

describe("CSP (proxy.ts)", () => {
  const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  afterEach(() => {
    if (wc === undefined) delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    else process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = wc;
  });

  it("sem WalletConnect: scripts e estilos só com nonce; nada de unsafe-inline em script/style", () => {
    delete process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    const p = csp();
    expect(p["script-src"]).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/);
    expect(p["style-src"]).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]+'$/);
    expect(p["frame-ancestors"]).toBe("'none'");
    expect(p["object-src"]).toBe("'none'");
    expect(p["connect-src"]).not.toContain("web3modal");
  });

  it("[auditoria] com WalletConnect: libera o que o modal do AppKit usa, sem afrouxar script-src", () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "test-project";
    const p = csp();
    // <style> injetado sem nonce pelo AppKit; um nonce na diretiva anularia o 'unsafe-inline'
    expect(p["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(p["connect-src"]).toContain("https://api.web3modal.org");
    expect(p["img-src"]).toContain("https://api.web3modal.org");
    expect(p["font-src"]).toContain("https://fonts.reown.com");
    expect(p["script-src"]).not.toContain("unsafe-inline");
    expect(p["script-src"]).toContain("'strict-dynamic'");
  });
});
