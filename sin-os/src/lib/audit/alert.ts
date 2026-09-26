import "server-only";
import { alertRequest, healthTransition, type HealthMessage } from "./health";
import type { AuditRun } from "./types";

export { healthOf, healthWithAge, maxAgeMin, type Health, type HealthMessage } from "./health";

/**
 * Notifica um webhook em MUDANÇA de saúde (degradou, ou recuperou). Compatível com
 * ntfy (push grátis no celular, sem conta), Slack, Discord e Teams. Só dispara na
 * transição (evita spam), nunca lança e é opt-in por ALERT_WEBHOOK_URL.
 */
export async function notifyHealthChange(run: AuditRun, previous: AuditRun | null): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const msg = healthTransition(run, previous, process.env.SIN_OS_URL ?? "https://sinos-iota.vercel.app");
  if (!msg) return false;
  return postAlert(url, msg);
}

/** POST do alerta no formato do destino; devolve se o destino aceitou (2xx). */
export async function postAlert(url: string, msg: HealthMessage): Promise<boolean> {
  try {
    const { body, headers } = alertRequest(url, msg);
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}
