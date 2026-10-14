import { currentMarketAlerts } from "@/lib/audit/runner";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Alertas de mercado que valem agora (pico de PLD, descolamento, janela de bateria, corte). Só leitura. */
export async function GET() {
  try {
    const r = await currentMarketAlerts();
    return jsonResponse({ generatedAt: Date.now(), ...r, alerts: r.alerts.map((a) => ({ id: a.id, rule: a.rule, title: a.message.title, text: a.message.text })) }, 600);
  } catch (e) {
    return errorResponse(e);
  }
}
