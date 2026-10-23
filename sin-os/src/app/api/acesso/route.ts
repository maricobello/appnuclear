import { NextResponse } from "next/server";
import { checkCode, clientIp, RateLimiter, SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/access";

/** 5 tentativas erradas por IP a cada 15 min; depois, 429 até a janela passar. */
const attempts = new RateLimiter(5, 15 * 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (attempts.count(ip) >= attempts.max) {
    console.warn(`[acesso] bloqueado por tentativas: ${ip}`);
    return NextResponse.json({ erro: "muitas tentativas; espere 15 minutos" }, { status: 429, headers: { "retry-after": "900" } });
  }
  let code = "";
  try {
    const body = (await req.json()) as { codigo?: unknown };
    code = typeof body.codigo === "string" ? body.codigo : "";
  } catch {
    // corpo inválido conta como tentativa errada
  }
  const user = checkCode(code);
  const token = user ? signSession(user) : null;
  if (!user || !token) {
    attempts.hit(ip);
    await sleep(600);
    console.warn(`[acesso] código recusado: ${ip}`);
    return NextResponse.json({ erro: "código inválido" }, { status: 401 });
  }
  attempts.reset(ip);
  console.info(`[acesso] entrada: ${user} (${ip})`);
  const res = NextResponse.json({ ok: true, usuario: user });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(req.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
