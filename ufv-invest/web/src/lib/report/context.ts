import type { PDFImage } from "pdf-lib";
import type { OnChainState, PlantAnalysis, Provenance } from "@/lib/types";
import type { Layout } from "./layout";

/** "resumo" = até 4 páginas para o investidor (padrão); "completo" = relatório técnico integral */
export type ReportVariant = "resumo" | "completo";

export interface ReportContext {
  a: PlantAnalysis;
  l: Layout;
  siteUrl: string;
  plantUrl: string;
  onChain: OnChainState | null;
  reportId: string;
  now: Date;
  qr: PDFImage | null;
  attachmentName: string;
  variant: ReportVariant;
}

export const STATUS_LABEL: Record<string, string> = {
  operacao: "Em operação",
  implantacao: "Em implantação",
  encerrada: "Oferta encerrada",
};

export const MODALIDADE_LABEL: Record<string, string> = {
  "geracao-compartilhada": "Geração compartilhada (GD)",
  "autoconsumo-remoto": "Autoconsumo remoto (GD)",
  "acl-ppa": "Mercado livre (PPA)",
};

export const SUBMERCADO_LABEL: Record<string, string> = {
  "SE/CO": "SE/CO (Sudeste/Centro-Oeste)",
  S: "S (Sul)",
  NE: "NE (Nordeste)",
  N: "N (Norte)",
};

export const OFFERING_STATE_LABEL: Record<string, string> = {
  pending: "Aguardando início",
  active: "Captação em andamento",
  succeeded: "Meta mínima atingida",
  failed: "Soft cap não atingido (reembolso)",
  finalized: "Encerrada e liquidada",
  cancelled: "Cancelada",
};

export function chainLabel(chainId: number): string {
  if (chainId === 56) return "BNB Smart Chain — mainnet (chainId 56)";
  if (chainId === 97) return "BNB Smart Chain — testnet (chainId 97)";
  return `Rede chainId ${chainId}`;
}

export function explorerBase(chainId: number): string | null {
  if (chainId === 56) return "https://bscscan.com";
  if (chainId === 97) return "https://testnet.bscscan.com";
  return null;
}

export function addressUrl(chainId: number, address: string): string | null {
  const base = explorerBase(chainId);
  return base ? `${base}/address/${address}` : null;
}

/** Todas as procedências da análise, sem duplicatas (por id + url), na ordem de aparição. */
export function allProvenance(a: PlantAnalysis): Provenance[] {
  const list: Provenance[] = [
    ...(a.provenance ?? []),
    ...(a.resource?.provenance ?? []),
    ...(a.location?.provenance ?? []),
    ...(a.market?.provenance ?? []),
    ...(a.pvgis?.provenance ? [a.pvgis.provenance] : []),
    ...(a.live?.provenance ? [a.live.provenance] : []),
  ];
  const seen = new Set<string>();
  return list.filter((p) => {
    if (!p) return false;
    const key = `${p.id}|${p.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
