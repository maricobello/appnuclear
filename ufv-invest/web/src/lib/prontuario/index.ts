/**
 * Prontuário Econômico-Financeiro da plataforma: dados (modelo) + PDF. Usado pela rota
 * /api/prontuario (botão no /admin) e pelo comando `npm run prontuario`.
 */
import type { PlantAnalysis } from "@/lib/types";
import { buildProntuarioData, type ProntuarioData } from "./dados";
import { renderProntuario } from "./render";
import type { Ambiente } from "./ambiente";

export { buildProntuarioData, type ProntuarioData } from "./dados";
export { renderProntuario, PRONTUARIO_ATTACHMENT, PRONTUARIO_TITLE } from "./render";

export async function gerarProntuario(analyses: PlantAnalysis[], amb: Ambiente, opts: { siteUrl: string; now?: Date }): Promise<{ data: ProntuarioData; pdf: Uint8Array }> {
  const data = buildProntuarioData(analyses, { siteUrl: opts.siteUrl, now: opts.now, chainId: amb.chainId, deployed: amb.deployed, onChain: amb.onChain, review: amb.review });
  return { data, pdf: await renderProntuario(data) };
}

export function nomeArquivo(data: ProntuarioData): string {
  return `prontuario-aferi-${data.id}.pdf`;
}
