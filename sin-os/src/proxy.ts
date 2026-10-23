import { NextResponse, type NextRequest } from "next/server";
import { accessConfigured, failClosed, machineAuth, RateLimiter, SESSION_COOKIE, verifySession } from "@/lib/access";

/** Tudo exige login, menos a tela de entrada e a rota que a atende. */
const OPEN = new Set(["/entrar", "/api/acesso"]);
/** Uso normal fica muito abaixo disso; varrer as APIs para copiar os dados, não. */
const apiLimit = new RateLimiter(400, 10 * 60_000);

const deny = (req: NextRequest, status: number, erro: string) => {
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ erro }, { status, headers: { "cache-control": "no-store" } });
  const url = new URL("/entrar", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
};

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (OPEN.has(path)) return NextResponse.next();
  if (!accessConfigured()) return failClosed() ? deny(req, 503, "acesso não configurado: cadastre ADMIN_KEY na Vercel") : NextResponse.next();
  if (machineAuth(req.headers)) return NextResponse.next();
  const user = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return deny(req, 401, "login necessário");
  if (path.startsWith("/api/") && !apiLimit.hit(user)) {
    console.warn(`[acesso] limite de requisições: ${user}`);
    return NextResponse.json({ erro: "muitas requisições; tente de novo em alguns minutos" }, { status: 429, headers: { "retry-after": "600" } });
  }
  const res = NextResponse.next();
  res.headers.set("cache-control", path.startsWith("/api/") ? "private, no-store" : "private, no-cache");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
