import type { ReportContext } from "../context";
import { MODALIDADE_LABEL, STATUS_LABEL, addressUrl, allProvenance, chainLabel } from "../context";
import { displayUrl, fmtBRL, fmtBRLCompact, fmtDateTime, fmtMultiple, fmtNum, fmtPct, fmtYears, groupHex, truncateMiddle } from "../format";
import { verdictItems } from "../insights";
import { Layout } from "../layout";
import { C, PAGE, SIZE } from "../theme";

export const ILLUSTRATIVE_TEXT =
  "Projeto ilustrativo: dados de engenharia e financeiros hipotéticos; recurso solar e dados do local obtidos de fontes públicas.";

const HERO_H = 214;

export function renderCover(ctx: ReportContext): void {
  const { l, a } = ctx;
  const p = a.plant;
  const f = a.finance;
  const g = a.generation;
  l.addPage();

  // ── hero ──
  l.rect(0, 0, PAGE.width, HERO_H, { fill: C.navy });
  l.rect(0, HERO_H, PAGE.width, 2.2, { fill: C.amber });
  const x = PAGE.marginX;
  const qrBox = 104;
  const textW = PAGE.width - 2 * PAGE.marginX - qrBox - 24;

  l.text("RELATÓRIO DE AUDITORIA TÉCNICA E ECONÔMICA", x, 56, { font: "semibold", size: 7.6, color: C.amber });
  let nameSize = 25;
  while (nameSize > 15 && l.textWidth(p.name, "bold", nameSize) > textW) nameSize -= 1;
  l.text(p.name, x, 56 + 10 + nameSize, { font: "bold", size: nameSize, color: C.white });
  let y = 56 + 10 + nameSize + 16;
  l.text(
    `${p.location.municipio} / ${p.location.uf}  ·  ${p.location.distribuidora}  ·  Submercado ${p.location.submercado}`,
    x,
    y,
    { size: 9, color: C.heroText, width: textW, truncate: true },
  );
  y += 7;
  const tagLines = l.wrap(p.tagline, "regular", 8, textW).slice(0, 2);
  for (const ln of tagLines) {
    y += 11;
    l.text(ln, x, y, { size: 8, color: C.headerMuted });
  }

  // chips
  y += 13;
  let cx = x;
  cx += l.chip((STATUS_LABEL[p.status] ?? p.status).toUpperCase(), cx, y, C.navy, C.amber, 6.8) + 5;
  cx += l.chip((MODALIDADE_LABEL[p.tech.modalidade] ?? p.tech.modalidade).toUpperCase(), cx, y, C.white, C.navy2, 6.8) + 5;
  l.chip(p.token.chainId === 56 ? "BNB SMART CHAIN" : "BNB SMART CHAIN TESTNET", cx, y, C.white, C.navy2, 6.8);

  l.text(
    `Data-base dos dados: ${fmtDateTime(a.generatedAt, true)}   ·   Relatório ${ctx.reportId}`,
    x,
    HERO_H - 16,
    { size: 6.8, color: C.headerMuted, width: textW + 40, truncate: true },
  );

  // QR code
  const qx = PAGE.width - PAGE.marginX - qrBox;
  const qy = 46;
  l.roundRect(qx, qy, qrBox, qrBox, 5, { fill: C.white });
  if (ctx.qr) l.image(ctx.qr, qx + 7, qy + 7, qrBox - 14, qrBox - 14);
  l.link(qx, qy, qrBox, qrBox, ctx.plantUrl);
  l.text("Página da usina (dados ao vivo)", qx - 10, qy + qrBox + 12, { font: "semibold", size: 6.6, color: C.heroText, align: "center", width: qrBox + 20 });
  const urlLines = l.wrap(displayUrl(ctx.plantUrl), "regular", 6.2, qrBox + 30).slice(0, 2);
  urlLines.forEach((ln, i) => {
    l.text(ln, qx - 15, qy + qrBox + 22 + i * 8, { size: 6.2, color: C.amber, align: "center", width: qrBox + 30 });
  });
  l.link(qx - 15, qy + qrBox + 15, qrBox + 30, urlLines.length * 8 + 4, ctx.plantUrl);

  l.y = HERO_H + 14;

  // ── aviso de projeto ilustrativo ──
  if (p.illustrative) {
    l.callout(
      [[{ text: ILLUSTRATIVE_TEXT, font: "semibold" }, { text: " Os valores demonstram a metodologia da plataforma e não constituem oferta de investimento." }]],
      { title: "PROJETO ILUSTRATIVO", accent: C.amber, bg: C.amberSoft, titleColor: C.amberDark, size: 8, after: 4 },
    );
  }

  // ── KPIs ──
  l.sectionTitle(1, "Sumário executivo", { minSpace: 120 });
  const kpis = [
    { label: "Potência instalada", value: `${fmtNum(p.tech.dcKWp, 0)} kWp`, sub: `${fmtNum(p.tech.acKW, 0)} kWac · CC/CA ${fmtNum(p.tech.dcKWp / p.tech.acKW, 2)}` },
    { label: "Geração P50 (ano 1)", value: `${fmtNum(g.annualP50MWh, 0)} MWh/ano`, sub: `P90: ${fmtNum(g.p90MWh, 0)} MWh/ano` },
    { label: "Yield específico", value: `${fmtNum(g.specificYieldKWhPerKWp, 0)} kWh/kWp`, sub: `PR ${fmtPct(g.performanceRatioPct)} · FC ${fmtPct(g.capacityFactorPct)}` },
    { label: "CO₂ evitado", value: `${fmtNum(g.co2AvoidedTonsYear, 0)} t/ano`, sub: "Fator médio de emissão do SIN", accent: C.green },
    { label: "TIR nominal (P50)", value: `${fmtPct(f.irrNominalPct)} a.a.`, sub: `TIR real: ${fmtPct(f.irrRealPct)} a.a.`, accent: C.navy, valueColor: f.irrNominalPct >= 0 ? C.green : C.redStrong },
    { label: "VPL", value: fmtBRLCompact(f.npvBRL), sub: `Taxa de desconto ${fmtPct(f.discountRatePct)} a.a.`, accent: C.navy, valueColor: f.npvBRL >= 0 ? C.navy : C.redStrong },
    { label: "Payback simples", value: fmtYears(f.paybackYears), sub: `Descontado: ${fmtYears(f.discountedPaybackYears)}`, accent: C.navy },
    { label: "Múltiplo (MOIC)", value: fmtMultiple(f.moic), sub: `LCOE ${fmtBRL(f.lcoeBRLPerMWh, 0)}/MWh`, accent: C.navy },
    { label: "Preço da cota", value: fmtBRL(p.token.cotaPriceBRL), sub: `${fmtNum(p.token.cotaPriceUSDT, 2)} USDT · mínimo ${fmtNum(p.token.minCotas, 0)} cotas`, accent: C.amberDark },
    { label: "Renda por cota / mês", value: fmtBRL(f.perCota.avgMonthlyIncomeBRL), sub: `Média no horizonte · ano 1: ${fmtBRL(f.perCota.firstYearIncomeBRL / 12)}`, accent: C.amberDark, valueColor: C.green },
    { label: "Captação total", value: fmtBRLCompact(f.investmentBRL), sub: `${fmtNum(p.token.totalCotas, 0)} cotas · soft cap ${fmtNum(p.token.softCapCotas, 0)}`, accent: C.amberDark },
    { label: "Yield ano 1", value: fmtPct(f.firstYearYieldPct), sub: `Média: ${fmtPct(f.avgYieldPct)} a.a. sobre o aporte`, accent: C.amberDark },
  ];
  l.tiles(kpis, { cols: 4, height: 47, gap: 6, after: 6 });

  // ── síntese ──
  l.subTitle("Síntese da auditoria", { minSpace: 90 });
  l.bullets(verdictItems(a, allProvenance(a)), { size: 8.2, gap: 1.6, after: 4, lineHeight: 1.34 });

  renderIntegrityBox(ctx);
}

/** Caixa de integridade: hash completo, anexo e estado do registro on-chain. */
export function renderIntegrityBox(ctx: ReportContext): void {
  const { l, a } = ctx;
  const hash = (a.dataHash || "").replace(/^0x/, "").toLowerCase();
  const groups = groupHex(hash);
  const hashLines = [groups.slice(0, 4).join(" "), groups.slice(4).join(" ")].filter((s) => s.length > 0);
  const pad = 10;
  const x = l.x0;
  const w = l.width;
  const leftW = w * 0.5;
  const rightX = x + leftW + 12;
  const rightW = w - leftW - 12 - pad;
  const size = 7.3;
  const lh = size * 1.35;

  const explain = `O JSON anexado a este PDF (${ctx.attachmentName}) reproduz o hash SHA-256 acima; a página /verificar do site confere o PDF contra o registro on-chain.`;
  const explainLines = l.wrapRuns([{ text: explain }], size, leftW - pad - 4);

  // estado on-chain
  const oc = ctx.onChain;
  const chainId = oc?.chainId ?? a.plant.token.chainId;
  const tokenAddr = oc?.tokenAddress ?? a.plant.token.tokenAddress;
  const match = oc?.documents.find((d) => d.hash.replace(/^0x/, "").toLowerCase() === hash);
  let chip: { text: string; fg: typeof C.green; bg: typeof C.green };
  let status: string;
  if (oc && match) {
    chip = { text: "HASH REGISTRADO ON-CHAIN", fg: C.green, bg: C.greenSoft };
    status = `Registrado em ${fmtDateTime(match.timestamp * 1000, true)} no registro de documentos do contrato do token (${chainLabel(chainId)}), documento "${match.name}".`;
  } else if (oc) {
    chip = { text: "HASH AINDA NÃO REGISTRADO", fg: C.amberDark, bg: C.amberSoft };
    status = `O registro de documentos do contrato do token (${chainLabel(chainId)}) não continha este hash na emissão; ${oc.documents.length} documento(s) registrado(s).`;
  } else {
    chip = { text: "ON-CHAIN NÃO CONSULTADO", fg: C.muted, bg: C.border };
    status = tokenAddr
      ? `Confira o registro de documentos do contrato do token na ${chainLabel(chainId)} pelo explorador BscScan.`
      : "Contrato do token ainda não implantado; o hash será ancorado no registro de documentos do contrato após o deploy.";
  }
  const statusLines = l.wrapRuns([{ text: status }], size, rightW);
  const verifyUrl = `${ctx.siteUrl}/verificar`;
  const addrLine = tokenAddr ? `Contrato: ${truncateMiddle(tokenAddr, 26)}` : null;

  const leftH = 14 + hashLines.length * 11 + 4 + explainLines.length * lh;
  const rightH = 14 + 14 + statusLines.length * lh + (addrLine ? lh + 2 : 0) + lh + 2;
  const h = pad * 2 + Math.max(leftH, rightH);
  l.ensure(h + 4);
  const top = l.y + 2;
  l.rect(x, top, w, h, { fill: C.panel });
  l.rect(x, top, 3, h, { fill: C.navy });

  // esquerda
  let cy = top + pad + 8;
  l.text("INTEGRIDADE DOS DADOS — SHA-256 (dataHash)", x + pad + 3, cy, { font: "semibold", size: 6.8, color: C.navy });
  cy += 6;
  for (const hl of hashLines) {
    cy += 11;
    l.text(hl, x + pad + 3, cy, { font: "mono", size: 8.2, color: C.text });
  }
  cy += 6;
  for (const ln of explainLines) {
    l.drawLine(ln, x + pad + 3, Layout.baseline(cy, lh, size), size, C.muted);
    cy += lh;
  }

  // direita
  l.line(rightX - 6, top + pad, rightX - 6, top + h - pad, { color: C.border, width: 0.7 });
  let ry = top + pad + 8;
  l.text("ANCORAGEM ON-CHAIN", rightX, ry, { font: "semibold", size: 6.8, color: C.navy });
  ry += 5;
  l.chip(chip.text, rightX, ry, chip.fg, chip.bg, 6.4);
  ry += 15;
  for (const ln of statusLines) {
    l.drawLine(ln, rightX, Layout.baseline(ry, lh, size), size, C.text);
    ry += lh;
  }
  if (addrLine && tokenAddr) {
    l.text(addrLine, rightX, Layout.baseline(ry, lh, size), { font: "mono", size: size - 0.6, color: C.navy });
    const url = addressUrl(chainId, tokenAddr);
    if (url) l.link(rightX, ry, rightW, lh, url);
    ry += lh + 2;
  }
  l.text(`Verificação: ${displayUrl(verifyUrl)}`, rightX, Layout.baseline(ry, lh, size), {
    font: "semibold",
    size,
    color: C.sky,
    width: rightW,
    truncate: true,
  });
  l.link(rightX, ry, rightW, lh, verifyUrl);
  l.y = top + h + 6;
  void SIZE;
}
