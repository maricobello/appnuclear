import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NONCE_COOKIE, startSession } from "@/lib/auth/session";
import { verifySiwe } from "@/lib/auth/siwe";
import { verifyToken } from "@/lib/auth/token";
import { rateLimit } from "@/lib/rateLimit";

const Body = z.object({
  message: z.string().min(50).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20000),
});

const usedNonces = new Map<string, number>();

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "siwe", 20, 60_000);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "requisição inválida" }, { status: 400 });

  const nonceToken = verifyToken<{ nonce: string; exp: number }>(req.cookies.get(NONCE_COOKIE)?.value);
  if (!nonceToken) return NextResponse.json({ error: "nonce expirado — tente de novo" }, { status: 401 });
  if (usedNonces.has(nonceToken.nonce)) return NextResponse.json({ error: "nonce já utilizado" }, { status: 401 });

  // domínio esperado: o configurado (NEXT_PUBLIC_SITE_URL) ou o Host da requisição
  const host = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host : (req.headers.get("host") ?? "");
  const result = await verifySiwe({ message: parsed.data.message, signature: parsed.data.signature as `0x${string}`, nonce: nonceToken.nonce, host });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 401 });

  usedNonces.set(nonceToken.nonce, nonceToken.exp);
  for (const [n, exp] of usedNonces) if (exp * 1000 < Date.now()) usedNonces.delete(n);

  const session = await startSession(result.address, result.chainId);
  const res = NextResponse.json({ address: session.address, exp: session.exp });
  res.cookies.delete(NONCE_COOKIE);
  return res;
}
