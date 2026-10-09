import type { ReportContext } from "../context";
import { MODALIDADE_LABEL, SUBMERCADO_LABEL } from "../context";
import { fmtBRL, fmtDMS, fmtDateTime, fmtDecimalDeg, fmtNum, MONTHS_SHORT } from "../format";
import type { Cell, Column } from "../layout";
import { C, statusColors } from "../theme";
import type { Provenance } from "@/lib/types";

/** Linha de procedência compacta: "Fonte: X (AO VIVO, 04/10/2026 10:14)" */
export function sourceLine(list: (Provenance | null | undefined)[]): string {
  const items = list.filter((p): p is Provenance => !!p);
  if (items.length === 0) return "Fonte: não informada.";
  return (
    "Fonte: " +
    items.map((p) => `${p.name} (${statusColors(p.status).label.toLowerCase()}, ${fmtDateTime(p.fetchedAt)})`).join("; ") +
    "."
  );
}

export function renderLocation(ctx: ReportContext): void {
  const { l, a } = ctx;
  const loc = a.location;
  const pl = a.plant.location;
  l.sectionTitle(2, "Localização e dados do local", {
    lead: "Identificação geográfica e administrativa do empreendimento (IBGE) e coordenadas do arranjo fotovoltaico.",
  });

  const lat = pl.lat;
  const lon = pl.lon;
  const osm = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=14/${lat.toFixed(5)}/${lon.toFixed(5)}`;
  const items: { label: string; value: string; mono?: boolean; link?: string; color?: typeof C.text }[] = [
    { label: "Município", value: loc?.municipio || pl.municipio },
    { label: "UF", value: loc?.ufNome ? `${loc.ufNome} (${loc.uf || pl.uf})` : loc?.uf || pl.uf },
    { label: "Código IBGE", value: String(loc?.ibgeCode || pl.ibgeCode) },
    { label: "Região geográfica", value: loc?.regiao ?? "—" },
    { label: "Região geográfica intermediária", value: loc?.regiaoIntermediaria ?? "—" },
    { label: "Região geográfica imediata", value: loc?.regiaoImediata ?? "—" },
    { label: "Latitude", value: `${fmtDecimalDeg(lat)}  ·  ${fmtDMS(lat, "lat")}` },
    { label: "Longitude", value: `${fmtDecimalDeg(lon)}  ·  ${fmtDMS(lon, "lon")}` },
    { label: "Altitude", value: loc?.elevationM !== undefined && loc?.elevationM !== null ? `${fmtNum(loc.elevationM, 0)} m` : "—" },
    { label: "Distribuidora", value: pl.distribuidora },
    { label: "Submercado (SIN)", value: SUBMERCADO_LABEL[pl.submercado] ?? pl.submercado },
    { label: "Modalidade", value: MODALIDADE_LABEL[a.plant.tech.modalidade] ?? a.plant.tech.modalidade },
    {
      label: "População",
      value: loc?.populacao ? `${fmtNum(loc.populacao, 0)} hab.${loc.populacaoAno ? ` (${loc.populacaoAno})` : ""}` : "Não disponível",
    },
    {
      label: "PIB per capita",
      value: loc?.pibPerCapitaBRL ? `${fmtBRL(loc.pibPerCapitaBRL)}${loc.pibAno ? ` (${loc.pibAno})` : ""}` : "Não disponível",
    },
    { label: "Mapa (OpenStreetMap)", value: "Abrir localização ↗", link: osm, color: C.sky },
  ];
  l.definitionGrid(items, { cols: 3, after: 4 });
  l.caption(sourceLine(loc?.provenance ?? []), { after: 10 });

  // ── clima mensal (tabela transposta: meses em colunas) ──
  const m = a.resource?.monthly;
  if (m && Array.isArray(m.ghiKWhM2Day) && m.ghiKWhM2Day.length === 12) {
    l.subTitle("Climatologia mensal", { minSpace: 150, right: "Médias mensais de longo prazo" });
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const rows: Cell[][] = [];
    const addRow = (label: string, arr: number[] | undefined, dec: number, agg: "mean" | "max" | "min" = "mean", color?: typeof C.text) => {
      if (!arr || arr.length !== 12 || arr.some((v) => !Number.isFinite(v))) return;
      const total = agg === "mean" ? mean(arr) : agg === "max" ? Math.max(...arr) : Math.min(...arr);
      rows.push([
        { text: label, font: "semibold" },
        ...arr.map((v) => ({ text: fmtNum(v, dec), color })),
        { text: fmtNum(total, dec), font: "semibold" as const },
      ]);
    };
    addRow("GHI (kWh/m²/dia)", m.ghiKWhM2Day, 2, "mean", C.amberDark);
    addRow("GHI no mês (kWh/m²)", m.ghiKWhM2Day.map((v, i) => v * DAYS[i]), 0);
    addRow("DHI (kWh/m²/dia)", m.dhiKWhM2Day, 2);
    addRow("Temp. média (°C)", m.tempC, 1);
    addRow("Temp. máxima (°C)", m.tempMaxC, 1, "max", C.red);
    addRow("Temp. mínima (°C)", m.tempMinC, 1, "min", C.sky);
    addRow("Vento a 2 m (m/s)", m.windMs, 1);
    // linha GHI no mês: total anual em vez de média
    const ghiMonthRow = rows.find((r) => typeof r[0] !== "string" && r[0].text.startsWith("GHI no mês"));
    if (ghiMonthRow) {
      const sum = m.ghiKWhM2Day.reduce((s, v, i) => s + v * DAYS[i], 0);
      ghiMonthRow[13] = { text: fmtNum(sum, 0), font: "semibold" };
    }
    const columns: Column[] = [
      { header: "Variável", width: 3.3 },
      ...MONTHS_SHORT.map((mm) => ({ header: mm, width: 1, align: "right" as const })),
      { header: "Ano", width: 1.15, align: "right" },
    ];
    l.table({ columns, rows, size: 7.3, padX: 3.2, after: 3 });
    l.caption(
      "Ano: média (GHI, DHI, temperatura média, vento), total anual (GHI no mês), máxima e mínima absolutas. " + sourceLine(a.resource.provenance ?? []),
      { after: 6 },
    );
  }
}
