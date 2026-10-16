import { gunzipSync } from "node:zlib";
import { authorize } from "@/lib/auth";
import { GridSnapshotSchema } from "@/lib/grid/snapshot";
import { saveGridSnapshot } from "@/lib/grid/store";
import { claimSlot, storageKind } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };
/** Corpo descompactado: o relatório tem ~260 kB; 4 MB dá folga e barra abuso. */
const MAX_BYTES = 4_000_000;

/**
 * Recebe o relatório diário do modelo da rede (grid/run.py no GitHub Actions). Só com o segredo
 * do servidor (Authorization: Bearer ADMIN_KEY ou CRON_SECRET). Aceita JSON puro ou gzip.
 */
export async function POST(req: Request) {
  if (!process.env.ADMIN_KEY && !process.env.CRON_SECRET) {
    return Response.json({ error: "ingestão desligada: cadastre ADMIN_KEY na Vercel e o mesmo valor nos segredos do GitHub" }, { status: 503, headers: noStore });
  }
  if (!authorize(req).privileged) return Response.json({ error: "não autorizado" }, { status: 401, headers: noStore });
  if (!(await claimSlot("rede_ingest", 30_000))) return Response.json({ error: "envios muito próximos — tente em 30 s" }, { status: 429, headers: noStore });

  let body: unknown;
  try {
    const raw = Buffer.from(await req.arrayBuffer());
    // gzip pelos bytes mágicos: o corpo pode chegar já descompactado por um proxy no caminho
    const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: MAX_BYTES }) : raw;
    if (bytes.length > MAX_BYTES) throw new Error("corpo grande demais");
    body = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return Response.json({ error: `corpo ilegível: ${e instanceof Error ? e.message : String(e)}` }, { status: 400, headers: noStore });
  }
  const parsed = GridSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`);
    return Response.json({ error: "relatório fora do esquema", issues }, { status: 422, headers: noStore });
  }
  const s = parsed.data;
  const { kept, history } = await saveGridSnapshot(s);
  return Response.json(
    {
      dia: s.date,
      guardado: kept === "novo" ? "relatório deste dia é o mais recente" : "dia mais antigo que o guardado: só entrou no histórico",
      dias_no_historico: history.length,
      convergiu: `${s.validation.converged}/${s.validation.hours}`,
      armazenamento: storageKind(),
    },
    { headers: noStore },
  );
}
