import "server-only";
import { safeEq } from "../auth";
import { takeDailyQuota } from "../store";
import { senhaConfere } from "./access";

/**
 * Proteções do assistente num site público:
 *  - código de acesso opcional (ASSISTANT_ACCESS_CODE): o navegador envia em
 *    "x-assistente-code"; sem ele, 401. Enquanto ASSISTANT_SIMPLE_CODE não for "off", a
 *    senha simples do front (access.ts) também é aceita — modo de teste;
 *  - limite por IP (janela deslizante, por instância) contra rajadas, por tipo de uso;
 *  - cota diária global (Firestore) — teto de custo nas APIs de IA.
 */
export type GuardKind = "chat" | "voz" | "fala" | "gd";

export const simpleCodeEnabled = () => (process.env.ASSISTANT_SIMPLE_CODE ?? "").toLowerCase() !== "off";
/** O servidor exige o código da Vercel e a senha simples não basta. */
export const accessCodeRequired = () => !!process.env.ASSISTANT_ACCESS_CODE && !simpleCodeEnabled();

const LIMIT_ENV: Record<GuardKind, [string, number]> = {
  chat: ["ASSISTANT_DAILY_LIMIT", 400],
  voz: ["ASSISTANT_STT_DAILY_LIMIT", 250],
  fala: ["ASSISTANT_TTS_DAILY_LIMIT", 900],
  gd: ["GD_DAILY_LIMIT", 3000],
};
export const dailyLimit = (kind: GuardKind) => {
  const [env, def] = LIMIT_ENV[kind];
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

const WINDOW_MS = 5 * 60_000;
const PER_IP: Record<GuardKind, number> = { chat: 24, voz: 24, fala: 160, gd: 240 };
const hits = new Map<string, number[]>();

export function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
}

export function rateLimited(ip: string, now = Date.now(), kind: GuardKind = "chat"): boolean {
  const key = kind === "chat" ? ip : `${kind}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP[kind]) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const noStore = { "Cache-Control": "no-store" };

/** Código da Vercel (estrutura antiga) ou, no modo de teste, a senha simples do front. */
export function codeOk(req: Request): boolean {
  const code = process.env.ASSISTANT_ACCESS_CODE;
  if (!code) return true;
  const got = req.headers.get("x-assistente-code") ?? "";
  return !!got && (safeEq(got, code) || (simpleCodeEnabled() && senhaConfere(got)));
}

/** Só limite por IP e cota diária (ferramentas determinísticas, sem custo de IA). */
export async function rateGuard(req: Request, kind: GuardKind): Promise<Response | null> {
  if (rateLimited(ipOf(req), Date.now(), kind)) return Response.json({ error: "muitas requisições seguidas — espere alguns minutos", code: "rate_limit" }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  const q = await takeDailyQuota(`iara_${kind}`, dailyLimit(kind));
  if (!q.ok) return Response.json({ error: "cota diária atingida — volta amanhã", code: "daily_quota" }, { status: 429, headers: noStore });
  return null;
}

export async function guard(req: Request, kind: GuardKind): Promise<Response | null> {
  if (!codeOk(req)) return Response.json({ error: "senha da Iara inválida", code: "access_code" }, { status: 401, headers: noStore });
  if (rateLimited(ipOf(req), Date.now(), kind)) return Response.json({ error: "muitas perguntas seguidas — espere alguns minutos", code: "rate_limit" }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  const q = await takeDailyQuota(`iara_${kind}`, dailyLimit(kind));
  if (!q.ok) return Response.json({ error: "cota diária da Iara atingida — volta amanhã", code: "daily_quota" }, { status: 429, headers: noStore });
  return null;
}
