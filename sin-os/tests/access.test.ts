import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { accessConfigured, accessUsers, checkCode, hashCode, machineAuth, RateLimiter, safeNext, SESSION_COOKIE, signSession, verifySession } from "@/lib/access";

const ADMIN = "chave-admin-de-teste-123456";
const MARIA = "sinos-codigo-da-maria-0123456789";
const env = { ADMIN_KEY: ADMIN, ACCESS_CODES: `maria:${hashCode(MARIA)},x:naoehash`, NODE_ENV: "production" };

describe("acesso restrito", () => {
  it("códigos: admin pela ADMIN_KEY, convidados pelo hash; errado, curto ou fora da lista não entra", () => {
    expect([...accessUsers(env).keys()]).toEqual(["maria"]);
    expect(checkCode(ADMIN, env)).toBe("admin");
    expect(checkCode(` ${MARIA} `, env)).toBe("maria");
    expect(checkCode(MARIA + "x", env)).toBeNull();
    expect(checkCode("curto", env)).toBeNull();
    expect(accessConfigured(env)).toBe(true);
    expect(accessConfigured({ NODE_ENV: "production" })).toBe(false);
  });

  it("sessão: assinada, expira, não aceita adulteração e cai quando o acesso é retirado", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const t = signSession("maria", now, env)!;
    expect(verifySession(t, now + 1000, env)).toBe("maria");
    expect(verifySession(t, now + 8 * 86400_000, env)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, u: "admin", iat: now, exp: now + 86400_000 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, now, env)).toBeNull();
    expect(verifySession(`${body}.${sig.slice(0, -2)}xx`, now, env)).toBeNull();
    expect(verifySession(t, now, { ...env, ACCESS_CODES: "" })).toBeNull();
    expect(verifySession(t, now, { ...env, SESSION_SECRET: "outro" })).toBeNull();
    expect(verifySession(undefined, now, env)).toBeNull();
  });

  it("robôs pelos segredos próprios; próximo destino só interno; limite por janela", () => {
    expect(machineAuth(new Headers({ authorization: `Bearer ${ADMIN}` }), env)).toBe(true);
    expect(machineAuth(new Headers({ "x-coletor-key": "k".repeat(20) }), { ...env, PLD_INGEST_KEY: "k".repeat(20) })).toBe(true);
    expect(machineAuth(new Headers({ authorization: "Bearer errado" }), env)).toBe(false);
    expect(safeNext("/planejamento?sub=NE")).toBe("/planejamento?sub=NE");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "/entrar", null]) expect(safeNext(bad)).toBe("/");
    const rl = new RateLimiter(2, 1000);
    expect([rl.hit("a", 0), rl.hit("a", 1), rl.hit("a", 2), rl.hit("a", 1500)]).toEqual([true, true, false, true]);
  });

  it("proxy: sem sessão a página vai para /entrar e a API dá 401; com sessão ou segredo passa", async () => {
    process.env.ADMIN_KEY = ADMIN;
    const { proxy } = await import("@/proxy");
    const page = proxy(new NextRequest("https://x.test/planejamento?sub=S"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://x.test/entrar?next=%2Fplanejamento%3Fsub%3DS");
    expect(proxy(new NextRequest("https://x.test/api/pld")).status).toBe(401);
    expect(proxy(new NextRequest("https://x.test/entrar")).status).toBe(200);
    expect(proxy(new NextRequest("https://x.test/api/acesso", { method: "POST" })).status).toBe(200);
    const token = signSession("admin")!;
    const ok = proxy(new NextRequest("https://x.test/api/pld", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(proxy(new NextRequest("https://x.test/api/planejamento", { headers: { authorization: `Bearer ${ADMIN}` } })).headers.get("x-middleware-next")).toBe("1");
    delete process.env.ADMIN_KEY;
  });

  it("login: código certo cria cookie HttpOnly; errado conta tentativa e bloqueia depois de 5", async () => {
    process.env.ADMIN_KEY = ADMIN;
    const { POST } = await import("@/app/api/acesso/route");
    const post = (codigo: string, ip: string) =>
      POST(new Request("https://x.test/api/acesso", { method: "POST", body: JSON.stringify({ codigo }), headers: { "x-forwarded-for": ip } }));
    const ok = await post(ADMIN, "1.1.1.1");
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post("codigo-errado-mas-longo-o-bastante", "2.2.2.2")).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await post(ADMIN, "2.2.2.2")).status).toBe(429);
    delete process.env.ADMIN_KEY;
  }, 20_000);
});
