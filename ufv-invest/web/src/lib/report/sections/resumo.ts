/**
 * Versão "resumo" do relatório (padrão): até 4 páginas em linguagem de investidor.
 *  1. Capa + resumo do investimento   2. Seu investimento × Selic
 *  3. A usina                         4. Tokenização, fontes e avisos
 */
import type { RGB } from "pdf-lib";
import { barChart } from "../charts";
import type { ReportContext } from "../context";
import { MODALIDADE_LABEL, OFFERING_STATE_LABEL, STATUS_LABEL, addressUrl, allProvenance, chainLabel } from "../context";
import {
  displayUrl,
  fmtBRL,
  fmtBRLCompact,
  fmtDate,
  fmtDateTime,
  fmtDecimalDeg,
  fmtDMS,
  fmtNum,
  fmtPct,
  fmtPctSigned,
  fmtYears,
} from "../format";
import { crossCheckDeviation, fioBRuleText, fioBShortText, statusSummary } from "../insights";
import { buildInvestmentComparison, rateHeadline, topDrivers, type WealthKey } from "../investor";
import { Layout, type Cell, type Run } from "../layout";
import { C, PAGE, statusColors } from "../theme";
import { ILLUSTRATIVE_TEXT } from "./cover";
import { fromUnits, toCotas, USDT_DECIMALS } from "./tokenization";

const SIM_AMOUNT_BRL = 10_000;
/** consumo médio residencial aproximado, kWh/mês (ordem de grandeza nacional) */
const HOUSEHOLD_KWH_MONTH = 160;

const SERIES_COLOR: Record<WealthKey, RGB> = {
  usina: C.amber,
  cdi: C.navy,
  ipca: C.sky,
  poupanca: C.subtle,
};

const colorOf = (key: WealthKey): RGB => SERIES_COLOR[key];

// ─── página 1 ───────────────────────────────────────────────────────────────────────────────

export function renderResumoCover(ctx: ReportContext): void {
  const { l, a } = ctx;
  const p = a.plant;
  const f = a.finance;
  const g = a.generation;
  l.addPage();

  const HERO_H = 196;
  l.rect(0, 0, PAGE.width, HERO_H, { fill: C.navy });
  l.rect(0, HERO_H, PAGE.width, 2.2, { fill: C.amber });
  const x = PAGE.marginX;
  const qrBox = 92;
  const textW = PAGE.width - 2 * PAGE.marginX - qrBox - 28;

  l.text("RESUMO PARA O INVESTIDOR  ·  RELATÓRIO DE AUDITORIA", x, 56, { font: "semibold", size: 7.4, color: C.amber });
  let nameSize = 26;
  while (nameSize > 18 && l.textWidth(p.name, "bold", nameSize) > textW) nameSize -= 1;
  let nameLines = l.wrap(p.name, "bold", nameSize, textW);
  if (nameLines.length > 2) nameLines = [nameLines[0], l.fit(nameLines.slice(1).join(" "), "bold", nameSize, textW)];
  let y = 66;
  nameLines.forEach((ln, i) => {
    y += i === 0 ? nameSize : nameSize * 1.12;
    l.text(ln, x, y, { font: "bold", size: nameSize, color: C.white, width: textW, truncate: true });
  });
  y += 17;
  l.text(`${p.location.municipio} / ${p.location.uf}  ·  ${p.location.distribuidora}`, x, y, { size: 9.2, color: C.heroText, width: textW, truncate: true });
  y += 16;
  let cx = x;
  cx += l.chip((STATUS_LABEL[p.status] ?? p.status).toUpperCase(), cx, y, C.navy, C.amber, 6.8) + 5;
  cx += l.chip((MODALIDADE_LABEL[p.tech.modalidade] ?? p.tech.modalidade).toUpperCase(), cx, y, C.white, C.navy2, 6.8) + 5;
  l.chip(`${fmtNum(p.tech.dcKWp, 0)} kWp`, cx, y, C.white, C.navy2, 6.8);
  l.text(`Dados de ${fmtDateTime(a.generatedAt, true)}  ·  ${ctx.reportId}`, x, HERO_H - 18, { size: 6.8, color: C.headerMuted, width: textW, truncate: true });

  const qx = PAGE.width - PAGE.marginX - qrBox;
  const qy = 48;
  l.roundRect(qx, qy, qrBox, qrBox, 5, { fill: C.white });
  if (ctx.qr) l.image(ctx.qr, qx + 6, qy + 6, qrBox - 12, qrBox - 12);
  l.link(qx, qy, qrBox, qrBox, ctx.plantUrl);
  l.text("Acompanhe ao vivo", qx - 14, qy + qrBox + 13, { font: "semibold", size: 6.8, color: C.heroText, align: "center", width: qrBox + 28 });
  l.text(displayUrl(ctx.siteUrl) || "página da usina", qx - 24, qy + qrBox + 23, { size: 6.2, color: C.amber, align: "center", width: qrBox + 48, truncate: true });
  l.link(qx - 24, qy + qrBox + 5, qrBox + 48, 22, ctx.plantUrl);

  l.y = HERO_H + 18;
  if (p.illustrative) {
    const [lead, ...rest] = ILLUSTRATIVE_TEXT.split(": ");
    l.callout([[{ text: `${lead}: `, font: "semibold", color: C.amberDark }, { text: rest.join(": ") }]], {
      accent: C.amber,
      bg: C.amberSoft,
      size: 7.8,
      after: 0,
    });
  }

  // ── manchete: TIR × Selic ──
  const h = rateHeadline(a);
  l.y += 30;
  l.text("RENTABILIDADE PROJETADA · CENÁRIO P50", x, l.y, { font: "semibold", size: 7, color: C.muted });
  l.y += 8;
  const above = h.vsSelicPp >= 0;
  l.rich(
    [
      { text: "TIR de " },
      { text: `${fmtPct(h.irrPct)} a.a.`, color: Number.isFinite(h.irrPct) && above ? C.green : C.redStrong },
      { text: " contra Selic de " },
      { text: `${fmtPct(h.selicPct, 2)} a.a.` },
    ],
    { font: "bold", size: 19, color: C.navy, lineHeight: 1.2, after: 6 },
  );
  const chipText = Number.isFinite(h.vsSelicPp) ? `${fmtNum(Math.abs(h.vsSelicPp), 1)} p.p. ${above ? "acima" : "abaixo"} da Selic` : "Comparação indisponível";
  const cw = l.chip(chipText.toUpperCase(), x, l.y, above ? C.green : C.redStrong, above ? C.greenSoft : C.redSoft, 7.2);
  l.rich(
    [
      { text: `${h.vsCdiNetPp >= 0 ? "+" : "-"}${fmtNum(Math.abs(h.vsCdiNetPp), 1)} p.p. ` },
      { text: `sobre o CDI líquido de IR (${fmtPct(h.cdiNetPct)} a.a.)  ·  chance de render menos que o CDI: ` },
      { text: fmtPct(h.probIrrBelowCdiPct), font: "semibold", color: h.probIrrBelowCdiPct > 20 ? C.redStrong : C.navy },
    ],
    { x: x + cw + 8, width: l.width - cw - 8, size: 8.4, color: C.muted, lineHeight: 1.45, noBreak: true },
  );
  l.y += 22;

  // ── 6 KPIs ──
  const homes = (g.annualP50MWh * 1000) / (HOUSEHOLD_KWH_MONTH * 12);
  l.tiles(
    [
      { label: "TIR nominal", value: `${fmtPct(f.irrNominalPct)} a.a.`, sub: `Real: ${fmtPct(f.irrRealPct)} a.a. acima da inflação`, accent: C.navy, valueColor: f.irrNominalPct >= h.selicPct ? C.green : C.navy },
      { label: "Renda estimada por cota", value: `${fmtBRL(f.perCota.avgMonthlyIncomeBRL)}/mês`, sub: `Média em ${p.finance.horizonYears} anos · cota de ${fmtBRL(p.token.cotaPriceBRL)}`, accent: C.navy },
      { label: "Payback", value: fmtYears(f.paybackYears), sub: "Tempo para recuperar o valor investido", accent: C.navy },
      { label: "Investimento mínimo", value: fmtBRL(p.token.minCotas * p.token.cotaPriceBRL, 0), sub: `${fmtNum(p.token.minCotas, 0)} cotas de ${fmtBRL(p.token.cotaPriceBRL)} (${fmtNum(p.token.cotaPriceUSDT, 2)} USDT)`, accent: C.amber },
      { label: "Geração esperada (P50)", value: `${fmtNum(g.annualP50MWh, 0)} MWh/ano`, sub: `≈ consumo de ${fmtNum(homes, 0)} residências`, accent: C.amber },
      { label: "CO₂ evitado", value: `${fmtNum(g.co2AvoidedTonsYear, 0)} t/ano`, sub: "Fator médio de emissão do SIN", accent: C.green },
    ],
    { cols: 3, height: 70, gap: 10, valueSize: 20, after: 26 },
  );

  // ── em poucas palavras ──
  l.subTitle("Em poucas palavras", { minSpace: 80 });
  const genRow = (f.sensitivity ?? []).find((s) => /gera/i.test(s.variable));
  const bullets: Run[][] = [
    [{ text: "Você compra cotas (tokens) da SPE dona da usina; a receita líquida da energia é distribuída em USDT, na proporção das suas cotas." }],
  ];
  if (genRow && Number.isFinite(genRow.irrLowPct) && Number.isFinite(genRow.irrHighPct)) {
    bullets.push([
      { text: `Cenário conservador: com a geração P90 (${fmtNum(g.p90MWh, 0)} MWh/ano), a TIR projetada seria de ` },
      { text: `${fmtPct(Math.min(genRow.irrLowPct, genRow.irrHighPct))} a.a.`, font: "semibold" },
    ]);
  }
  bullets.push([{ text: fioBRuleText(a).replace(/ \(hipótese para a regra ANEEL pós-2028\)/, "") + " Já considerado nos números." }]);
  l.bullets(bullets, { size: 8.8, gap: 5, lineHeight: 1.45 });

  renderIntegrityStrip(ctx, Math.max(l.y + 12, l.bottom - 62));
}

/** Faixa compacta de integridade: hash completo + como verificar. `top` = posição desejada. */
function renderIntegrityStrip(ctx: ReportContext, top: number): void {
  const { l, a } = ctx;
  const h = 58;
  if (top + h > l.bottom) {
    l.addPage();
    top = l.y;
  }
  const x = l.x0;
  const w = l.width;
  l.rect(x, top, w, h, { fill: C.panel });
  l.rect(x, top, 3, h, { fill: C.navy });
  const hash = (a.dataHash || "").replace(/^0x/, "").toLowerCase();
  l.text("INTEGRIDADE DOS DADOS · SHA-256", x + 14, top + 15, { font: "semibold", size: 6.6, color: C.navy });
  const oc = ctx.onChain;
  const anchored = !!oc?.documents.some((d) => d.hash.replace(/^0x/, "").toLowerCase() === hash && hash.length > 0);
  l.chip(anchored ? "HASH REGISTRADO ON-CHAIN" : oc ? "AINDA NÃO REGISTRADO ON-CHAIN" : "ON-CHAIN NÃO CONSULTADO", x + w - 10, top + 7, anchored ? C.green : C.muted, anchored ? C.greenSoft : C.border, 6, "right", 0);
  l.text(hash || "—", x + 14, top + 31, { font: "mono", size: 8, color: C.text, width: w - 28, truncate: true });
  const verify = `${ctx.siteUrl}/verificar`;
  l.text(
    `O JSON anexado a este PDF (${ctx.attachmentName}) reproduz o hash acima; confira em ${displayUrl(verify)}.`,
    x + 14,
    top + 46,
    { size: 7.2, color: C.muted, width: w - 28, truncate: true },
  );
  l.link(x, top, w, h, verify);
  l.y = top + h;
}

// ─── página 2 ───────────────────────────────────────────────────────────────────────────────

export function renderResumoInvestment(ctx: ReportContext): void {
  const { l, a } = ctx;
  const f = a.finance;
  const cmp = buildInvestmentComparison(a, SIM_AMOUNT_BRL);
  l.addPage();
  l.sectionTitle(2, "Seu investimento × Selic", {
    lead: `Simulação de ${fmtBRL(cmp.investedBRL, 0)} em ${fmtNum(cmp.cotas, 0)} cotas, proporcional ao fluxo de caixa P50 da usina, comparada com a renda fixa no mesmo horizonte de ${cmp.years} anos.`,
  });
  l.gap(4);
  const paybackCal = cmp.paybackYears !== null ? cmp.calendarYears[0] + Math.ceil(cmp.paybackYears) : null;
  l.tiles(
    [
      { label: "Renda no ano 1", value: fmtBRL(cmp.firstYearIncomeBRL, 0), sub: `≈ ${fmtBRL(cmp.firstYearIncomeBRL / 12, 0)} por mês`, accent: C.amber },
      { label: "Renda média mensal", value: fmtBRL(cmp.avgMonthlyIncomeBRL, 0), sub: `Média de ${cmp.years} anos`, accent: C.amber, valueColor: C.green },
      { label: `Total recebido em ${cmp.years} anos`, value: fmtBRL(cmp.totalIncomeBRL, 0), sub: `${fmtNum(cmp.investedBRL > 0 ? cmp.totalIncomeBRL / cmp.investedBRL : NaN, 1)}x o valor investido (bruto)`, accent: C.amber },
      { label: "Payback", value: fmtYears(cmp.paybackYears), sub: paybackCal ? `Aporte recuperado até ${paybackCal}` : "Aporte não recuperado no horizonte", accent: C.amber },
    ],
    { cols: 4, height: 62, gap: 8, valueSize: 17, after: 18 },
  );

  // ── gráfico de patrimônio ──
  l.subTitle("Patrimônio acumulado: usina × alternativas", { minSpace: 220, right: "R$ mil · líquido de IR no resgate" });
  const chartH = 222;
  l.ensure(chartH + 4);
  const order: WealthKey[] = ["poupanca", "ipca", "cdi", "usina"];
  const byKey = new Map(cmp.series.map((s) => [s.key, s]));
  barChart(l, { x: l.x0, y: l.y, w: l.width, h: chartH }, {
    categories: cmp.calendarYears.map(String),
    series: [],
    lines: order
      .map((k) => byKey.get(k)!)
      .filter(Boolean)
      .map((s) => ({
        name: s.name,
        values: s.values,
        color: colorOf(s.key),
        width: s.key === "usina" ? 2.4 : 1.4,
        dash: s.key === "poupanca" ? [3, 2] : undefined,
        endLabel: fmtBRLCompact(s.finalBRL, 0),
      })),
    yFormat: (v) => fmtNum(v / 1000, 0),
    legend: true,
    yMin: 0,
    labelEvery: 5,
    rightPad: 58,
    maxTicks: 6,
  });
  l.y += chartH + 4;
  const cross = cmp.crossoverYear;
  l.caption(
    (cross !== null
      ? `A renda da usina, reinvestida no CDI, passa a superar a aplicação direta no CDI em ${cmp.calendarYears[cross]} (ano ${cross}). `
      : "No horizonte simulado, a renda reinvestida da usina não supera a aplicação direta no CDI. ") +
      "A linha da usina começa em zero porque o aporte vira cotas; não inclui valor residual das cotas. CDI convergindo da taxa atual para a taxa neutra de longo prazo.",
    { after: 10 },
  );

  // ── tabela de valores finais ──
  const usina = byKey.get("usina");
  const finalOf = (s: (typeof cmp.series)[number]) => s.benchmarkFinalBRL ?? s.finalBRL;
  const rows: Cell[][] = (["usina", "cdi", "ipca", "poupanca"] as WealthKey[])
    .map((k) => byKey.get(k))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const isU = s.key === "usina";
      const diff = usina && !isU ? (finalOf(usina) / finalOf(s) - 1) * 100 : NaN;
      return [
        { text: "", draw: (lay: Layout, cx: number, cy: number, cw: number) => lay.rect(cx + cw - 9, cy + 6.3, 7, 7, { fill: colorOf(s.key) }) },
        { text: s.name, font: isU ? "bold" : "semibold" },
        { text: Number.isFinite(s.annualPct) ? `${fmtPct(s.annualPct)} a.a.` : "—" },
        { text: fmtBRL(finalOf(s), 0), font: isU ? "bold" : "semibold", color: isU ? C.green : C.text },
        isU ? { text: "referência", color: C.muted } : { text: Number.isFinite(diff) ? `usina ${fmtPctSigned(diff, 0)}` : "—", color: diff >= 0 ? C.green : C.redStrong },
        { text: isU ? `${s.note} Equivale a ${fmtPct(s.annualPct)} a.a. com reinvestimento (TIR do projeto: ${fmtPct(f.irrNominalPct)}).` : s.note, color: C.muted, size: 6.6 },
      ];
    });
  l.table({
    columns: [
      { header: "", width: 0.22 },
      { header: "Alternativa", width: 1.95 },
      { header: "Retorno anual", width: 0.95, align: "right" },
      { header: `Valor final (${cmp.calendarYears[cmp.calendarYears.length - 1]})`, width: 1.2, align: "right" },
      { header: "Vantagem da usina", width: 1.1, align: "right" },
      { header: "Como foi calculado", width: 2.75 },
    ],
    rows,
    size: 7.6,
    padY: 4,
    after: 12,
  });

  // ── risco em números ──
  const mc = f.monteCarlo;
  const drivers = topDrivers(f.sensitivity, 3);
  const body: Run[][] = [];
  if (mc && Number.isFinite(mc.irrP50Pct)) {
    body.push([
      { text: `Em ${fmtNum(mc.runs, 0)} cenários simulados, a TIR fica entre ` },
      { text: `${fmtPct(mc.irrP10Pct)} (P10) e ${fmtPct(mc.irrP90Pct)} (P90)`, font: "semibold" },
      { text: `, com mediana de ${fmtPct(mc.irrP50Pct)}. Chance de TIR abaixo do CDI: ` },
      { text: fmtPct(mc.probIrrBelowCdiPct), font: "semibold", color: mc.probIrrBelowCdiPct > 20 ? C.redStrong : C.navy },
      { text: "." },
    ]);
  }
  for (const d of drivers) {
    const lo = Math.min(d.irrLowPct, d.irrHighPct);
    const hi = Math.max(d.irrLowPct, d.irrHighPct);
    body.push([
      { text: `${d.variable}: `, font: "semibold" },
      { text: `${d.lowLabel} / ${d.highLabel} leva a TIR para ${fmtPct(lo)} a ${fmtPct(hi)}.` },
    ]);
  }
  if (body.length) {
    l.callout(body, { title: "Risco em números", accent: C.navy, bg: C.panel, size: 8, after: 4 });
  }
}

// ─── página 3 ───────────────────────────────────────────────────────────────────────────────

export function renderResumoPlant(ctx: ReportContext): void {
  const { l, a } = ctx;
  const p = a.plant;
  const t = p.tech;
  const g = a.generation;
  l.addPage();
  l.sectionTitle(3, "A usina", { lead: "Dados essenciais do projeto e a energia esperada mês a mês, base de toda a receita distribuída aos cotistas." });
  l.gap(2);
  const tracker = t.mounting === "single-axis";
  l.definitionGrid(
    [
      { label: "Município / UF", value: `${p.location.municipio} / ${p.location.uf} (IBGE ${p.location.ibgeCode})` },
      { label: "Distribuidora", value: `${p.location.distribuidora} · submercado ${p.location.submercado}` },
      { label: "Coordenadas", value: `${fmtDecimalDeg(p.location.lat)}, ${fmtDecimalDeg(p.location.lon)}  (${fmtDMS(p.location.lat, "lat")}, ${fmtDMS(p.location.lon, "lon")})` },
      { label: "Potência", value: `${fmtNum(t.dcKWp, 0)} kWp (CC) · ${fmtNum(t.acKW, 0)} kW (CA)` },
      {
        label: "Estrutura",
        value: tracker ? `Seguidor solar de 1 eixo, rotação ±${fmtNum(t.trackerMaxAngleDeg ?? 55, 0)}°` : `Fixa, inclinação de ${fmtNum(t.tiltDeg, 0)}° voltada ao ${t.azimuthDeg === 0 ? "Norte" : `azimute ${fmtNum(t.azimuthDeg, 0)}°`}`,
      },
      { label: "Módulos", value: `${fmtNum(t.module.count, 0)} × ${t.module.model}` },
      { label: "Inversores", value: `${fmtNum(t.inverter.count, 0)} × ${t.inverter.model}` },
      { label: "Comissionamento", value: `${fmtDate(t.commissioning)} · ${STATUS_LABEL[p.status] ?? p.status}` },
      { label: "Fio B (Lei 14.300/2022)", value: fioBShortText(a) },
      { label: "Área", value: `${fmtNum(t.landAreaHa, 1)} ha de terreno` },
    ],
    { cols: 2, after: 20, valueSize: 9 },
  );

  // ── geração mensal ──
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const p50 = months.map((_, i) => g.monthly.find((m) => m.month === i)?.energyMWh ?? NaN);
  const ratio90 = g.annualP50MWh > 0 ? g.p90MWh / g.annualP50MWh : NaN;
  l.subTitle("Geração esperada por mês (ano 1)", { minSpace: 200, right: "MWh" });
  const chartH = 196;
  l.ensure(chartH + 4);
  barChart(l, { x: l.x0, y: l.y, w: l.width, h: chartH }, {
    categories: months,
    series: [{ name: "P50 (esperada)", values: p50, color: C.amber }],
    markers: Number.isFinite(ratio90) ? [{ name: "P90 (conservadora)", values: p50.map((v) => v * ratio90), color: C.navy }] : [],
    yFormat: (v) => fmtNum(v, 0),
    valueLabels: (v) => fmtNum(v, 0),
    legend: true,
    yMin: 0,
    barRatio: 0.62,
  });
  l.y += chartH + 18;

  const xc = crossCheckDeviation(a);
  l.tiles(
    [
      { label: "Yield específico", value: `${fmtNum(g.specificYieldKWhPerKWp, 0)} kWh/kWp`, sub: "Energia por kWp instalado, por ano" },
      { label: "Performance ratio", value: fmtPct(g.performanceRatioPct), sub: "Eficiência global do sistema" },
      { label: "Geração P90", value: `${fmtNum(g.p90MWh, 0)} MWh/ano`, sub: `${fmtPctSigned(((g.p90MWh - g.annualP50MWh) / g.annualP50MWh) * 100)} vs. P50 · 90 % de chance` },
      xc
        ? { label: "Desvio vs. PVGIS", value: fmtPctSigned(xc.deviationPct), sub: "Validação independente (JRC/UE)", valueColor: Math.abs(xc.deviationPct) <= 5 ? C.green : C.amberDark }
        : { label: "Desvio vs. PVGIS", value: "—", sub: "Validação indisponível nesta emissão", valueColor: C.muted },
    ],
    { cols: 4, height: 62, gap: 8, valueSize: 16, after: 22 },
  );

  l.subTitle("Como a geração foi estimada", { minSpace: 70 });
  const u = g.uncertainty;
  l.paragraph(
    `A geração é simulada mês a mês a partir da irradiação solar medida por satélite (NASA POWER, média de 20 anos), levada ao plano dos módulos e descontadas as perdas de temperatura, sujeira, cabos, inversor e indisponibilidade (performance ratio de ${fmtPct(g.performanceRatioPct)}). ` +
      `O P90 considera incerteza combinada de ${fmtPct(u.totalPct)} (variabilidade do sol entre anos, dados de satélite e modelo). ` +
      (xc ? `Uma estimativa independente do PVGIS (Comissão Europeia) difere ${fmtPctSigned(xc.deviationPct)} da nossa. ` : "") +
      "A versão completa deste relatório detalha clima, perdas e incertezas.",
    { size: 8.8, color: C.text, lineHeight: 1.55 },
  );
}

// ─── página 4 ───────────────────────────────────────────────────────────────────────────────

export function renderResumoToken(ctx: ReportContext): void {
  const { l, a } = ctx;
  const tk = a.plant.token;
  const oc = ctx.onChain;
  const chainId = oc?.chainId ?? tk.chainId;
  l.addPage();
  l.sectionTitle(4, "Tokenização, fontes e avisos", { lead: "Como a cota funciona na blockchain, de onde vêm os dados e o que você precisa saber antes de investir." });
  l.gap(2);
  l.definitionGrid(
    [
      { label: "Token", value: `${tk.name} (${tk.symbol})` },
      { label: "Rede", value: chainLabel(chainId) },
      { label: "Preço da cota", value: `${fmtBRL(tk.cotaPriceBRL)} · ${fmtNum(tk.cotaPriceUSDT, 2)} USDT` },
      { label: "Total de cotas", value: `${fmtNum(tk.totalCotas, 0)} (${fmtBRLCompact(tk.totalCotas * tk.cotaPriceBRL)})` },
      { label: "Investimento mínimo", value: `${fmtNum(tk.minCotas, 0)} cotas (${fmtBRL(tk.minCotas * tk.cotaPriceBRL, 0)})` },
      { label: "Meta mínima (soft cap)", value: `${fmtNum(tk.softCapCotas, 0)} cotas; abaixo disso, reembolso` },
      { label: "Período da oferta", value: tk.offeringStart || tk.offeringEnd ? `${fmtDate(tk.offeringStart)} a ${fmtDate(tk.offeringEnd)}` : "A definir" },
      { label: "Pagamento", value: "USDT (BEP-20) em escrow no contrato" },
      { label: "Distribuição", value: "Receita líquida em USDT, pro-rata; saque quando quiser" },
    ],
    { cols: 3, after: 6 },
  );

  const tokenAddr = oc?.tokenAddress ?? tk.tokenAddress;
  const offeringAddr = oc?.offeringAddress ?? tk.offeringAddress;
  const addrRows: Cell[][] = [];
  for (const [label, addr] of [
    ["Contrato do token", tokenAddr],
    ["Contrato da oferta", offeringAddr],
  ] as [string, string | undefined][]) {
    if (!addr) continue;
    const url = addressUrl(chainId, addr);
    addrRows.push([
      { text: label, font: "semibold" },
      { text: addr, font: "mono", size: 7 },
      url ? { text: "Ver na BscScan ↗", color: C.sky, font: "semibold", link: url } : "—",
    ]);
  }
  if (addrRows.length) {
    l.table({ columns: [{ header: "", width: 1.3 }, { header: "", width: 3.6 }, { header: "", width: 1.2 }], rows: addrRows, noHeader: true, size: 7.4, zebra: false, after: 4 });
  } else {
    l.caption("Contratos ainda não implantados: endereços e estado da oferta passam a constar do relatório após o deploy.", { after: 4 });
  }
  if (oc) {
    const sold = toCotas(oc.cotasSold, tk.totalCotas);
    const max = toCotas(oc.maxSupply, tk.totalCotas) || tk.totalCotas;
    const raised = fromUnits(oc.raisedUSDT, USDT_DECIMALS);
    l.rich(
      [
        { text: "Oferta on-chain: ", font: "semibold", color: C.navy },
        { text: `${OFFERING_STATE_LABEL[oc.offeringState] ?? oc.offeringState} · ${fmtNum(sold, 0)} cotas vendidas (${fmtPct(max > 0 ? (sold / max) * 100 : NaN)}) · ${fmtNum(raised, 0)} USDT captados · leitura em ${fmtDateTime(ctx.now, true)}.` },
      ],
      { size: 7.8, color: C.text, after: 4 },
    );
  }
  l.gap(8);

  // ── fontes ──
  const prov = allProvenance(a);
  if (prov.length) {
    l.subTitle("Fontes de dados", { minSpace: 80, right: statusSummary(prov) });
    const rows: Cell[][] = [];
    for (let i = 0; i < prov.length; i += 2) {
      const row: Cell[] = [];
      for (const pv of [prov[i], prov[i + 1]]) {
        if (!pv) {
          row.push("", "");
          continue;
        }
        const st = statusColors(pv.status);
        row.push({ text: pv.name, truncate: true, size: 7 }, { text: st.label, chip: { fg: st.fg, bg: st.bg }, align: "center" });
      }
      rows.push(row);
    }
    l.table({
      columns: [
        { header: "", width: 3.3 },
        { header: "", width: 0.95, align: "center" },
        { header: "", width: 3.3 },
        { header: "", width: 0.95, align: "center" },
      ],
      rows,
      noHeader: true,
      size: 7,
      padY: 2.6,
      after: 3,
    });
    l.caption("Endereços consultados, horários e observações de cada fonte constam da versão completa do relatório.", { after: 10 });
  }

  // ── avisos ──
  const items: Run[][] = [];
  if (a.plant.illustrative) items.push([{ text: ILLUSTRATIVE_TEXT, font: "semibold", color: C.amberDark }]);
  items.push(
    [{ text: "Não é recomendação de investimento: ", font: "semibold" }, { text: "documento informativo; não constitui oferta nem consultoria." }],
    [{ text: "Projeções não são garantia: ", font: "semibold" }, { text: "rentabilidade projetada ou passada não garante resultados futuros; há risco de perda do capital." }],
    [
      { text: "CVM: ", font: "semibold" },
      { text: "ofertas públicas exigem registro ou dispensa na CVM; crowdfunding segue a Resolução CVM 88/2022, por plataforma ou intermediário autorizado pela CVM." },
    ],
    [{ text: "Tributação: ", font: "semibold" }, { text: "valores por cota são brutos; confirme o tratamento tributário com seu contador." }],
    [{ text: "Ativos digitais: ", font: "semibold" }, { text: "dependem de contratos inteligentes, da rede, de stablecoins e da guarda das suas chaves; a liquidez das cotas é restrita." }],
  );
  l.callout(items, { title: "AVISOS LEGAIS", accent: C.navy, bg: C.panel, size: 7.4, after: 10 });

  // ── como verificar ──
  const hash = (a.dataHash || "").replace(/^0x/, "").toLowerCase();
  const verify = `${ctx.siteUrl}/verificar`;
  l.subTitle("Como verificar este relatório", { minSpace: 70 });
  l.bullets(
    [
      [{ text: `Abra ${displayUrl(verify)} e envie este PDF: o site confere o hash com o registro de documentos do contrato do token.` }],
      [{ text: `O arquivo anexo ${ctx.attachmentName} contém os dados da análise; o SHA-256 dele deve ser igual a:` }],
    ],
    { size: 7.8, gap: 2 },
  );
  l.ensure(16);
  l.text(hash || "—", l.x0 + 10, l.y + 9, { font: "mono", size: 8, color: C.navy, width: l.width - 10, truncate: true });
  l.link(l.x0, l.y, l.width, 12, verify);
  l.y += 16;
}
