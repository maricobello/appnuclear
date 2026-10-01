/** Parser CSV (RFC 4180) com separador configurável — arquivos ONS usam ';'. */
export function parseCsv(text: string, sep?: string): { header: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.slice(0, clean.indexOf("\n") > 0 ? clean.indexOf("\n") : undefined);
  const delim = sep ?? (firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return { header, rows };
}

/** Localiza a coluna pelo primeiro padrão que casar. */
export function findCol(header: string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/** Converte número aceitando vírgula decimal (padrão BR). */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  // o último separador define o decimal: "1.234,56" (BR) vs "1,234.56" (US)
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s.replace(/,/g, ""));
}
