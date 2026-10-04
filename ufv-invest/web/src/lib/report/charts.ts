/**
 * Gráficos vetoriais desenhados com primitivas do pdf-lib (via Layout): barras (agrupadas, com
 * marcadores e linhas sobrepostas), histograma, tornado e barras horizontais.
 */
import type { RGB } from "pdf-lib";
import { Layout } from "./layout";
import { C } from "./theme";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const AXIS_SIZE = 6.4;

/** Escala "bonita" (passos 1/2/2,5/5 × 10^n) cobrindo [min, max]. */
export function niceScale(min: number, max: number, maxTicks = 5): { min: number; max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rough = span / Math.max(1, maxTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  const nMin = Math.floor(min / step + 1e-9) * step;
  const nMax = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = nMin; v <= nMax + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return { min: nMin, max: nMax, step, ticks };
}

export interface LegendItem {
  label: string;
  color: RGB;
  kind: "box" | "line" | "tick" | "dash";
}

/** Legenda horizontal alinhada à direita, topo em y. */
export function legend(l: Layout, items: LegendItem[], right: number, y: number): void {
  const size = 6.6;
  let x = right;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const tw = l.textWidth(it.label, "regular", size);
    x -= tw;
    l.text(it.label, x, y + 6, { size, color: C.muted });
    x -= 12;
    if (it.kind === "box") l.rect(x, y + 1.2, 8, 6, { fill: it.color });
    else if (it.kind === "tick") l.line(x, y + 4.2, x + 8, y + 4.2, { color: it.color, width: 1.8 });
    else l.line(x, y + 4.2, x + 8, y + 4.2, { color: it.color, width: 1.2, dash: it.kind === "dash" ? [2, 1.5] : undefined });
    x -= 10;
  }
}

export interface BarSeries {
  name: string;
  values: number[];
  color: RGB;
  colorFn?: (v: number, i: number) => RGB;
}

export interface BarChartSpec {
  categories: string[];
  series: BarSeries[];
  /** traço horizontal sobre cada categoria (ex.: P90) */
  markers?: { name: string; values: number[]; color: RGB }[];
  /** linhas no mesmo eixo */
  lines?: { name: string; values: number[]; color: RGB; dash?: number[]; dots?: boolean; width?: number }[];
  /** faixa horizontal sombreada (ex.: ±1σ) */
  band?: { from: number; to: number; color: RGB; label?: string };
  yFormat: (v: number) => string;
  yTitle?: string;
  valueLabels?: (v: number) => string;
  labelEvery?: number;
  legend?: boolean;
  yMin?: number;
  yMax?: number;
  barRatio?: number;
  maxTicks?: number;
}

export function barChart(l: Layout, r: Rect, spec: BarChartSpec): void {
  const n = spec.categories.length;
  if (n === 0) return;
  const all: number[] = [];
  spec.series.forEach((s) => all.push(...s.values.filter(Number.isFinite)));
  spec.markers?.forEach((m) => all.push(...m.values.filter(Number.isFinite)));
  spec.lines?.forEach((m) => all.push(...m.values.filter(Number.isFinite)));
  if (spec.band) all.push(spec.band.from, spec.band.to);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (spec.yMin !== undefined) lo = spec.yMin;
  if (spec.yMax !== undefined) hi = Math.max(hi, spec.yMax);
  if (spec.valueLabels) hi += (hi - lo) * 0.08;
  const sc = niceScale(lo, hi, spec.maxTicks ?? 5);
  if (spec.yMin !== undefined) sc.ticks = sc.ticks.filter((t) => t >= spec.yMin!);
  const yMinV = spec.yMin !== undefined ? Math.max(sc.min, spec.yMin) : sc.min;

  const legendH = spec.legend ? 13 : 2;
  const titleH = spec.yTitle ? 0 : 0;
  const yLabelW = Math.max(...sc.ticks.map((t) => l.textWidth(spec.yFormat(t), "regular", AXIS_SIZE))) + 5;
  const px = r.x + yLabelW;
  const pw = r.w - yLabelW - 2;
  const py = r.y + legendH + titleH + 2;
  const ph = r.h - legendH - titleH - 2 - 13;
  const Y = (v: number) => py + ph - ((v - yMinV) / (sc.max - yMinV)) * ph;

  if (spec.yTitle) l.text(spec.yTitle, r.x, r.y + 6, { size: AXIS_SIZE, color: C.muted });
  if (spec.legend) {
    const items: LegendItem[] = [
      ...spec.series.map((s) => ({ label: s.name, color: s.color, kind: "box" as const })),
      ...(spec.markers ?? []).map((m) => ({ label: m.name, color: m.color, kind: "tick" as const })),
      ...(spec.lines ?? []).map((m) => ({ label: m.name, color: m.color, kind: m.dash ? ("dash" as const) : ("line" as const) })),
    ];
    if (spec.band?.label) items.push({ label: spec.band.label, color: spec.band.color, kind: "box" });
    legend(l, items, r.x + r.w, r.y);
  }

  // grade e rótulos do eixo Y
  for (const t of sc.ticks) {
    const ty = Y(t);
    l.line(px, ty, px + pw, ty, { color: t === 0 ? C.subtle : C.border, width: t === 0 ? 0.7 : 0.45 });
    l.text(spec.yFormat(t), r.x, ty + AXIS_SIZE * 0.35, { size: AXIS_SIZE, color: C.muted, align: "right", width: yLabelW - 4 });
  }
  if (spec.band) {
    const b0 = Y(spec.band.to);
    const b1 = Y(spec.band.from);
    l.rect(px, b0, pw, b1 - b0, { fill: spec.band.color, opacity: 0.55 });
  }

  const slot = pw / n;
  const groupW = slot * (spec.barRatio ?? 0.68);
  const ns = spec.series.length;
  const barW = groupW / Math.max(1, ns);
  const every = spec.labelEvery ?? 1;
  const zeroY = Y(Math.max(yMinV, 0));

  for (let i = 0; i < n; i++) {
    const gx = px + i * slot + (slot - groupW) / 2;
    spec.series.forEach((s, si) => {
      const v = s.values[i];
      if (!Number.isFinite(v)) return;
      const bx = gx + si * barW;
      const vy = Y(v);
      const top = Math.min(vy, zeroY);
      const h = Math.abs(zeroY - vy);
      l.rect(bx + (ns > 1 ? 0.4 : 0), top, barW - (ns > 1 ? 0.8 : 0), Math.max(h, 0.4), { fill: s.colorFn ? s.colorFn(v, i) : s.color });
      if (spec.valueLabels && ns === 1) {
        const label = spec.valueLabels(v);
        const tw = l.textWidth(label, "regular", 5.8);
        if (tw <= slot + 2) {
          const ly = v >= 0 ? vy - 2.5 : vy + 7.5;
          l.text(label, bx + barW / 2 - tw / 2, ly, { size: 5.8, color: C.muted });
        }
      }
    });
    if (i % every === 0 || i === n - 1) {
      if (i === n - 1 && i % every !== 0 && (i % every) < every / 2) {
        // evita rótulos colados no fim
      } else {
        l.text(spec.categories[i], px + i * slot, py + ph + 9, { size: AXIS_SIZE, color: C.muted, align: "center", width: slot });
      }
    }
  }

  spec.markers?.forEach((m) => {
    m.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const cx = px + i * slot + slot / 2;
      const half = Math.min(groupW / 2 + 2, slot / 2 - 1);
      l.line(cx - half, Y(v), cx + half, Y(v), { color: m.color, width: 1.6 });
    });
  });

  spec.lines?.forEach((ln) => {
    const pts: [number, number][] = [];
    ln.values.forEach((v, i) => {
      if (Number.isFinite(v)) pts.push([px + i * slot + slot / 2, Y(v)]);
    });
    l.polyline(pts, { color: ln.color, width: ln.width ?? 1.2, dash: ln.dash });
    if (ln.dots) pts.forEach(([cx, cy]) => l.circle(cx, cy, 1.5, { fill: ln.color }));
  });

  // eixo base
  l.line(px, py + ph, px + pw, py + ph, { color: C.subtle, width: 0.6 });
}

export interface HistogramSpec {
  bins: { fromPct: number; toPct: number; count: number }[];
  markers: { value: number; label: string; color: RGB; dash?: boolean }[];
  xFormat: (v: number) => string;
  colorFn?: (bin: { fromPct: number; toPct: number; count: number }) => RGB;
  yTitle?: string;
  legendItems?: LegendItem[];
}

export function histogram(l: Layout, r: Rect, spec: HistogramSpec): void {
  const bins = spec.bins.filter((b) => Number.isFinite(b.fromPct) && Number.isFinite(b.toPct));
  if (bins.length === 0) return;
  const total = bins.reduce((s, b) => s + b.count, 0) || 1;
  const freq = bins.map((b) => (b.count / total) * 100);
  const xMin = Math.min(bins[0].fromPct, ...spec.markers.map((m) => m.value));
  const xMax = Math.max(bins[bins.length - 1].toPct, ...spec.markers.map((m) => m.value));
  const xs = niceScale(xMin, xMax, 8);
  const ys = niceScale(0, Math.max(...freq) * 1.12, 4);
  const yFmt = (v: number) => `${v.toFixed(v < 1 && v > 0 ? 1 : 0).replace(".", ",")} %`;
  const yLabelW = Math.max(...ys.ticks.map((t) => l.textWidth(yFmt(t), "regular", AXIS_SIZE))) + 5;
  const legendH = spec.legendItems ? 13 : 0;
  const markerH = 20;
  const px = r.x + yLabelW;
  const pw = r.w - yLabelW - 4;
  const py = r.y + legendH + markerH;
  const ph = r.h - legendH - markerH - 14;
  const X = (v: number) => px + ((v - xs.min) / (xs.max - xs.min)) * pw;
  const Y = (v: number) => py + ph - (v / ys.max) * ph;

  if (spec.legendItems) legend(l, spec.legendItems, r.x + r.w, r.y);
  if (spec.yTitle) l.text(spec.yTitle, r.x, r.y + legendH + 6, { size: AXIS_SIZE, color: C.muted });

  for (const t of ys.ticks) {
    l.line(px, Y(t), px + pw, Y(t), { color: t === 0 ? C.subtle : C.border, width: t === 0 ? 0.7 : 0.45 });
    l.text(yFmt(t), r.x, Y(t) + AXIS_SIZE * 0.35, { size: AXIS_SIZE, color: C.muted, align: "right", width: yLabelW - 4 });
  }
  bins.forEach((b, i) => {
    const x0 = X(b.fromPct);
    const x1 = X(b.toPct);
    const top = Y(freq[i]);
    l.rect(x0 + 0.3, top, Math.max(0.5, x1 - x0 - 0.6), py + ph - top, { fill: spec.colorFn ? spec.colorFn(b) : C.amber });
  });
  for (const t of xs.ticks) {
    l.line(X(t), py + ph, X(t), py + ph + 2.5, { color: C.subtle, width: 0.5 });
    l.text(spec.xFormat(t), X(t) - 20, py + ph + 10, { size: AXIS_SIZE, color: C.muted, align: "center", width: 40 });
  }
  l.line(px, py + ph, px + pw, py + ph, { color: C.subtle, width: 0.6 });

  // marcadores verticais com rótulos escalonados para não colidir
  const sorted = [...spec.markers].sort((a, b) => a.value - b.value);
  const placed: { x0: number; x1: number; row: number }[] = [];
  for (const m of sorted) {
    const mx = X(m.value);
    l.line(mx, py - 2, mx, py + ph, { color: m.color, width: 0.9, dash: m.dash ? [2.5, 1.8] : undefined });
    const tw = l.textWidth(m.label, "semibold", 6.2);
    let lx = mx - tw / 2;
    lx = Math.max(r.x, Math.min(lx, r.x + r.w - tw));
    let row = 0;
    while (placed.some((p) => p.row === row && !(lx > p.x1 + 3 || lx + tw < p.x0 - 3))) row++;
    placed.push({ x0: lx, x1: lx + tw, row });
    l.text(m.label, lx, py - 5 - row * 8.5, { font: "semibold", size: 6.2, color: m.color });
  }
}

export interface TornadoRow {
  label: string;
  sub?: string;
  low: number;
  high: number;
  lowLabel?: string;
  highLabel?: string;
}

export function tornado(
  l: Layout,
  r: Rect,
  spec: { rows: TornadoRow[]; base: number; format: (v: number) => string; baseLabel: string; downColor?: RGB; upColor?: RGB },
): void {
  const rows = spec.rows;
  if (rows.length === 0) return;
  const labelW = 150;
  const vals = rows.flatMap((x) => [x.low, x.high]).concat(spec.base).filter(Number.isFinite);
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const vMin = Math.min(...vals) - span * 0.22;
  const vMax = Math.max(...vals) + span * 0.22;
  const px = r.x + labelW;
  const pw = r.w - labelW;
  const top = r.y + 14;
  const rowH = (r.h - 14 - 14) / rows.length;
  const X = (v: number) => px + ((v - vMin) / (vMax - vMin)) * pw;
  const down = spec.downColor ?? C.red;
  const up = spec.upColor ?? C.green;

  rows.forEach((_, i) => {
    if (i % 2 === 1) l.rect(r.x - 2, top + i * rowH, r.w + 2, rowH, { fill: C.zebra });
  });
  const sc = niceScale(vMin, vMax, 6);
  for (const t of sc.ticks) {
    if (t < vMin || t > vMax) continue;
    l.line(X(t), top - 2, X(t), top + rowH * rows.length, { color: C.border, width: 0.45 });
    l.text(spec.format(t), X(t) - 20, top + rowH * rows.length + 9, { size: AXIS_SIZE, color: C.muted, align: "center", width: 40 });
  }

  rows.forEach((row, i) => {
    const ry = top + i * rowH;
    const barH = Math.min(11, rowH * 0.56);
    const by = ry + (rowH - barH) / 2;
    const subSize = 6.2;
    const hasSub = !!row.sub;
    const labelBl = ry + rowH / 2 + (hasSub ? -1 : 2.6);
    l.text(row.label, r.x, labelBl, { font: "semibold", size: 7.4, color: C.text, width: labelW - 8, truncate: true });
    if (hasSub) l.text(row.sub!, r.x, labelBl + 8, { size: subSize, color: C.muted, width: labelW - 8, truncate: true });
    for (const [v, lbl] of [
      [row.low, row.lowLabel],
      [row.high, row.highLabel],
    ] as [number, string | undefined][]) {
      if (!Number.isFinite(v)) continue;
      const x0 = Math.min(X(spec.base), X(v));
      const x1 = Math.max(X(spec.base), X(v));
      const color = v < spec.base ? down : up;
      l.rect(x0, by, Math.max(0.8, x1 - x0), barH, { fill: color });
      const text = spec.format(v) + (lbl ? ` (${lbl})` : "");
      const tw = l.textWidth(text, "regular", 6.2);
      const tx = v < spec.base ? x0 - 3 - tw : x1 + 3;
      l.text(text, tx, by + barH / 2 + 2.2, { size: 6.2, color: C.muted });
    }
  });
  const bx = X(spec.base);
  l.line(bx, top - 4, bx, top + rowH * rows.length, { color: C.navy, width: 1 });
  const bl = `${spec.baseLabel}: ${spec.format(spec.base)}`;
  const bw = l.textWidth(bl, "semibold", 6.6);
  l.text(bl, Math.min(Math.max(bx - bw / 2, px), r.x + r.w - bw), top - 6, { font: "semibold", size: 6.6, color: C.navy });
}

/** Barras horizontais com rótulo à esquerda e valor à direita. */
export function hbars(
  l: Layout,
  r: Rect,
  rows: { label: string; sub?: string; value: number; color: RGB; valueLabel: string; bold?: boolean }[],
): void {
  if (rows.length === 0) return;
  const labelW = 170;
  const valueW = 92;
  const px = r.x + labelW;
  const pw = r.w - labelW - valueW;
  const rowH = r.h / rows.length;
  const max = Math.max(...rows.map((x) => x.value), 1);
  rows.forEach((row, i) => {
    const ry = r.y + i * rowH;
    const barH = Math.min(10, rowH * 0.55);
    const hasSub = !!row.sub;
    const bl = ry + rowH / 2 + (hasSub ? -1 : 2.6);
    l.text(row.label, r.x, bl, { font: row.bold ? "bold" : "semibold", size: 7.4, color: C.text, width: labelW - 8, truncate: true });
    if (hasSub) l.text(row.sub!, r.x, bl + 8, { size: 6.2, color: C.muted, width: labelW - 8, truncate: true });
    const w = Math.max(1, (Math.max(0, row.value) / max) * pw);
    l.rect(px, ry + (rowH - barH) / 2, w, barH, { fill: row.color });
    l.text(row.valueLabel, px + w + 5, ry + rowH / 2 + 2.6, { font: row.bold ? "bold" : "semibold", size: 7.4, color: C.navy });
  });
  l.line(px, r.y, px, r.y + r.h, { color: C.subtle, width: 0.6 });
}

/** Mini barra horizontal (para células de tabela) */
export function miniBar(l: Layout, x: number, y: number, w: number, h: number, frac: number, color: RGB, track = C.panel): void {
  l.rect(x, y, w, h, { fill: track });
  l.rect(x, y, Math.max(0, Math.min(1, frac)) * w, h, { fill: color });
}
