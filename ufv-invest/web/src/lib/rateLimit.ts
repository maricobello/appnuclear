import { NextResponse, type NextRequest } from "next/server";

/**
 * Limite de taxa simples em memória (por instância), por IP e chave de rota.
 * Em produção com muitas instâncias, troque por um store compartilhado (ex.: Upstash/Vercel KV)
 * ou pelas regras de rate limit do Vercel Firewall.
 */
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}

export function rateLimit(req: NextRequest, key: string, limit: number, windowMs: number): NextResponse | null {
  const id = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || b.reset < now) {
    buckets.set(id, { count: 1, reset: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return null;
  }
  b.count++;
  if (b.count > limit) {
    return NextResponse.json({ error: "muitas requisições — aguarde um pouco" }, { status: 429, headers: { "Retry-After": String(Math.ceil((b.reset - now) / 1000)) } });
  }
  return null;
}
