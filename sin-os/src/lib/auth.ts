import "server-only";
import { timingSafeEqual } from "node:crypto";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Autorização:
 *  - Vercel Cron envia "Authorization: Bearer $CRON_SECRET" automaticamente.
 *  - GitHub Actions / execução manual: mesmo header ou "x-admin-key: $ADMIN_KEY".
 * Sem nenhum segredo configurado, a auditoria determinística fica aberta (com
 * limite de 1 execução/min) e o agente IA (que tem custo) não é acionado.
 */
export function authorize(req: Request): { ok: boolean; privileged: boolean } {
  const cron = process.env.CRON_SECRET;
  const admin = process.env.ADMIN_KEY;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const key = req.headers.get("x-admin-key") ?? "";
  const privileged = (!!cron && !!bearer && safeEq(bearer, cron)) || (!!admin && !!key && safeEq(key, admin)) || (!!admin && !!bearer && safeEq(bearer, admin));
  if (privileged) return { ok: true, privileged };
  return { ok: !cron && !admin, privileged: false };
}
