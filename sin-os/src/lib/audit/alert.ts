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
/** Idade máxima do último run antes de considerar o auditor parado (min). Cron roda a cada 15. */
export const maxAgeMin = () => Number(process.env.HEALTH_MAX_AGE_MIN ?? 60);

export function healthOf(run: AuditRun): Health {
  const reasons: string[] = [];
  if (run.overallScore < minScore()) reasons.push(`score ${run.overallScore} < ${minScore()}`);
  for (const s of run.sources) {
    if (s.status === "down" && !EXPECTED_DOWN.has(s.id)) reasons.push(`${s.id} fora do ar: ${s.error ?? "sem dados"}`);
    // série que ainda faz parse mas está muito atrasada (freshness=fail = idade > 2×SLA): também degrada a saúde
    else if (!EXPECTED_DOWN.has(s.id) && s.checks.some((c) => c.id === "freshness" && c.status === "fail")) {
      reasons.push(`${s.id} desatualizada: ${s.ageHours === null ? "sem timestamp" : `${s.ageHours.toFixed(0)} h`}`);
    }
  }
  for (const c of run.cross) if (c.status === "fail") reasons.push(`integridade ${c.id}: ${c.detail}`);
  if (run.storage !== "firestore") reasons.push("persistência caiu para memória (Firestore indisponível)");
  return { healthy: reasons.length === 0, score: run.overallScore, reasons };
}

/** Saúde incluindo a idade do run: um auditor parado (run antigo) fica não-saudável. */
export function healthWithAge(run: AuditRun, now = Date.now()): Health & { ageMinutes: number } {
  const base = healthOf(run);
  const ageMinutes = Math.round((now - run.startedAt) / 60_000);
  const reasons = [...base.reasons];
  if (ageMinutes > maxAgeMin()) reasons.push(`auditoria parada há ${ageMinutes} min (SLA ${maxAgeMin()} min)`);
  return { healthy: reasons.length === 0, score: base.score, reasons, ageMinutes };
}

/**
 * Notifica um webhook em MUDANÇA de saúde (degradou, ou recuperou). Compatível com
 * Slack/Discord/ntfy/Teams (payload `{text, content}`). Só dispara na transição (evita
 * spam), nunca lança e é opt-in por ALERT_WEBHOOK_URL.
 */
export async function notifyHealthChange(run: AuditRun, previous: AuditRun | null): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const now = healthOf(run);
  const was = previous ? healthOf(previous) : null;
  const base = process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app";
  let text: string | null = null;
  if (!now.healthy && (!was || was.healthy)) {
    text = `⚠️ SIN OS — auditoria degradada (score ${run.overallScore}/100)\n• ${now.reasons.join("\n• ")}\n${base}/auditoria`;
  } else if (now.healthy && was && !was.healthy) {
    text = `✅ SIN OS — auditoria recuperada (score ${run.overallScore}/100)\n${base}/auditoria`;
  }
  if (!text) return false;
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
