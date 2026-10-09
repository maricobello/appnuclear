#!/usr/bin/env node
/** Gera a planilha-modelo dados/modelo-usinas.xlsx (aba "Usinas" + aba "Instruções"). */
import path from "node:path";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { COLUNAS } from "./colunas.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const out = path.join(ROOT, "dados/modelo-usinas.xlsx");
fs.mkdirSync(path.dirname(out), { recursive: true });

const wb = new ExcelJS.Workbook();
wb.creator = "Aferi Capital";
const ws = wb.addWorksheet("Usinas", { views: [{ state: "frozen", ySplit: 1 }] });
ws.columns = COLUNAS.map((c) => ({ header: c.id, key: c.id, width: Math.max(14, Math.min(40, c.id.length + 6)) }));
ws.addRow(Object.fromEntries(COLUNAS.map((c) => [c.id, c.ex])));
ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2A44" } };
COLUNAS.forEach((c, i) => {
  if (c.obrig) ws.getRow(1).getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E8441" } };
  ws.getRow(1).getCell(i + 1).note = c.desc;
  if (c.tipo === "lista" || c.tipo === "simnao") {
    const vals = c.tipo === "simnao" ? ["sim", "não"] : c.valores;
    for (let r = 2; r <= 500; r++) ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: !c.obrig, formulae: [`"${vals.join(",")}"`] };
  }
});

const ins = wb.addWorksheet("Instruções");
ins.columns = [
  { header: "Coluna", key: "id", width: 26 },
  { header: "Obrigatória", key: "obrig", width: 12 },
  { header: "Tipo", key: "tipo", width: 10 },
  { header: "Descrição", key: "desc", width: 90 },
  { header: "Exemplo", key: "ex", width: 36 },
];
ins.getRow(1).font = { bold: true };
for (const c of COLUNAS) ins.addRow({ id: c.id, obrig: c.obrig ? "sim" : "", tipo: c.tipo, desc: c.desc, ex: c.ex });
ins.addRow({});
ins.addRow({ id: "Como importar", desc: "1) Uma linha por usina na aba Usinas (cabeçalho verde = obrigatório). 2) Fotos em public/images/usinas/<slug>/. 3) npm run usinas:importar -- dados/usinas.xlsx. 4) Faça o deploy." });

await wb.xlsx.writeFile(out);
console.log(`✓ ${path.relative(ROOT, out)}`);
