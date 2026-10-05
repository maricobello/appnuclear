import { barChart } from "../charts";
import type { ReportContext } from "../context";
import { fmtNum, fmtPct, fmtPctSigned, MONTHS_SHORT } from "../format";
import { crossCheckDeviation } from "../insights";
import { C } from "../theme";
import { sourceLine } from "./location";

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function renderResource(ctx: ReportContext): void {
  const { l, a } = ctx;
  const r = a.resource;
  const g = a.generation;
  l.sectionTitle(3, "Recurso solar", {
    minSpace: 250,
    lead: "Irradiação global horizontal (GHI) de bases satelitais públicas, transposição ao plano dos módulos (POA) e validação cruzada.",
  });

  const poaGain = g.annualGhiKWhM2 > 0 ? ((g.annualPoaKWhM2 - g.annualGhiKWhM2) / g.annualGhiKWhM2) * 100 : NaN;
  const xc = crossCheckDeviation(a);
  l.tiles(
    [
      { label: "GHI anual", value: `${fmtNum(r.annualGhiKWhM2, 0)} kWh/m²`, sub: `Média diária ${fmtNum(r.annualGhiKWhM2 / 365, 2)} kWh/m²/dia` },
      { label: "POA anual (plano dos módulos)", value: `${fmtNum(g.annualPoaKWhM2, 0)} kWh/m²`, sub: Number.isFinite(poaGain) ? `${fmtPctSigned(poaGain)} vs. GHI (transposição)` : "—" },
      {
        label: "Variabilidade interanual",
        value: `CV ${fmtPct(r.interannualCvPct)}`,
        sub: r.annualSeries?.length ? `Série de ${r.annualSeries.length} anos` : "Coeficiente de variação da GHI anual",
      },
      xc
        ? {
            label: "Validação cruzada (PVGIS)",
            value: fmtPctSigned(xc.deviationPct),
            sub: `${fmtNum(xc.annualMWh, 0)} MWh/ano no PVGIS`,
            valueColor: Math.abs(xc.deviationPct) <= 5 ? C.green : C.amberDark,
          }
        : { label: "Validação cruzada (PVGIS)", value: "Indisponível", sub: "Sem resposta do PVGIS nesta emissão", valueColor: C.muted },
    ],
    { cols: 4, height: 44, after: 8 },
  );

  // ── gráfico mensal GHI + POA ──
  const ghi = r.monthly.ghiKWhM2Day;
  const poaDaily = MONTHS_SHORT.map((_, i) => {
    const mg = g.monthly.find((x) => x.month === i);
    return mg ? mg.poaKWhM2 / DAYS[i] : NaN;
  });
  l.subTitle("Irradiação média diária por mês", { minSpace: 150, right: "kWh/m²/dia" });
  l.ensure(130);
  barChart(l, { x: l.x0, y: l.y, w: l.width, h: 126 }, {
    categories: MONTHS_SHORT,
    series: [{ name: "GHI (horizontal)", values: ghi, color: C.amber }],
    lines: poaDaily.some(Number.isFinite) ? [{ name: "POA (plano dos módulos)", values: poaDaily, color: C.navy, dots: true, width: 1.3 }] : [],
    yFormat: (v) => fmtNum(v, 1),
    valueLabels: (v) => fmtNum(v, 2),
    legend: true,
    yMin: 0,
  });
  l.y += 130;
  l.caption(sourceLine(r.provenance ?? []) + " POA: saída do modelo de transposição (seção 4).", { after: 8 });

  // ── série anual e validação mensal lado a lado ──
  const series = (r.annualSeries ?? []).filter((s) => Number.isFinite(s.ghiKWhM2));
  const pv = a.pvgis;
  const hasSeries = series.length >= 3;
  const hasPv = !!pv && Array.isArray(pv.monthlyKWhPerKWp) && pv.monthlyKWhPerKWp.length === 12;
  if (hasSeries || hasPv) {
    const both = hasSeries && hasPv;
    const colW = both ? (l.width - 18) / 2 : l.width;
    const chartH = 120;
    l.ensure(chartH + 50);
    const y0 = l.y;
    let maxY = y0;
    if (hasSeries) {
      l.y = y0;
      l.subTitle("Série anual de irradiação (GHI)", { x: l.x0, width: colW, minSpace: 0, right: "kWh/m²·ano" });
      const vals = series.map((s) => s.ghiKWhM2);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1));
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      barChart(l, { x: l.x0, y: l.y, w: colW, h: chartH }, {
        categories: series.map((s) => String(s.year).slice(-2)),
        series: [{ name: "GHI anual", values: vals, color: C.amber, colorFn: (v) => (v < mean - sd ? C.amberDark : C.amber) }],
        lines: [{ name: "Média", values: vals.map(() => mean), color: C.navy, dash: [3, 2], width: 1 }],
        band: { from: mean - sd, to: mean + sd, color: C.navySoft, label: "±1 desvio-padrão" },
        yFormat: (v) => fmtNum(v, 0),
        legend: true,
        yMin: Math.floor((lo - (hi - lo) * 0.6) / 50) * 50,
        labelEvery: Math.ceil(series.length / 12),
        barRatio: 0.72,
      });
      l.y += chartH + 4;
      const minY = series.find((s) => s.ghiKWhM2 === lo)?.year;
      const maxYr = series.find((s) => s.ghiKWhM2 === hi)?.year;
      l.caption(
        `${series[0].year}–${series[series.length - 1].year}: média ${fmtNum(mean, 0)} kWh/m², desvio-padrão ${fmtNum(sd, 0)} (CV ${fmtPct((sd / mean) * 100)}); mínimo em ${minY} (${fmtNum(lo, 0)}), máximo em ${maxYr} (${fmtNum(hi, 0)}). Barras escuras: anos mais de um desvio-padrão abaixo da média.`,
        { x: l.x0, width: colW },
      );
      maxY = Math.max(maxY, l.y);
    }
    if (hasPv && pv) {
      const x = both ? l.x0 + colW + 18 : l.x0;
      l.y = y0;
      l.subTitle("Yield mensal: modelo × PVGIS", { x, width: colW, minSpace: 0, right: "kWh/kWp" });
      const model = MONTHS_SHORT.map((_, i) => {
        const mg = g.monthly.find((m) => m.month === i);
        return mg ? (mg.energyMWh * 1000) / a.plant.tech.dcKWp : NaN;
      });
      barChart(l, { x, y: l.y, w: colW, h: chartH }, {
        categories: MONTHS_SHORT.map((m) => m.slice(0, 1).toUpperCase()),
        series: [
          { name: "Modelo UFV Invest", values: model, color: C.amber },
          { name: "PVGIS", values: pv.monthlyKWhPerKWp, color: C.navy2 },
        ],
        yFormat: (v) => fmtNum(v, 0),
        legend: true,
        yMin: 0,
        barRatio: 0.78,
      });
      l.y += chartH + 4;
      const modelAnnual = model.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
      const dev = ((modelAnnual - pv.annualKWhPerKWp) / pv.annualKWhPerKWp) * 100;
      l.caption(
        `Modelo: ${fmtNum(modelAnnual, 0)} kWh/kWp·ano; PVGIS: ${fmtNum(pv.annualKWhPerKWp, 0)} kWh/kWp·ano${
          pv.interannualSdKWhPerKWp ? ` (desvio-padrão interanual ${fmtNum(pv.interannualSdKWhPerKWp, 0)})` : ""
        }; desvio ${fmtPctSigned(dev)}. ${sourceLine([pv.provenance])}`,
        { x, width: colW },
      );
      maxY = Math.max(maxY, l.y);
    }
    l.y = maxY + 2;
  } else {
    l.callout(["Série anual de irradiação e validação cruzada com o PVGIS indisponíveis nesta emissão; a análise usa apenas a climatologia mensal."], {
      accent: C.subtle,
      size: 8,
    });
  }
}
