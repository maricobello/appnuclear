import { AGENT_MODEL } from "@/lib/audit/agent";
import { dataMode } from "@/lib/data";
import { firebaseStatus } from "@/lib/firebase";
import { PLD_LIMITS } from "@/lib/market/brazil";
import { ccePiConfigured } from "@/lib/sources/ccee-pi";
import { storageKind } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      name: "SIN OS",
      time: new Date().toISOString(),
      dataMode: dataMode(),
      storage: storageKind(),
      firebase: firebaseStatus(),
      agent: { configured: !!process.env.ANTHROPIC_API_KEY, model: AGENT_MODEL },
      optionalKeys: { EIA_API_KEY: !!process.env.EIA_API_KEY, CCEE_PLATAFORMA_INTEGRACAO: ccePiConfigured() },
      pldLimits: PLD_LIMITS,
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
