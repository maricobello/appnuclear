import { z } from "zod";
import { safeEq } from "@/lib/auth";
import { invalidate } from "@/lib/cache";
import { OFFICIAL_CACHE_KEY } from "@/lib/data";
import { officialDaysFromPanel } from "@/lib/market/pld-official";
import { parsePldRecords } from "@/lib/sources/ccee";
import { claimSlot, loadPldDays, savePldDays } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

/**
 * Recebe o PLD oficial baixado pelo coletor (scripts/coletor-ccee.mjs), que roda numa
 * conexão comum do usuário e lê a API pública de Dados Abertos da CCEE com identificação
 * honesta — a CCEE bloqueia servidores de nuvem, não quem usa o portal normalmente.
 * Autenticado por PLD_INGEST_KEY (header x-coletor-key). Os registros passam pelo mesmo
 * parser da busca direta; só entram dias completos, dentro do piso/teto do ano e até D+1.
 */
const Body = z.object({
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(20000),
  origem: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const key = process.env.PLD_INGEST_KEY;
  if (!key) return Response.json({ error: "coletor desligado: cadastre PLD_INGEST_KEY na Vercel" }, { status: 503, headers: noStore });
  const got = req.headers.get("x-coletor-key") ?? "";
  if (!got || !safeEq(got, key)) return Response.json({ error: "chave do coletor inválida" }, { status: 401, headers: noStore });
  if (!(await claimSlot("pld_coletor", 20_000))) return Response.json({ error: "envios muito próximos — tente em alguns segundos" }, { status: 429, headers: noStore });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "corpo inválido: esperado { records: [...] } do datastore_search da CCEE" }, { status: 400, headers: noStore });
  try {
    const { panel, quality } = parsePldRecords(parsed.data.records, 90);
    const { accepted, rejected } = officialDaysFromPanel(panel, Date.now());
    const written = accepted.length ? await savePldDays(accepted) : 0;
    invalidate(OFFICIAL_CACHE_KEY);
    invalidate("bundle:br");
    return Response.json(
      {
        recebidos: parsed.data.records.length,
        dias_aceitos: accepted.map((d) => d.date),
        dias_rejeitados: rejected,
        gravados_agora: written,
        duplicados: quality.duplicates,
        invalidos: quality.invalid,
      },
      { headers: noStore },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422, headers: noStore });
  }
}

/** Estado: coletor configurado e os dias oficiais mais recentes gravados. */
export async function GET() {
  const days = await loadPldDays(10).catch(() => []);
  return Response.json(
    {
      configurado: !!process.env.PLD_INGEST_KEY,
      dias_recentes: days.map((d) => ({ data: d.date, oficial: d.source === "ccee" })),
    },
    { headers: noStore },
  );
}
