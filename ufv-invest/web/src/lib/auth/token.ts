import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokens assinados (HMAC-SHA256) para nonce e sessão SIWE — sem banco de dados.
 * Formato: base64url(payload JSON) + "." + base64url(hmac). Comparação em tempo constante.
 */

let devSecret: string | undefined;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres) em produção");
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(payload: Record<string, unknown>): string {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T extends { exp: number }>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomNonce(): string {
  // EIP-4361: nonce alfanumérico com pelo menos 8 caracteres
  return randomBytes(16).toString("hex");
}
