import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Acesso à plataforma: só quem tem um código de acesso entra.
 *
 *  - ADMIN_KEY (já cadastrada na Vercel) é o código do dono: usuário "admin".
 *  - ACCESS_CODES = "nome:sha256,nome2:sha256" — um código por pessoa, guardado só como hash
 *    (gere com `node scripts/novo-acesso.mjs nome`). Tirar a pessoa da lista derruba a sessão dela.
 *  - SESSION_SECRET (opcional) assina as sessões; sem ele, a chave deriva da ADMIN_KEY.
 *    Trocar o SESSION_SECRET derruba todas as sessões.
 *
 * Os robôs (GitHub Actions, coletor da CCEE, cron da Vercel) seguem entrando pelos próprios
 * segredos (Bearer ADMIN_KEY/CRON_SECRET, x-admin-key, x-coletor-key).
 */

export const SESSION_COOKIE = "sinos_sessao";
export const SESSION_DAYS = 7;
const NAME_RE = /^[a-z0-9._-]{1,40}$/;

type Env = Record<string, string | undefined>;

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
export const hashCode = (code: string) => createHash("sha256").update(code.trim()).digest("hex");

/** Usuários com código (nome → hash do código). */
export function accessUsers(env: Env = process.env): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of (env.ACCESS_CODES ?? "").split(/[,;\s]+/)) {
    const [name, hash] = item.split(":");
    if (name && hash && NAME_RE.test(name) && /^[0-9a-f]{64}$/.test(hash) && name !== "admin") out.set(name, hash);
  }
  return out;
}

function sessionKey(env: Env): Buffer | null {
  if (env.SESSION_SECRET) return createHmac("sha256", "sin-os-session-v1").update(env.SESSION_SECRET).digest();
  if (env.ADMIN_KEY) return createHmac("sha256", "sin-os-session-v1:admin").update(env.ADMIN_KEY).digest();
  return null;
}

/** O controle de acesso só funciona com uma chave de sessão e ao menos um código. */
export const accessConfigured = (env: Env = process.env) => !!sessionKey(env) && (!!env.ADMIN_KEY || accessUsers(env).size > 0);

/** Em produção, sem configuração, fecha tudo; em desenvolvimento e testes, fica aberto. */
export const failClosed = (env: Env = process.env) => env.VERCEL_ENV === "production" || env.NODE_ENV === "production";

/** Nome do usuário dono do código, ou null. */
export function checkCode(code: string, env: Env = process.env): string | null {
  const c = code.trim();
  if (!c || c.length > 200) return null;
  if (env.ADMIN_KEY && eq(c, env.ADMIN_KEY.trim())) return "admin";
  if (c.length < 16) return null; // os códigos gerados têm 47 caracteres
  const h = hashCode(c);
  let found: string | null = null;
  for (const [name, hash] of accessUsers(env)) if (eq(h, hash)) found = name; // sem sair cedo: tempo constante
  return found;
}

export function signSession(user: string, now = Date.now(), env: Env = process.env): string | null {
  const key = sessionKey(env);
  if (!key) return null;
  const body = b64(JSON.stringify({ v: 1, u: user, iat: now, exp: now + SESSION_DAYS * 86400_000 }));
  return `${body}.${b64(createHmac("sha256", key).update(body).digest())}`;
}

/** Usuário da sessão, se a assinatura confere, não expirou e o usuário ainda tem acesso. */
export function verifySession(token: string | undefined, now = Date.now(), env: Env = process.env): string | null {
  const key = sessionKey(env);
  if (!key || !token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !eq(sig, b64(createHmac("sha256", key).update(body).digest()))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { v?: number; u?: string; exp?: number };
    if (p.v !== 1 || typeof p.u !== "string" || typeof p.exp !== "number" || p.exp <= now) return null;
    if (p.u === "admin") return env.ADMIN_KEY ? "admin" : null;
    return accessUsers(env).has(p.u) ? p.u : null;
  } catch {
    return null;
  }
}

/** Robôs com segredo próprio (as rotas também conferem). */
export function machineAuth(headers: Headers, env: Env = process.env): boolean {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const admin = headers.get("x-admin-key") ?? "";
  const coletor = headers.get("x-coletor-key") ?? "";
  const ok = (v: string, s?: string) => !!s && !!v && eq(v, s);
  return ok(bearer, env.ADMIN_KEY) || ok(bearer, env.CRON_SECRET) || ok(admin, env.ADMIN_KEY) || ok(coletor, env.PLD_INGEST_KEY);
}

/** Janela deslizante simples em memória (por instância): limita tentativas de login e raspagem. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}
  hit(key: string, now = Date.now()): boolean {
    const xs = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    xs.push(now);
    this.hits.set(key, xs);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => t > now - this.windowMs)) this.hits.delete(k);
    return xs.length <= this.max;
  }
  count(key: string, now = Date.now()) {
    return (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs).length;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}

/** Só caminhos internos: nada de //host ou esquema (evita redirecionar para fora). */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])[^\s]*$/.test(next) && !next.startsWith("/entrar") ? next : "/";
}

export const clientIp = (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "?";
