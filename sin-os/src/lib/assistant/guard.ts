import "server-only";
import { safeEq } from "../auth";
import { takeDailyQuota } from "../store";

/**
 * Proteções do assistente num site público:
 *  - código de acesso opcional (ASSISTANT_ACCESS_CODE): o navegador envia em
 *    "x-assistente-code"; sem ele, 401;
 *  - limite por IP (janela deslizante, por instância) contra rajadas;
 *  - cota diária global (Firestore) — teto de custo na Groq.
 */
export const accessCodeRequired = () => !!process.env.ASSISTANT_ACCESS_CODE;
export const dailyLimit = (kind: "chat" | "voz") => Number(process.env[kind === "chat" ? "ASSISTANT_DAILY_LIMIT" : "ASSISTANT_STT_DAILY_LIMIT"] ?? (kind === "chat" ? 400 : 250));

const WINDOW_MS = 5 * 60_000;
const PER_IP = 24;
const hits = new Map<string, number[]>();

export function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
}

export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function guard(req: Request, kind: "chat" | "voz"): Promise<Response | null> {
  const code = process.env.ASSISTANT_ACCESS_CODE;
  if (code) {
    const got = req.headers.get("x-assistente-code") ?? "";
    if (!got || !safeEq(got, code)) return Response.json({ error: "código de acesso da Iara inválido", code: "access_code" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (rateLimited(ipOf(req))) return Response.json({ error: "muitas perguntas seguidas — espere alguns minutos", code: "rate_limit" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  const q = await takeDailyQuota(`iara_${kind}`, dailyLimit(kind));
  if (!q.ok) return Response.json({ error: "cota diária da Iara atingida — volta amanhã", code: "daily_quota" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  return null;
}
