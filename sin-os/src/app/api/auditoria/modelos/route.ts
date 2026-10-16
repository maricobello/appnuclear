import { after } from "next/server";
import type { ModelAudit } from "@/lib/audit/models";
import { buildModelAudit } from "@/lib/model-audit";
import { errorResponse, jsonResponse } from "@/lib/services";
import { loadDoc, saveDoc } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Depois disso a auditoria guardada é refeita em segundo plano (quem pediu recebe a guardada). */
const FRESH_MS = 60 * 60_000;
/** Sobe quando o formato muda: a guardada de outra versão é descartada. */
const VERSION = 2;
type Stored = ModelAudit & { v?: number };
let running: Promise<ModelAudit> | null = null;

/** Uma execução por instância de cada vez; o resultado fica na memória e no Firestore (1 gravação/h). */
function refresh(): Promise<ModelAudit> {
  running ??= buildModelAudit()
    .then(async (a) => {
      await saveDoc<Stored>("model_audit", "latest", { ...a, v: VERSION }).catch(() => undefined);
      return a;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/**
 * Auditoria dos modelos sobre o PLD real (previsão, bandas, quantis, GARCH, MRJD, HMM, backtest
 * de 1 ano por regime, despacho da bateria, arbitragem, previsões publicadas e o próprio auditor).
 * Rodar tudo leva de 1 a 3 minutos: responde na hora com a última auditoria guardada e, se ela
 * tiver mais de 1 hora, refaz depois da resposta. Só a primeira de todas espera o cálculo.
 */
export async function GET() {
  try {
    const last = await loadDoc<Stored>("model_audit", "latest");
    if (last?.v === VERSION) {
      if (Date.now() - last.generatedAt > FRESH_MS) after(() => refresh().then(() => undefined, () => undefined));
      return jsonResponse(last, 300);
    }
    return jsonResponse(await refresh(), 300);
  } catch (e) {
    return errorResponse(e);
  }
}
