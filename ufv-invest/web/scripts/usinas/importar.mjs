#!/usr/bin/env node
/**
 * Importa a planilha de usinas mapeadas para o site.
 *
 *   npm run usinas:importar -- dados/usinas.xlsx      (ou .csv)
 *
 * - valida cada linha (colunas em scripts/usinas/colunas.mjs; veja a planilha-modelo);
 * - busca o código IBGE do município quando a coluna estiver vazia;
 * - associa as fotos de public/images/usinas/<slug>/ (ordem da coluna "fotos" ou alfabética);
 * - grava src/data/usinas.json (o site passa a usar só essas usinas) e src/data/fotos.json.
 * Depois rode `npm run build` (ou faça o deploy) para publicar.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildPlant, norm, parseRow, slugify } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const file = process.argv[2] ?? path.join(ROOT, "dados/usinas.xlsx");
const IMG_EXT = /\.(jpe?g|png|webp|avif)$/i;

async function readRows(f) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(f)) {
    const txt = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
    const sep = (txt.split("\n")[0].match(/;/g) ?? []).length > (txt.split("\n")[0].match(/,/g) ?? []).length ? ";" : ",";
    const ws = await wb.csv.read(fs.createReadStream(f), { parserOptions: { delimiter: sep } });
    return sheetRows(ws);
  }
  await wb.xlsx.readFile(f);
  const ws = wb.worksheets.find((w) => !/instru/i.test(w.name)) ?? wb.worksheets[0];
  return sheetRows(ws);
}

function cellValue(c) {
  const v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return v.text;
  }
  return v;
}

function sheetRows(ws) {
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i] = String(cellValue(c) ?? "").trim()));
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    let any = false;
    row.eachCell({ includeEmpty: true }, (c, i) => {
      if (!header[i]) return;
      const v = cellValue(c);
      if (v !== null && v !== undefined && String(v).trim() !== "") any = true;
      o[header[i]] = v;
    });
    if (any) rows.push({ n, o });
  });
  return rows;
}

const ibgeCache = new Map();
async function ibge(municipio, uf) {
  if (!ibgeCache.has(uf)) {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`IBGE HTTP ${r.status}`);
    ibgeCache.set(uf, await r.json());
  }
  const m = ibgeCache.get(uf).find((x) => norm(x.nome) === norm(municipio));
  if (!m) throw new Error(`município "${municipio}/${uf}" não encontrado no IBGE`);
  return m.id;
}

function photosFor(slug, listed) {
  const dir = path.join(ROOT, "public/images/usinas", slug);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => IMG_EXT.test(f)) : [];
  const wanted = (listed ?? "")
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = wanted.filter((w) => !files.includes(w));
  // fotos listadas primeiro (na ordem da planilha), depois as demais da pasta em ordem alfabética
  const rest = files.filter((f) => !wanted.includes(f)).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const ordered = [...wanted.filter((w) => files.includes(w)), ...rest];
  return { list: ordered.map((f) => `/images/usinas/${slug}/${encodeURIComponent(f)}`), missing, dir };
}

const rows = await readRows(file);
if (!rows.length) {
  console.error(`Nenhuma linha encontrada em ${file}`);
  process.exit(1);
}
const plants = [];
const fotos = {};
const erros = [];
const avisos = [];
const slugs = new Set();
for (const { n, o } of rows) {
  const { valores, erros: e } = parseRow(o, n);
  if (e.length) {
    erros.push(...e);
    continue;
  }
  const slug = valores.slug ? slugify(valores.slug) : slugify(valores.nome);
  if (slugs.has(slug)) {
    erros.push(`linha ${n}: slug repetido "${slug}"`);
    continue;
  }
  slugs.add(slug);
  let code = valores.codigo_ibge;
  if (!code) {
    try {
      code = await ibge(valores.municipio, valores.uf);
    } catch (err) {
      erros.push(`linha ${n}: preencha "codigo_ibge" (${err.message})`);
      continue;
    }
  }
  const ph = photosFor(slug, valores.fotos);
  if (ph.missing.length) avisos.push(`${valores.nome}: fotos não encontradas em ${path.relative(ROOT, ph.dir)}: ${ph.missing.join(", ")}`);
  if (!ph.list.length) avisos.push(`${valores.nome}: sem fotos (coloque em ${path.relative(ROOT, ph.dir)}/)`);
  try {
    plants.push(buildPlant(valores, { ibgeCode: code, fotos: ph.list }));
    fotos[slug] = ph.list;
  } catch (err) {
    erros.push(`linha ${n}: ${err.message}`);
  }
}

for (const a of avisos) console.warn(`aviso: ${a}`);
if (erros.length) {
  console.error(`\n${erros.length} problema(s) — nada foi gravado:\n- ${erros.join("\n- ")}`);
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, "src/data/usinas.json"), JSON.stringify(plants, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "src/data/fotos.json"), JSON.stringify(fotos, null, 2) + "\n");
console.log(`✓ ${plants.length} usina(s) importada(s) de ${path.basename(file)} → src/data/usinas.json`);
for (const p of plants) console.log(`  · ${p.name} (${p.slug}) — ${p.status}, ${p.tech.dcKWp} kWp, PPA ${p.commercial.ppaActive ? "ativo" : "inativo"}, ${fotos[p.slug].length} foto(s)`);
