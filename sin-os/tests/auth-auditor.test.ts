import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorize, authorizeAuditor } from "../src/lib/auth";

const req = (h: Record<string, string> = {}) => new Request("http://x", { headers: h });

describe("senha do agente auditor", () => {
  afterEach(() => {
    delete process.env.ADMIN_KEY;
    delete process.env.AUDITOR_SENHA_SIMPLES;
  });
  it("aceita senha1234 e a ADMIN_KEY no auditor", () => {
    process.env.ADMIN_KEY = "chave-real-longa";
    expect(authorizeAuditor(req({ "x-admin-key": "senha1234" }))).toEqual({ ok: true, privileged: true });
    expect(authorizeAuditor(req({ "x-admin-key": "chave-real-longa" })).privileged).toBe(true);
    expect(authorizeAuditor(req({ "x-admin-key": "errada" })).ok).toBe(false);
  });
  it("as rotas que gravam dados continuam só com a ADMIN_KEY", () => {
    process.env.ADMIN_KEY = "chave-real-longa";
    expect(authorize(req({ "x-admin-key": "senha1234" })).privileged).toBe(false);
  });
  it("AUDITOR_SENHA_SIMPLES=off desliga a senha simples", () => {
    process.env.ADMIN_KEY = "chave-real-longa";
    process.env.AUDITOR_SENHA_SIMPLES = "off";
    expect(authorizeAuditor(req({ "x-admin-key": "senha1234" })).privileged).toBe(false);
  });
});
