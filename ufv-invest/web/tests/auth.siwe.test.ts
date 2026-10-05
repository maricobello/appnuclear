import { beforeEach, describe, expect, it, vi } from "vitest";

// rotas de API importam "server-only" e cookies() do Next: simulados aqui
vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { GET as getNonce } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { NONCE_COOKIE, SESSION_COOKIE } from "@/lib/auth/session";
import { TARGET_CHAIN_ID } from "@/lib/web3/chains";

const HOST = "localhost:3000";
let ip = 0;

function siwe(account: PrivateKeyAccount, nonce: string, domain = HOST) {
  const now = new Date();
  return createSiweMessage({
    domain,
    address: account.address,
    statement: "Entrar na UFV Invest.",
    uri: `http://${domain}`,
    version: "1",
    chainId: TARGET_CHAIN_ID,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 10 * 60_000),
  });
}

function post(body: unknown, cookie: string) {
  return verify(
    new NextRequest(`http://${HOST}/api/auth/verify`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", host: HOST, cookie, "x-real-ip": `10.0.0.${++ip}` },
    }),
  );
}

/** login legítimo completo: nonce do servidor → assinatura → verify */
async function login(account: PrivateKeyAccount) {
  const res = await getNonce();
  const nonceCookie = res.cookies.get(NONCE_COOKIE)!.value;
  const { nonce } = (await res.json()) as { nonce: string };
  const message = siwe(account, nonce);
  const signature = await account.signMessage({ message });
  return { nonceCookie, message, signature, res: await post({ message, signature }, `${NONCE_COOKIE}=${nonceCookie}`) };
}

describe("tokens HMAC com separação de propósito", () => {
  it("token de sessão não vale como nonce e vice-versa", async () => {
    const { signToken, verifyToken } = await import("@/lib/auth/token");
    const exp = Math.floor(Date.now() / 1000) + 60;
    const session = signToken({ address: "0xabc", exp }, "session");
    const nonce = signToken({ nonce: "a".repeat(32), exp }, "siwe-nonce");
    expect(verifyToken(session, "session")).not.toBeNull();
    expect(verifyToken(session, "siwe-nonce")).toBeNull();
    expect(verifyToken(nonce, "siwe-nonce")).not.toBeNull();
    expect(verifyToken(nonce, "session")).toBeNull();
  });
});

describe("SIWE /api/auth/verify", () => {
  beforeEach(() => jar.clear());

  it("login legítimo cria a sessão da carteira que assinou", async () => {
    const alice = privateKeyToAccount(generatePrivateKey());
    const { res } = await login(alice);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { address: string }).address).toBe(alice.address);
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
  });

  it("o mesmo nonce não serve duas vezes (replay)", async () => {
    const alice = privateKeyToAccount(generatePrivateKey());
    const first = await login(alice);
    expect(first.res.status).toBe(200);
    const again = await post({ message: first.message, signature: first.signature }, `${NONCE_COOKIE}=${first.nonceCookie}`);
    expect(again.status).toBe(401);
  });

  it("rejeita mensagem assinada para outro domínio (phishing)", async () => {
    const alice = privateKeyToAccount(generatePrivateKey());
    const res = await getNonce();
    const nonceCookie = res.cookies.get(NONCE_COOKIE)!.value;
    const { nonce } = (await res.json()) as { nonce: string };
    const message = siwe(alice, nonce, "ufv-invest.evil.com");
    const r = await post({ message, signature: await alice.signMessage({ message }) }, `${NONCE_COOKIE}=${nonceCookie}`);
    expect(r.status).toBe(401);
  });

  it("[auditoria] o cookie de SESSÃO não pode ser usado como cookie de nonce (replay de assinatura capturada)", async () => {
    // atacante faz login normal com a própria carteira e guarda o cookie de sessão
    const attacker = privateKeyToAccount(generatePrivateKey());
    expect((await login(attacker)).res.status).toBe(200);
    const attackerSession = jar.get(SESSION_COOKIE)!;
    jar.clear();

    // assinatura SIWE da vítima para este domínio, com um nonce qualquer (capturada de um login
    // anterior, de log/HAR/extensão, ou obtida por phishing com validade longa)
    const victim = privateKeyToAccount(generatePrivateKey());
    const message = siwe(victim, "nonceantigo12345");
    const signature = await victim.signMessage({ message });

    // o token de sessão (mesma chave HMAC, mesmo formato) entra no lugar do token de nonce:
    // sem separação de domínio, nonceToken.nonce === undefined e o viem pula a checagem do nonce
    const res = await post({ message, signature }, `${NONCE_COOKIE}=${attackerSession}`);
    expect(res.status).toBe(401);
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
  });
});
