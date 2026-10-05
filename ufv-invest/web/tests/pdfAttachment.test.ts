import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFRef } from "pdf-lib";
import { extractAttachments } from "@/lib/pdfAttachment";

const JSON_BYTES = new TextEncoder().encode(JSON.stringify({ ok: true }));

async function pdfWithAttachment() {
  const doc = await PDFDocument.create();
  doc.addPage();
  await doc.attach(JSON_BYTES, "dados-analise.json", { mimeType: "application/json" });
  return PDFDocument.load(await doc.save());
}

describe("extractAttachments (PDF não confiável enviado em /verificar)", () => {
  it("extrai o JSON anexado", async () => {
    const doc = await pdfWithAttachment();
    const att = await extractAttachments(await doc.save());
    expect(att.map((a) => a.name)).toEqual(["dados-analise.json"]);
    expect(new TextDecoder().decode(att[0].data)).toBe('{"ok":true}');
  });

  it("[auditoria] árvore de nomes com ciclo e nós compartilhados em 30 níveis (2^30 caminhos) não trava a aba", async () => {
    const doc = await pdfWithAttachment();
    const ctx = doc.context;
    const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict);
    const original = names.lookup(PDFName.of("EmbeddedFiles"), PDFDict);
    const leaf: PDFRef = ctx.register(ctx.obj({ Names: original.lookup(PDFName.of("Names"), PDFArray) }));
    let child = leaf;
    for (let i = 0; i < 30; i++) child = ctx.register(ctx.obj({ Kids: [child, child] }));
    const root = ctx.obj({});
    const rootRef = ctx.register(root);
    root.set(PDFName.of("Kids"), ctx.obj([rootRef, child])); // ciclo + bomba exponencial
    names.set(PDFName.of("EmbeddedFiles"), rootRef);
    const bytes = await doc.save();

    const t0 = performance.now();
    const att = await extractAttachments(bytes);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(att.map((a) => a.name)).toEqual(["dados-analise.json"]);
  });
});
