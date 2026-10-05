import { barChart, miniBar } from "../charts";
import type { ReportContext } from "../context";
import { fmtNum, fmtPct, fmtPctSigned, MONTHS_SHORT } from "../format";
import type { Cell, Column } from "../layout";
import { C } from "../theme";

export function renderGeneration(ctx: ReportContext): void {
  const { l, a } = ctx;
  const t = a.plant.tech;
  const g = a.generation;
  l.sectionTitle(4, "Projeto técnico e geração", {
    minSpace: 260,
    lead: "Configuração do sistema, energia esperada mês a mês, cadeia de perdas e níveis de excedência (P50 a P99) usados na análise econômica.",
  });

  // ── equipamentos ──
  const tracker = t.mounting === "single-axis";
  const moduleAreaM2 = t.module.efficiencyPct > 0 ? (t.module.count * t.module.wp) / (t.module.efficiencyPct / 100) / 1000 : NaN;
  const azLabel = (az: number) => {
    const dirs = ["Norte", "Nordeste", "Leste", "Sudeste", "Sul", "Sudoeste", "Oeste", "Noroeste"];
    return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  };
  const eqRows: Cell[][] = [
    ["Módulos fotovoltaicos", t.module.model, `${fmtNum(t.module.count, 0)} × ${fmtNum(t.module.wp, 0)} Wp = ${fmtNum(t.dcKWp, 0)} kWp · η ${fmtPct(t.module.efficiencyPct)} · ${t.module.bifacial ? "bifacial" : "monofacial"} · γ ${fmtNum(t.module.gammaPmaxPctPerC, 2)} %/°C · NOCT ${fmtNum(t.module.noctC, 0)} °C`],
    ["Inversores", t.inverter.model, `${fmtNum(t.inverter.count, 0)} × ${fmtNum(t.inverter.kw, 0)} kW = ${fmtNum(t.acKW, 0)} kWac · eficiência europeia ${fmtPct(t.inverter.euroEfficiencyPct)}`],
    [
      "Estrutura",
      tracker ? "Seguidor solar de 1 eixo (N-S)" : "Estrutura fixa de solo",
      tracker
        ? `Rotação máxima ±${fmtNum(t.trackerMaxAngleDeg ?? 55, 0)}° com backtracking · albedo ${fmtNum(t.albedo, 2)}`
        : `Inclinação ${fmtNum(t.tiltDeg, 0)}° · azimute ${fmtNum(t.azimuthDeg, 0)}° (${azLabel(t.azimuthDeg)}) · albedo ${fmtNum(t.albedo, 2)}`,
    ],
    ["Relação CC/CA", `${fmtNum(t.dcKWp / t.acKW, 2)}`, `${fmtNum(t.dcKWp, 0)} kWp / ${fmtNum(t.acKW, 0)} kWac`],
    ["Área", `${fmtNum(t.landAreaHa, 1)} ha de terreno`, Number.isFinite(moduleAreaM2) ? `≈ ${fmtNum(moduleAreaM2, 0)} m² de módulos (${fmtPct((moduleAreaM2 / (t.landAreaHa * 10000)) * 100, 0)} de ocupação)` : "—"],
    ["Degradação", `${fmtPct(t.degradation.firstYearPct)} no ano 1`, `${fmtPct(t.degradation.annualPct, 2)} a.a. nos anos seguintes`],
    ["Conexão e outorga", t.ceg ? `CEG ${t.ceg}` : "CEG a obter na ANEEL", `Comissionamento ${t.commissioning.slice(0, 10).split("-").reverse().join("/")} · ${a.plant.location.distribuidora}`],
  ];
  l.subTitle("Configuração do sistema", { minSpace: 150 });
  l.table({
    columns: [
      { header: "Item", width: 1.25, font: "semibold" },
      { header: "Especificação", width: 2.1 },
      { header: "Detalhes", width: 3.6, color: C.muted },
    ],
    rows: eqRows,
    after: 10,
  });

  // ── geração mensal ──
  const monthly = MONTHS_SHORT.map((_, i) => g.monthly.find((m) => m.month === i));
  const p50 = monthly.map((m) => (m ? m.energyMWh : NaN));
  const ratio90 = g.annualP50MWh > 0 ? g.p90MWh / g.annualP50MWh : NaN;
  const p90 = p50.map((v) => v * ratio90);
  l.subTitle("Geração mensal esperada (ano 1)", { minSpace: 240, right: "MWh/mês" });
  l.ensure(150);
  barChart(l, { x: l.x0, y: l.y, w: l.width, h: 140 }, {
    categories: MONTHS_SHORT,
    series: [{ name: "P50", values: p50, color: C.amber }],
    markers: Number.isFinite(ratio90) ? [{ name: "P90", values: p90, color: C.navy }] : [],
    yFormat: (v) => fmtNum(v, 0),
    valueLabels: (v) => fmtNum(v, 0),
    legend: true,
    yMin: 0,
  });
  l.y += 144;

  const rows: Cell[][] = [
    [{ text: "POA (kWh/m²)", font: "semibold" }, ...monthly.map((m) => (m ? fmtNum(m.poaKWhM2, 0) : "—")), { text: fmtNum(g.annualPoaKWhM2, 0), font: "semibold" }],
    [{ text: "Energia P50 (MWh)", font: "semibold" }, ...monthly.map((m) => (m ? fmtNum(m.energyMWh, 0) : "—")), { text: fmtNum(g.annualP50MWh, 0), font: "semibold" }],
    [{ text: "PR (%)", font: "semibold" }, ...monthly.map((m) => (m ? fmtNum(m.prPct, 1) : "—")), { text: fmtNum(g.performanceRatioPct, 1), font: "semibold" }],
    [
      { text: "T. célula (°C)", font: "semibold" },
      ...monthly.map((m) => (m ? fmtNum(m.cellTempC, 1) : "—")),
      { text: fmtNum(monthly.reduce((s, m) => s + (m?.cellTempC ?? 0), 0) / Math.max(1, monthly.filter(Boolean).length), 1), font: "semibold" },
    ],
  ];
  const columns: Column[] = [
    { header: "Mês", width: 3.1 },
    ...MONTHS_SHORT.map((m) => ({ header: m, width: 1, align: "right" as const })),
    { header: "Ano", width: 1.2, align: "right" },
  ];
  l.table({ columns, rows, size: 7.3, padX: 3.2, after: 4 });
  l.caption(
    `Traço azul: P90 mensal proporcional (P90/P50 anual = ${fmtPct(ratio90 * 100)}). Fator de capacidade CA ${fmtPct(g.capacityFactorPct)}; yield específico ${fmtNum(g.specificYieldKWhPerKWp, 0)} kWh/kWp·ano.`,
    { after: 8 },
  );

  // ── cascata de perdas ──
  const wf = g.lossWaterfall ?? [];
  if (wf.length > 0) {
    l.subTitle("Cadeia de perdas (ano 1)", { minSpace: 160, right: "MWh/ano" });
    const start = wf[0].energyMWhAfter || Math.max(...wf.map((w) => w.energyMWhAfter));
    const maxE = Math.max(...wf.map((w) => w.energyMWhAfter), start);
    const wfRows: Cell[][] = wf.map((w, i) => {
      const gain = w.pct < 0;
      const isFirst = i === 0;
      return [
        { text: w.label, font: isFirst || i === wf.length - 1 ? "semibold" : "regular" },
        isFirst ? { text: "—", color: C.muted } : { text: gain ? `+${fmtNum(-w.pct, 1)} %` : `-${fmtNum(w.pct, 1)} %`, color: gain ? C.green : w.pct > 0 ? C.red : C.muted },
        { text: fmtNum(w.energyMWhAfter, 0), font: "semibold" },
        { text: start > 0 ? fmtPct((w.energyMWhAfter / start) * 100) : "—", color: C.muted },
        {
          text: "",
          draw: (lay, x, y, wd, h) => miniBar(lay, x + 5, y + h / 2 - 3, wd - 10, 6, w.energyMWhAfter / maxE, isFirst ? C.navy2 : i === wf.length - 1 ? C.amberDark : C.amber),
        },
      ];
    });
    l.table({
      columns: [
        { header: "Etapa", width: 3.2 },
        { header: "Perda/ganho", width: 1.05, align: "right" },
        { header: "Energia após", width: 1.15, align: "right" },
        { header: "% do nominal", width: 1.1, align: "right" },
        { header: "", width: 2.6 },
      ],
      rows: wfRows,
      size: 7.4,
      padY: 2.7,
      after: 4,
    });
    l.caption(
      `PR anual resultante: ${fmtPct(g.performanceRatioPct)} (energia CA / energia nominal no plano dos módulos). Perdas aplicadas multiplicativamente; valores negativos de perda representam ganho.`,
      { after: 8 },
    );
  }

  // ── excedência + incerteza lado a lado ──
  const u = g.uncertainty;
  const exc: [string, string, number][] = [
    ["P50", "Mediana: 50 % de chance de ser superada", g.annualP50MWh],
    ["P75", "75 % de chance de ser superada", g.p75MWh],
    ["P90", "90 % de chance (ano isolado)", g.p90MWh],
    ["P99", "99 % de chance (ano isolado)", g.p99MWh],
    ["P90 (10 anos)", "Média de 10 anos com 90 % de chance", g.p90TenYearMWh],
  ];
  const leftW = l.width * 0.58;
  const rightW = l.width - leftW - 14;
  const excSpec = {
    columns: [
      { header: "Nível", width: 1.05, font: "semibold" as const },
      { header: "Significado", width: 2.6, color: C.muted },
      { header: "MWh/ano", width: 0.95, align: "right" as const },
      { header: "kWh/kWp", width: 0.95, align: "right" as const },
      { header: "vs. P50", width: 0.85, align: "right" as const },
    ],
    rows: exc.map(([k, d, v]): Cell[] => [
      k,
      d,
      { text: fmtNum(v, 0), font: "semibold" },
      fmtNum((v * 1000) / a.plant.tech.dcKWp, 0),
      { text: k === "P50" ? "—" : fmtPctSigned(((v - g.annualP50MWh) / g.annualP50MWh) * 100), color: k === "P50" ? C.muted : C.red },
    ]),
    x: l.x0,
    width: leftW,
    size: 7.3,
    noBreak: true,
    after: 0,
  };
  const uncRows: Cell[][] = [
    ["Variabilidade interanual do recurso", fmtPct(u.interannualPct)],
    ["Dados de irradiação (satélite)", fmtPct(u.resourceDataPct)],
    ["Modelo de simulação", fmtPct(u.modelPct)],
    ["Degradação e disponibilidade", fmtPct(u.degradationPct)],
  ];
  const uncSpec = {
    columns: [
      { header: "Componente de incerteza (1σ)", width: 2.6 },
      { header: "σ", width: 0.8, align: "right" as const },
    ],
    rows: uncRows,
    footerRows: [[{ text: "Combinada (RSS)" }, { text: fmtPct(u.totalPct) }]] as Cell[][],
    x: l.x0 + leftW + 14,
    width: rightW,
    size: 7.3,
    noBreak: true,
    after: 0,
  };
  const h = Math.max(l.measureTable(excSpec), l.measureTable(uncSpec)) + 22;
  l.ensure(h + 30);
  const y0 = l.y;
  l.subTitle("Excedência (P-values)", { x: l.x0, width: leftW, minSpace: 0 });
  l.table(excSpec);
  const yLeft = l.y;
  l.y = y0;
  l.subTitle("Incerteza", { x: l.x0 + leftW + 14, width: rightW, minSpace: 0 });
  l.table(uncSpec);
  l.y = Math.max(yLeft, l.y) + 4;
  l.caption("Distribuição normal da energia anual: Pxx = P50 × (1 \u2212 z × σ). No P90 de 10 anos a parcela interanual é dividida por √10.", { after: 8 });

  // ── metodologia ──
  if (g.method?.length) {
    l.subTitle("Metodologia do modelo de geração", { minSpace: 70 });
    l.bullets(g.method, { size: 7.8, gap: 1.2, after: 4 });
  }
}
