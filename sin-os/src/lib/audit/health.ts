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
/** Idade máxima do último run antes de considerar o auditor parado (min). O cron garantido é o diário da Vercel; o de 15 min do GitHub é best-effort e costuma atrasar, então o limite tolera ~1 dia. */
export const maxAgeMin = () => Number(process.env.HEALTH_MAX_AGE_MIN ?? 1500);

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


export interface HealthMessage {
  kind: "degraded" | "recovered" | "test";
  title: string;
  text: string;
}

/** Mensagem de transição de saúde (degradou / recuperou) ou null se nada mudou. */
export function healthTransition(run: AuditRun, previous: AuditRun | null, baseUrl: string): HealthMessage | null {
  const now = healthOf(run);
  const was = previous ? healthOf(previous) : null;
  if (!now.healthy && (!was || was.healthy)) {
    return {
      kind: "degraded",
      title: `SIN OS - auditoria degradada (score ${run.overallScore}/100)`,
      text: `⚠️ SIN OS — auditoria degradada (score ${run.overallScore}/100)\n• ${now.reasons.join("\n• ")}\n${baseUrl}/auditoria`,
    };
  }
  if (now.healthy && was && !was.healthy) {
    return {
      kind: "recovered",
      title: `SIN OS - auditoria recuperada (score ${run.overallScore}/100)`,
      text: `✅ SIN OS — auditoria recuperada (score ${run.overallScore}/100)\n${baseUrl}/auditoria`,
    };
  }
  return null;
}

/**
 * Formato do POST do alerta. ntfy (ntfy.sh ou auto-hospedado) recebe texto puro com
 * cabeçalhos de título/prioridade — é o caminho grátis e sem conta para push no celular;
 * Slack/Discord/Teams recebem JSON `{text, content}`.
 */
export function alertKind(url: string, format = process.env.ALERT_WEBHOOK_FORMAT): "ntfy" | "json" {
  let host = "";
  try { host = new URL(url).host; } catch { /* URL inválida: cai no JSON */ }
  return format === "ntfy" || (format !== "json" && /(^|\.)ntfy\.sh$/.test(host)) ? "ntfy" : "json";
}

export function alertRequest(url: string, msg: HealthMessage, format = process.env.ALERT_WEBHOOK_FORMAT): { body: string; headers: Record<string, string> } {
  if (alertKind(url, format) === "ntfy") {
    const link = msg.text.split("\n").pop() ?? "";
    return {
      body: msg.text,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Title: msg.title,
        Priority: msg.kind === "degraded" ? "high" : "default",
        Tags: msg.kind === "degraded" ? "warning" : msg.kind === "test" ? "test_tube" : "white_check_mark",
        ...(/^https?:\/\//.test(link) ? { Click: link } : {}),
      },
    };
  }
  return { body: JSON.stringify({ text: msg.text, content: msg.text }), headers: { "Content-Type": "application/json" } };
}
