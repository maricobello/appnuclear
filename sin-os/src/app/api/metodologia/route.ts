import { methodology } from "@/lib/methodology";
import { jsonResponse } from "@/lib/services";

export const dynamic = "force-static";

/** Dicionário de dados e regras do auditor em JSON (mesmo conteúdo da página /metodologia). */
export function GET() {
  return jsonResponse(methodology(), 3600);
}
