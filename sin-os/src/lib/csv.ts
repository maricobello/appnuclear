/** CSV RFC 4180 (vírgula como separador, ponto decimal) — pronto para Excel/pandas. */
export const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "number" && !Number.isFinite(v) ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Monta o CSV: linha de comentário `# …` com a proveniência, cabeçalho e linhas. */
export function toCsv(header: string[], rows: unknown[][], comment?: string): string {
  return [...(comment ? [`# ${comment.replace(/\n/g, " ")}`] : []), header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

export function csvResponse(csv: string, name: string, sMaxAge = 600): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sinos-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 5}`,
    },
  });
}
