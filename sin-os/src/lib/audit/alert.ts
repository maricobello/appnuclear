import "server-only";
import type { AuditRun } from "./types";

/**
 * Saúde operacional a partir de uma execução da auditoria. O bloqueio 403 da CCEE é
 * esperado e coberto pelo fallback do CMO (o PLD continua real), então `ccee_pld` NÃO
 * conta como fonte fora do ar — senão o alerta dispararia o tempo todo sem motivo.
 */
export interface Health {
  healthy: boolean;
  score: number;
  reasons: string[];
}

const EXPECTED_DOWN = new Set(["ccee_pld"]);
const minScore = () => Number(process.env.ALERT_MIN_SCORE ?? 70);

export function healthOf(run: AuditRun): Health {
  const reasons: string[] = [];
  if (run.overallScore < minScore()) reasons.push(`score ${run.overallScore} < ${minScore()}`);
  for (const s of run.sources) {
    if (s.status === "down" && !EXPECTED_DOWN.has(s.id)) reasons.push(`${s.id} fora do ar: ${s.error ?? "sem dados"}`);
  }
  for (const c of run.cross) if (c.status === "fail") reasons.push(`integridade ${c.id}: ${c.detail}`);
  if (run.storage !== "firestore") reasons.push("persistência caiu para memória (Firestore indisponível)");
  return { healthy: reasons.length === 0, score: run.overallScore, reasons };
}

/**
 * Notifica um webhook quando a saúde piora. Compatível com Slack/Discord/ntfy/Teams
 * (payload `{text, content}`). Só dispara em transição para não-saudável (evita spam) e
 * nunca lança — falha de alerta não pode derrubar a auditoria. Opt-in por ALERT_WEBHOOK_URL.
 */
export async function notifyIfDegraded(run: AuditRun, previous: AuditRun | null): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const now = healthOf(run);
  if (now.healthy) return false;
  if (previous && !healthOf(previous).healthy) return false; // já estava ruim: não repete
  const base = process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app";
  const text = `⚠️ SIN OS — auditoria degradada (score ${run.overallScore}/100)\n• ${now.reasons.join("\n• ")}\n${base}/auditoria`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch {
    return false;
  }
}
