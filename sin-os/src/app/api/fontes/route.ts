import { getLiveStatus } from "@/lib/live-status";
import { errorResponse, jsonResponse } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * APIs conectadas: estado de cada fonte agora (ao vivo, alternativa, atrasada, fora, desativada),
 * com a última observação e a latência. A CDN responde por 60 s.
 */
export async function GET() {
  try {
    return jsonResponse(await getLiveStatus(), 60);
  } catch (e) {
    return errorResponse(e);
  }
}
