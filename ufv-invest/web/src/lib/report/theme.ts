import { rgb, type RGB } from "pdf-lib";
import type { SourceStatus } from "@/lib/types";

function hex(h: string): RGB {
  const v = h.replace("#", "");
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
}

/** Paleta institucional do relatório */
export const C = {
  navy: hex("#0B1F2A"),
  navy2: hex("#16384A"),
  navySoft: hex("#E7EEF2"),
  amber: hex("#F5A524"),
  amberDark: hex("#B45309"),
  amberSoft: hex("#FEF3DC"),
  green: hex("#0E7C5A"),
  greenSoft: hex("#E3F4EC"),
  red: hex("#C2410C"),
  redStrong: hex("#DC2626"),
  redSoft: hex("#FDECE4"),
  text: hex("#1E293B"),
  muted: hex("#475569"),
  subtle: hex("#94A3B8"),
  border: hex("#E2E8F0"),
  zebra: hex("#F8FAFC"),
  panel: hex("#F1F5F9"),
  white: hex("#FFFFFF"),
  steel: hex("#64748B"),
  sky: hex("#3B82A6"),
};

export const PAGE = {
  width: 595.28,
  height: 841.89,
  marginX: 40,
  /** topo da área de conteúdo (abaixo da faixa de cabeçalho) */
  contentTop: 60,
  /** base da área de conteúdo (acima do rodapé) */
  contentBottom: 841.89 - 46,
  headerHeight: 30,
};

export const SIZE = {
  body: 9,
  small: 7.8,
  tiny: 6.8,
  table: 7.8,
  h1: 15,
  h2: 10.5,
  lineHeight: 1.38,
};

export function statusColors(status: SourceStatus): { fg: RGB; bg: RGB; label: string } {
  switch (status) {
    case "live":
      return { fg: C.green, bg: C.greenSoft, label: "AO VIVO" };
    case "cache":
      return { fg: C.sky, bg: C.navySoft, label: "CACHE" };
    case "fallback":
      return { fg: C.amberDark, bg: C.amberSoft, label: "FALLBACK" };
    case "error":
    default:
      return { fg: C.redStrong, bg: C.redSoft, label: "ERRO" };
  }
}
