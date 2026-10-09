import { describe, expect, it } from "vitest";
import { randomNonce, signToken, verifyToken } from "@/lib/auth/token";

describe("tokens assinados (sessão SIWE)", () => {
  const exp = () => Math.floor(Date.now() / 1000) + 60;

  it("verifica um token íntegro", () => {
    const t = signToken({ address: "0xabc", exp: exp() });
    expect(verifyToken<{ address: string; exp: number }>(t)?.address).toBe("0xabc");
  });

  it("rejeita payload adulterado", () => {
    const t = signToken({ address: "0xabc", exp: exp() });
    const [, mac] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ address: "0xevil", exp: exp() })).toString("base64url")}.${mac}`;
    expect(verifyToken(forged)).toBeNull();
  });

  it("rejeita assinatura truncada, token vazio e expirado", () => {
    const t = signToken({ address: "0xabc", exp: exp() });
    expect(verifyToken(t.slice(0, -3))).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken(signToken({ address: "0xabc", exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
  });

  it("gera nonces alfanuméricos únicos (EIP-4361 exige ≥ 8 caracteres)", () => {
    const a = randomNonce();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(randomNonce()).not.toBe(a);
  });
});
