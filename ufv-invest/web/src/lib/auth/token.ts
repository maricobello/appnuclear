import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokens assinados (HMAC-SHA256) para nonce e sessão SIWE — sem banco de dados.
 * Formato: base64url(payload JSON) + "." + base64url(hmac). Comparação em tempo constante.
 *
 * Separação de domínio: o HMAC cobre `purpose` + payload, então um token emitido para um
 * propósito (ex.: a sessão) nunca é aceito como outro (ex.: o nonce do SIWE) — os dois usam a
 * mesma chave e o mesmo formato.
 */
export type TokenPurpose = "session" | "siwe-nonce";

let devSecret: string | undefined;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  // fail-closed em produção (Vercel ou `next start` próprio); o build não chama esta função
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres) em produção");
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (purpose: TokenPurpose, body: string) => createHmac("sha256", secret()).update(`${purpose}.${body}`);

export function signToken(payload: Record<string, unknown>, purpose: TokenPurpose = "session"): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(purpose, body).digest("base64url")}`;
}

export function verifyToken<T extends { exp: number }>(token: string | undefined | null, purpose: TokenPurpose = "session"): T | null {
  if (!token) return null;
  const [body, given64] = token.split(".");
  if (!body || !given64) return null;
  const expected = mac(purpose, body).digest();
  const given = Buffer.from(given64, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Hash com chave (HMAC-SHA256, hex) para pseudonimizar dados pessoais (ex.: CPF) — LGPD. */
export function keyedHash(label: string, data: string): string {
  return createHmac("sha256", secret()).update(`${label}:${data}`).digest("hex");
}

/** Formato dos nonces emitidos por `randomNonce` (o verify recusa qualquer outro). */
export const NONCE_PATTERN = /^[a-f0-9]{32}$/;

export function randomNonce(): string {
  // EIP-4361: nonce alfanumérico com pelo menos 8 caracteres
  return randomBytes(16).toString("hex");
}
