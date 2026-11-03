import "server-only";
import { extractTextItems, getDocumentProxy } from "unpdf";

/**
 * Texto do PDF da fatura em LINHAS (as tabelas viram "descrição  kWh  preço  valor" numa
 * linha só): os itens do pdf.js são agrupados pela altura na página e ordenados da
 * esquerda para a direita. PDF escaneado (imagem) não tem texto — o chamador avisa.
 */
export class PdfError extends Error {
  constructor(
    message: string,
    public code: "senha" | "invalido" | "sem_texto",
  ) {
    super(message);
  }
}

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export function itemsToLines(page: Item[]): string[] {
  const items = page.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of items) {
    const row = rows.at(-1);
    const tol = Math.max(1.5, (it.fontSize || it.height || 8) * 0.45);
    if (row && Math.abs(row[0].y - it.y) <= tol) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const it of row) {
      const gap = it.x - end;
      // letras soltas (fontes Type3) se juntam; palavras e colunas ganham espaço
      out += out && gap > (it.fontSize || 8) * 0.18 ? " " : "";
      out += it.str;
      end = it.x + it.width;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}

export async function pdfText(data: Uint8Array, maxPages = 6): Promise<{ text: string; pages: number }> {
  let pdf;
  try {
    // PDF vem de fora: esta versão do pdf.js já não tem o caminho de fontes por eval; sem XFA nem fontes do sistema
    pdf = await getDocumentProxy(data, { useSystemFonts: false, enableXfa: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new PdfError("PDF protegido por senha — abra no leitor, salve sem senha e envie de novo", "senha");
    throw new PdfError(`PDF inválido: ${msg.slice(0, 120)}`, "invalido");
  }
  const { items, totalPages } = await extractTextItems(pdf);
  const lines = items.slice(0, maxPages).flatMap((p) => itemsToLines(p as Item[]));
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 40) throw new PdfError("PDF sem texto (escaneado): envie o PDF original da distribuidora ou cole o texto", "sem_texto");
  return { text, pages: totalPages };
}
