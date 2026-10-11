import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";
import { getAllAnalyses } from "@/lib/analysis";
import { siteUrl } from "@/lib/web3/chains";
import { isAdminWallet, revisaoAmbiente } from "@/lib/prontuario/ambiente";
import { gerarProntuario, nomeArquivo } from "@/lib/prontuario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// análises das 7 usinas (cache de 15 min) + leitura dos contratos + PDF
export const maxDuration = 60;

/**
 * Prontuário Econômico-Financeiro (PDF), recalculado a cada pedido. Confidencial: exige login com a
 * carteira (SIWE) e papel administrativo no registro de investidores (ou ADMIN_WALLETS).
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "prontuario", 4, 60_000);
  if (limited) return limited;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "faça login com a carteira (SIWE)" }, { status: 401 });
  if (!(await isAdminWallet(s.address))) {
    return NextResponse.json({ error: "carteira sem papel administrativo (admin, admin pendente ou compliance) nem listada em ADMIN_WALLETS" }, { status: 403 });
  }
  const [analyses, amb] = await Promise.all([getAllAnalyses(), revisaoAmbiente()]);
  const { data, pdf } = await gerarProntuario(analyses, amb, { siteUrl });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivo(data)}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
