import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from "pdf-lib";

/**
 * Extrai os arquivos anexados (EmbeddedFiles) de um PDF — funciona no navegador e no Node.
 * Usado na página /verificar para recuperar o `dados-analise.json` do relatório e recalcular
 * o SHA-256 dos dados, sem depender do servidor.
 */
export async function extractAttachments(bytes: Uint8Array | ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!embedded) return [];
  const out: { name: string; data: Uint8Array }[] = [];

  const walk = (node: PDFDict) => {
    const arr = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (arr) {
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        const key = arr.lookup(i);
        const spec = arr.lookup(i + 1);
        if (!(spec instanceof PDFDict)) continue;
        const name = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : `anexo-${i / 2}`;
        const ef = spec.lookupMaybe(PDFName.of("EF"), PDFDict);
        const stream = ef?.lookup(PDFName.of("F"));
        if (stream instanceof PDFRawStream) out.push({ name, data: decodePDFRawStream(stream).decode() });
      }
    }
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) {
      const k = kids.lookup(i);
      if (k instanceof PDFDict) walk(k);
    }
  };
  walk(embedded);
  return out;
}

/** Lê o assunto/palavras-chave do PDF (onde o relatório grava o dataHash) */
export async function readPdfInfo(bytes: Uint8Array | ArrayBuffer) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { title: doc.getTitle(), subject: doc.getSubject(), keywords: doc.getKeywords(), creationDate: doc.getCreationDate() };
}

export async function sha256HexBrowser(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data instanceof Uint8Array ? new Uint8Array(data) : data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
