/**
 * Motor de layout mínimo sobre pdf-lib: coordenadas de cima para baixo, quebra de texto por
 * medição real das fontes, quebra automática de página, tabelas, blocos e anotações de link.
 */
import { PDFDocument, PDFFont, PDFImage, PDFPage, PDFString, LineCapStyle, type RGB } from "pdf-lib";
import { C, PAGE, SIZE } from "./theme";

export interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}
export type FontKey = keyof Fonts;
export type Align = "left" | "right" | "center";

export interface Run {
  text: string;
  font?: FontKey;
  color?: RGB;
}

export interface TextOpts {
  font?: FontKey;
  size?: number;
  color?: RGB;
  align?: Align;
  /** largura disponível (para alinhamento à direita/centro e truncamento) */
  width?: number;
  /** trunca com reticências se exceder `width` */
  truncate?: boolean;
  opacity?: number;
}

export interface ParagraphOpts {
  font?: FontKey;
  size?: number;
  color?: RGB;
  lineHeight?: number;
  x?: number;
  width?: number;
  after?: number;
  align?: Align;
  /** não quebra página (o chamador garante o espaço) */
  noBreak?: boolean;
}

export type Cell =
  | string
  | {
      text: string;
      font?: FontKey;
      color?: RGB;
      bg?: RGB;
      align?: Align;
      chip?: { fg: RGB; bg: RGB };
      link?: string;
      size?: number;
      /** desenho customizado dentro da célula (após o fundo, antes do texto) */
      draw?: (l: Layout, x: number, y: number, w: number, h: number) => void;
    };

export interface Column {
  header: string;
  /** peso relativo da largura */
  width: number;
  align?: Align;
  font?: FontKey;
  color?: RGB;
}

export interface TableSpec {
  columns: Column[];
  rows: Cell[][];
  /** linhas de total, em negrito com borda superior */
  footerRows?: Cell[][];
  x?: number;
  width?: number;
  size?: number;
  padX?: number;
  padY?: number;
  zebra?: boolean;
  headerBg?: RGB;
  headerColor?: RGB;
  /** sem cabeçalho */
  noHeader?: boolean;
  noBreak?: boolean;
  after?: number;
}

interface Token {
  text: string;
  font: FontKey;
  color?: RGB;
  spaceBefore: boolean;
}

const NBSP = "\u00a0";
const UNIT_RE =
  /(\d) (?=(%|p\.p\.|MWh|GWh|kWh|kWp|kWac|kW|MW|Wp|t\b|anos?\b|meses\b|mi\b|mil\b|bi\b|°C|m\b|m²|ha\b|cotas?\b|USDT|x\b|h\b|W\/m²|dias?\b))/g;

/** Mantém juntos "R$ 1.234", "12,3 %", "5.612 MWh" etc. */
export function protectSpaces(s: string): string {
  return s
    .replace(/R\$ (?=[-\d])/g, "R$" + NBSP)
    .replace(UNIT_RE, "$1" + NBSP)
    .replace(/ (?=a\.a\.)/g, NBSP)
    .replace(/(nº|n\.º) (?=\d)/g, "$1" + NBSP);
}

const REPLACEMENTS: Record<string, string> = {
  "✓": "v",
  "✔": "v",
  "■": "•",
  "□": "•",
  "◆": "•",
  "★": "*",
  "⚠": "!",
  "\t": " ",
  "\u00ad": "",
  "\u200b": "",
  "\u202f": NBSP,
  "\u2009": " ",
};
const ASCII_FALLBACK: Record<string, string> = { "Δ": "Delta ", "σ": "sigma" };

export class Layout {
  readonly pdf: PDFDocument;
  readonly fonts: Fonts;
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** cursor vertical (de cima para baixo) */
  y = PAGE.contentTop;
  readonly x0 = PAGE.marginX;
  readonly width = PAGE.width - 2 * PAGE.marginX;
  readonly bottom = PAGE.contentBottom;
  private charsets = new Map<PDFFont, Set<number>>();
  private widthCache = new Map<PDFFont, Map<string, number>>();

  constructor(pdf: PDFDocument, fonts: Fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
  }

  // ─── páginas ───────────────────────────────────────────────────────────────────────────────

  addPage(): PDFPage {
    const p = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(p);
    this.page = p;
    this.y = PAGE.contentTop;
    return p;
  }

  remaining(): number {
    return this.bottom - this.y;
  }

  /** Garante `h` pt livres; senão abre nova página. Retorna true se quebrou. */
  ensure(h: number): boolean {
    if (this.y + h > this.bottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  gap(h: number): void {
    this.y += h;
  }

  // ─── texto: saneamento e medição ──────────────────────────────────────────────────────────

  private charset(font: PDFFont): Set<number> {
    let s = this.charsets.get(font);
    if (!s) {
      s = new Set(font.getCharacterSet());
      this.charsets.set(font, s);
    }
    return s;
  }

  /** Normaliza (NFC) e troca caracteres sem glifo na fonte. */
  clean(text: string, fontKey: FontKey = "regular"): string {
    const font = this.fonts[fontKey];
    const cs = this.charset(font);
    let out = "";
    for (const ch of String(text ?? "").normalize("NFC")) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n" || cs.has(cp)) {
        out += ch;
        continue;
      }
      const rep = REPLACEMENTS[ch];
      if (rep !== undefined && [...rep].every((c) => cs.has(c.codePointAt(0)!))) {
        out += rep;
        continue;
      }
      const ascii = ASCII_FALLBACK[ch];
      out += ascii ?? (cp < 32 ? "" : "?");
    }
    return out;
  }

  /** Largura do texto (já saneado) em pt */
  measure(text: string, fontKey: FontKey, size: number): number {
    const font = this.fonts[fontKey];
    let cache = this.widthCache.get(font);
    if (!cache) {
      cache = new Map();
      this.widthCache.set(font, cache);
    }
    const key = text.replace(/\u00a0/g, " ");
    let w = cache.get(key);
    if (w === undefined) {
      w = font.widthOfTextAtSize(key, 1000);
      cache.set(key, w);
    }
    return (w * size) / 1000;
  }

  textWidth(text: string, fontKey: FontKey = "regular", size = SIZE.body): number {
    return this.measure(this.clean(text, fontKey), fontKey, size);
  }

  /** Trunca com reticências para caber em `maxWidth` */
  fit(text: string, fontKey: FontKey, size: number, maxWidth: number): string {
    const t = this.clean(text, fontKey);
    if (this.measure(t, fontKey, size) <= maxWidth) return t;
    const chars = [...t];
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(chars.slice(0, mid).join("") + "…", fontKey, size) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return chars.slice(0, lo).join("").trimEnd() + "…";
  }

  // ─── primitivas de desenho (y = topo, de cima para baixo) ─────────────────────────────────

  /** Desenha uma linha de texto com baseline em `baseline` (coordenada de cima para baixo). */
  text(text: string, x: number, baseline: number, o: TextOpts = {}): number {
    const fontKey = o.font ?? "regular";
    const size = o.size ?? SIZE.body;
    let t = this.clean(text, fontKey).replace(/\n/g, " ");
    if (o.truncate && o.width !== undefined) t = this.fit(t, fontKey, size, o.width);
    const draw = t.replace(/\u00a0/g, " ");
    const w = this.measure(draw, fontKey, size);
    let dx = x;
    if (o.align === "right") dx = x + (o.width ?? 0) - w;
    else if (o.align === "center") dx = x + ((o.width ?? 0) - w) / 2;
    if (draw.trim().length > 0) {
      this.page.drawText(draw, {
        x: dx,
        y: PAGE.height - baseline,
        size,
        font: this.fonts[fontKey],
        color: o.color ?? C.text,
        opacity: o.opacity,
      });
    }
    return w;
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: { fill?: RGB; stroke?: RGB; strokeWidth?: number; opacity?: number } = {},
  ): void {
    if (w <= 0 || h <= 0) return;
    this.page.drawRectangle({
      x,
      y: PAGE.height - y - h,
      width: w,
      height: h,
      color: o.fill,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 0.6) : 0,
      opacity: o.opacity,
      borderOpacity: o.opacity,
    });
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    o: { fill?: RGB; stroke?: RGB; strokeWidth?: number } = {},
  ): void {
    if (w <= 0 || h <= 0) return;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    const k = 0.5523 * rr;
    const path = [
      `M ${x + rr} ${y}`,
      `L ${x + w - rr} ${y}`,
      `C ${x + w - rr + k} ${y} ${x + w} ${y + rr - k} ${x + w} ${y + rr}`,
      `L ${x + w} ${y + h - rr}`,
      `C ${x + w} ${y + h - rr + k} ${x + w - rr + k} ${y + h} ${x + w - rr} ${y + h}`,
      `L ${x + rr} ${y + h}`,
      `C ${x + rr - k} ${y + h} ${x} ${y + h - rr + k} ${x} ${y + h - rr}`,
      `L ${x} ${y + rr}`,
      `C ${x} ${y + rr - k} ${x + rr - k} ${y} ${x + rr} ${y}`,
      "Z",
    ].join(" ");
    this.page.drawSvgPath(path, {
      x: 0,
      y: PAGE.height,
      color: o.fill,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 0.6) : undefined,
    });
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    o: { color?: RGB; width?: number; dash?: number[]; opacity?: number; round?: boolean } = {},
  ): void {
    this.page.drawLine({
      start: { x: x1, y: PAGE.height - y1 },
      end: { x: x2, y: PAGE.height - y2 },
      thickness: o.width ?? 0.5,
      color: o.color ?? C.border,
      dashArray: o.dash,
      opacity: o.opacity,
      lineCap: o.round ? LineCapStyle.Round : undefined,
    });
  }

  polyline(points: [number, number][], o: { color?: RGB; width?: number; dash?: number[] } = {}): void {
    if (points.length < 2) return;
    const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px} ${py}`).join(" ");
    this.page.drawSvgPath(d, {
      x: 0,
      y: PAGE.height,
      borderColor: o.color ?? C.navy,
      borderWidth: o.width ?? 1,
      borderDashArray: o.dash,
      borderLineCap: LineCapStyle.Round,
    });
  }

  polygon(points: [number, number][], o: { fill?: RGB; opacity?: number } = {}): void {
    if (points.length < 3) return;
    const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px} ${py}`).join(" ") + " Z";
    this.page.drawSvgPath(d, { x: 0, y: PAGE.height, color: o.fill, opacity: o.opacity });
  }

  circle(cx: number, cy: number, r: number, o: { fill?: RGB; stroke?: RGB; strokeWidth?: number } = {}): void {
    this.page.drawCircle({
      x: cx,
      y: PAGE.height - cy,
      size: r,
      color: o.fill,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 0.6) : 0,
    });
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number): void {
    this.page.drawImage(img, { x, y: PAGE.height - y - h, width: w, height: h });
  }

  /** Anotação de link (URI) clicável sobre a área indicada da página atual. */
  link(x: number, y: number, w: number, h: number, url: string, page: PDFPage = this.page): void {
    if (!/^https?:\/\//i.test(url)) return;
    const ctx = this.pdf.context;
    const annot = ctx.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, PAGE.height - y - h, x + w, PAGE.height - y],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    page.node.addAnnot(ctx.register(annot));
  }

  // ─── quebra de linhas ─────────────────────────────────────────────────────────────────────

  private tokenize(runs: Run[], defaultFont: FontKey): Token[][] {
    // retorna parágrafos (quebras \n) de tokens
    const paragraphs: Token[][] = [[]];
    let pendingSpace = false;
    for (const run of runs) {
      const font = run.font ?? defaultFont;
      const text = protectSpaces(this.clean(run.text, font));
      const hard = text.split("\n");
      hard.forEach((segment, si) => {
        if (si > 0) {
          paragraphs.push([]);
          pendingSpace = false;
        }
        const parts = segment.split(" ");
        parts.forEach((part, pi) => {
          if (pi > 0) pendingSpace = true;
          if (part.length === 0) return;
          const cur = paragraphs[paragraphs.length - 1];
          cur.push({ text: part, font, color: run.color, spaceBefore: pendingSpace && cur.length > 0 });
          pendingSpace = false;
        });
      });
    }
    return paragraphs;
  }

  /** Quebra runs em linhas que cabem em `maxWidth`. */
  wrapRuns(runs: Run[], size: number, maxWidth: number, defaultFont: FontKey = "regular"): Token[][] {
    const lines: Token[][] = [];
    for (const para of this.tokenize(runs, defaultFont)) {
      let line: Token[] = [];
      let lineW = 0;
      for (const tokIn of para) {
        // divide palavras maiores que a linha (URLs, hashes)
        const pieces: Token[] = [];
        if (this.measure(tokIn.text, tokIn.font, size) > maxWidth) {
          let buf = "";
          let first = true;
          for (const ch of [...tokIn.text]) {
            if (buf && this.measure(buf + ch, tokIn.font, size) > maxWidth) {
              pieces.push({ ...tokIn, text: buf, spaceBefore: first ? tokIn.spaceBefore : false });
              first = false;
              buf = "";
            }
            buf += ch;
          }
          if (buf) pieces.push({ ...tokIn, text: buf, spaceBefore: first ? tokIn.spaceBefore : false });
        } else pieces.push(tokIn);

        for (const tok of pieces) {
          const w = this.measure(tok.text, tok.font, size);
          const space = tok.spaceBefore && line.length > 0 ? this.measure(" ", tok.font, size) : 0;
          if (line.length > 0 && lineW + space + w > maxWidth + 0.01) {
            lines.push(line);
            line = [{ ...tok, spaceBefore: false }];
            lineW = w;
          } else {
            line.push(line.length === 0 ? { ...tok, spaceBefore: false } : tok);
            lineW += space + w;
          }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  wrap(text: string, fontKey: FontKey, size: number, maxWidth: number): string[] {
    return this.wrapRuns([{ text, font: fontKey }], size, maxWidth, fontKey).map((l) =>
      l.map((t) => (t.spaceBefore ? " " : "") + t.text).join(""),
    );
  }

  lineWidth(line: Token[], size: number): number {
    let w = 0;
    for (const t of line) {
      if (t.spaceBefore) w += this.measure(" ", t.font, size);
      w += this.measure(t.text, t.font, size);
    }
    return w;
  }

  /** Desenha uma linha de tokens a partir de x, baseline. */
  drawLine(line: Token[], x: number, baseline: number, size: number, color: RGB, align: Align = "left", width = 0): void {
    let cx = x;
    const lw = this.lineWidth(line, size);
    if (align === "right") cx = x + width - lw;
    else if (align === "center") cx = x + (width - lw) / 2;
    for (const t of line) {
      if (t.spaceBefore) cx += this.measure(" ", t.font, size);
      const draw = t.text.replace(/\u00a0/g, " ");
      this.page.drawText(draw, {
        x: cx,
        y: PAGE.height - baseline,
        size,
        font: this.fonts[t.font],
        color: t.color ?? color,
      });
      cx += this.measure(t.text, t.font, size);
    }
  }

  /** Baseline de uma linha de altura `lh` cujo topo é `top` (centraliza a altura de versais). */
  static baseline(top: number, lh: number, size: number): number {
    return top + lh / 2 + size * 0.35;
  }

  // ─── blocos de fluxo ──────────────────────────────────────────────────────────────────────

  measureRich(runs: Run[], o: ParagraphOpts = {}): number {
    const size = o.size ?? SIZE.body;
    const lh = size * (o.lineHeight ?? SIZE.lineHeight);
    return this.wrapRuns(runs, size, o.width ?? this.width, o.font ?? "regular").length * lh;
  }

  rich(runs: Run[], o: ParagraphOpts = {}): void {
    const size = o.size ?? SIZE.body;
    const lh = size * (o.lineHeight ?? SIZE.lineHeight);
    const x = o.x ?? this.x0;
    const width = o.width ?? this.width;
    const lines = this.wrapRuns(runs, size, width, o.font ?? "regular");
    for (const line of lines) {
      if (!o.noBreak) this.ensure(lh);
      this.drawLine(line, x, Layout.baseline(this.y, lh, size), size, o.color ?? C.text, o.align, width);
      this.y += lh;
    }
    this.y += o.after ?? 0;
  }

  paragraph(text: string, o: ParagraphOpts = {}): void {
    this.rich([{ text, font: o.font }], o);
  }

  /** Lista com marcadores */
  bullets(items: (string | Run[])[], o: ParagraphOpts & { bullet?: string; bulletColor?: RGB; gap?: number } = {}): void {
    const size = o.size ?? SIZE.body;
    const lh = size * (o.lineHeight ?? SIZE.lineHeight);
    const x = o.x ?? this.x0;
    const width = o.width ?? this.width;
    const indent = 10;
    for (const item of items) {
      const runs = typeof item === "string" ? [{ text: item }] : item;
      const lines = this.wrapRuns(runs, size, width - indent, o.font ?? "regular");
      lines.forEach((line, i) => {
        if (!o.noBreak) this.ensure(lh);
        const bl = Layout.baseline(this.y, lh, size);
        if (i === 0) {
          this.rect(x + 1, bl - size * 0.36, 3, 3, { fill: o.bulletColor ?? C.amber });
        }
        this.drawLine(line, x + indent, bl, size, o.color ?? C.text);
        this.y += lh;
      });
      this.y += o.gap ?? 2;
    }
    this.y += o.after ?? 0;
  }

  /** Título de seção numerado (com quebra de página se pouco espaço). */
  sectionTitle(num: number | string, title: string, opts: { minSpace?: number; lead?: string } = {}): void {
    const min = opts.minSpace ?? 200;
    if (this.y > PAGE.contentTop + 1) {
      if (this.remaining() < min) this.addPage();
      else this.y += 14;
    }
    const size = SIZE.h1;
    const top = this.y;
    const bl = top + size;
    const numStr = String(num).padStart(2, "0");
    const nw = this.text(numStr, this.x0, bl, { font: "bold", size, color: C.amber });
    this.text(title, this.x0 + nw + 8, bl, { font: "bold", size, color: C.navy });
    this.y = bl + 7;
    this.line(this.x0, this.y, this.x0 + this.width, this.y, { color: C.navy, width: 0.9 });
    this.y += 9;
    if (opts.lead) this.paragraph(opts.lead, { color: C.muted, size: SIZE.body, after: 6 });
  }

  /** Subtítulo com marcador âmbar */
  subTitle(text: string, opts: { minSpace?: number; x?: number; width?: number; right?: string } = {}): void {
    this.ensure(opts.minSpace ?? 60);
    const size = SIZE.h2;
    const x = opts.x ?? this.x0;
    this.y += 4;
    const bl = this.y + size;
    this.rect(x, bl - size * 0.78, 2.6, size * 0.86, { fill: C.amber });
    this.text(text, x + 8, bl, { font: "semibold", size, color: C.navy });
    if (opts.right) {
      this.text(opts.right, x, bl, {
        font: "regular",
        size: SIZE.small,
        color: C.muted,
        align: "right",
        width: opts.width ?? this.width,
      });
    }
    this.y = bl + 7;
  }

  /** Legenda / nota de rodapé de gráfico */
  caption(text: string, o: { x?: number; width?: number; after?: number } = {}): void {
    this.paragraph(text, { size: SIZE.tiny, color: C.muted, x: o.x, width: o.width, after: o.after ?? 6, lineHeight: 1.35 });
  }

  /** Chip arredondado; retorna a largura. `y` = topo. */
  chip(text: string, x: number, y: number, fg: RGB, bg: RGB, size = 6.6, align: Align = "left", width = 0): number {
    const t = this.clean(text, "semibold");
    const w = this.measure(t, "semibold", size) + 8;
    const h = size + 5;
    let cx = x;
    if (align === "right") cx = x + width - w;
    else if (align === "center") cx = x + (width - w) / 2;
    this.roundRect(cx, y, w, h, h / 2, { fill: bg });
    this.text(t, cx + 4, y + h / 2 + size * 0.35, { font: "semibold", size, color: fg });
    return w;
  }

  /** Caixa de destaque com barra lateral, título opcional e parágrafos. */
  callout(
    body: (string | Run[])[],
    o: { title?: string; accent?: RGB; bg?: RGB; size?: number; titleColor?: RGB; x?: number; width?: number; after?: number; noBreak?: boolean } = {},
  ): number {
    const size = o.size ?? SIZE.body;
    const lh = size * SIZE.lineHeight;
    const x = o.x ?? this.x0;
    const width = o.width ?? this.width;
    const pad = 9;
    const innerW = width - pad * 2 - 3;
    const blocks = body.map((b) => this.wrapRuns(typeof b === "string" ? [{ text: b }] : b, size, innerW));
    const titleH = o.title ? size + 7 : 0;
    const h = pad * 2 + titleH + blocks.reduce((s, b) => s + b.length * lh, 0) + (blocks.length - 1) * 3;
    if (!o.noBreak) this.ensure(h);
    const top = this.y;
    this.rect(x, top, width, h, { fill: o.bg ?? C.panel });
    this.rect(x, top, 3, h, { fill: o.accent ?? C.amber });
    let cy = top + pad;
    if (o.title) {
      this.text(o.title, x + 3 + pad, cy + size, { font: "bold", size, color: o.titleColor ?? C.navy });
      cy += titleH;
    }
    blocks.forEach((lines, bi) => {
      for (const line of lines) {
        this.drawLine(line, x + 3 + pad, Layout.baseline(cy, lh, size), size, C.text);
        cy += lh;
      }
      if (bi < blocks.length - 1) cy += 3;
    });
    this.y = top + h + (o.after ?? 8);
    return h;
  }

  /** Grade de pares rótulo/valor (rótulo pequeno acima do valor). */
  definitionGrid(
    items: { label: string; value: string; mono?: boolean; link?: string; color?: RGB }[],
    o: { cols?: number; x?: number; width?: number; after?: number; valueSize?: number } = {},
  ): void {
    const cols = o.cols ?? 3;
    const x = o.x ?? this.x0;
    const width = o.width ?? this.width;
    const colW = width / cols;
    const labelSize = 6.6;
    const valueSize = o.valueSize ?? 8.8;
    const vlh = valueSize * 1.3;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const wrapped = row.map((it) =>
        this.wrap(it.value || "—", it.mono ? "mono" : "semibold", it.mono ? valueSize - 1 : valueSize, colW - 12),
      );
      const h = 8 + labelSize + 4 + Math.max(...wrapped.map((w) => w.length)) * vlh + 4;
      this.ensure(h);
      const top = this.y;
      row.forEach((it, j) => {
        const cx = x + j * colW;
        this.text(it.label.toUpperCase(), cx, top + 6 + labelSize, { font: "semibold", size: labelSize, color: C.muted, width: colW - 8, truncate: true });
        let vy = top + 6 + labelSize + 4;
        for (const ln of wrapped[j]) {
          this.text(ln, cx, Layout.baseline(vy, vlh, valueSize), {
            font: it.mono ? "mono" : "semibold",
            size: it.mono ? valueSize - 1 : valueSize,
            color: it.color ?? C.text,
          });
          vy += vlh;
        }
        if (it.link) this.link(cx, top + 6 + labelSize + 4, colW - 12, wrapped[j].length * vlh, it.link);
      });
      this.y = top + h;
      this.line(x, this.y, x + width, this.y, { color: C.border, width: 0.5 });
    }
    this.y += o.after ?? 8;
  }

  // ─── tabelas ──────────────────────────────────────────────────────────────────────────────

  private cellProps(cell: Cell, col: Column): { text: string; font: FontKey; color?: RGB; align: Align; size?: number } {
    if (typeof cell === "string") return { text: cell, font: col.font ?? "regular", color: col.color, align: col.align ?? "left" };
    return {
      text: cell.text,
      font: cell.font ?? col.font ?? "regular",
      color: cell.color ?? col.color,
      align: cell.align ?? col.align ?? "left",
      size: cell.size,
    };
  }

  private tableGeometry(spec: TableSpec) {
    const x = spec.x ?? this.x0;
    const width = spec.width ?? this.width;
    const size = spec.size ?? SIZE.table;
    const padX = spec.padX ?? 5;
    const padY = spec.padY ?? 3.6;
    const lh = size * 1.3;
    const total = spec.columns.reduce((s, c) => s + c.width, 0);
    const widths = spec.columns.map((c) => (c.width / total) * width);
    const xs: number[] = [];
    widths.reduce((acc, w) => {
      xs.push(acc);
      return acc + w;
    }, x);
    return { x, width, size, padX, padY, lh, widths, xs };
  }

  private layoutRow(spec: TableSpec, cells: Cell[], g: ReturnType<Layout["tableGeometry"]>, header = false) {
    const lines = cells.map((cell, i) => {
      const col = spec.columns[i];
      if (header) return this.wrap(col.header, "semibold", g.size - 0.4, g.widths[i] - 2 * g.padX);
      const p = this.cellProps(cell, col);
      const isChip = typeof cell !== "string" && !!cell.chip;
      return this.wrap(p.text, p.font, p.size ?? g.size, g.widths[i] - 2 * g.padX - (isChip ? 8 : 0));
    });
    const n = Math.max(1, ...lines.map((l) => l.length));
    return { lines, h: n * g.lh + 2 * g.padY };
  }

  measureTable(spec: TableSpec): number {
    const g = this.tableGeometry(spec);
    let h = spec.noHeader ? 0 : this.layoutRow(spec, spec.columns.map(() => ""), g, true).h;
    for (const r of [...spec.rows, ...(spec.footerRows ?? [])]) h += this.layoutRow(spec, r, g).h;
    return h + (spec.after ?? 10);
  }

  table(spec: TableSpec): void {
    const g = this.tableGeometry(spec);
    const header = spec.noHeader ? null : this.layoutRow(spec, spec.columns.map(() => ""), g, true);

    const drawHeader = () => {
      if (!header) return;
      const top = this.y;
      this.rect(g.x, top, g.width, header.h, { fill: spec.headerBg ?? C.navy });
      spec.columns.forEach((col, i) => {
        header.lines[i].forEach((ln, li) => {
          this.text(ln, g.xs[i] + g.padX, Layout.baseline(top + g.padY + li * g.lh, g.lh, g.size - 0.4), {
            font: "semibold",
            size: g.size - 0.4,
            color: spec.headerColor ?? C.white,
            align: col.align ?? "left",
            width: g.widths[i] - 2 * g.padX,
          });
        });
      });
      this.y = top + header.h;
    };

    const firstRowH = spec.rows.length ? this.layoutRow(spec, spec.rows[0], g).h : 0;
    if (!spec.noBreak) this.ensure((header?.h ?? 0) + firstRowH);
    drawHeader();

    const drawRow = (cells: Cell[], idx: number, isFooter: boolean) => {
      const row = this.layoutRow(spec, cells, g);
      if (!spec.noBreak && this.y + row.h > this.bottom) {
        this.addPage();
        drawHeader();
      }
      const top = this.y;
      if (isFooter) {
        this.rect(g.x, top, g.width, row.h, { fill: C.navySoft });
        this.line(g.x, top, g.x + g.width, top, { color: C.navy, width: 0.8 });
      } else if ((spec.zebra ?? true) && idx % 2 === 1) {
        this.rect(g.x, top, g.width, row.h, { fill: C.zebra });
      }
      cells.forEach((cell, i) => {
        const col = spec.columns[i];
        const cx = g.xs[i];
        const cw = g.widths[i];
        if (typeof cell !== "string" && cell.bg) this.rect(cx, top, cw, row.h, { fill: cell.bg });
        if (typeof cell !== "string" && cell.draw) cell.draw(this, cx, top, cw, row.h);
        const p = this.cellProps(cell, col);
        const size = p.size ?? g.size;
        const font: FontKey = isFooter && p.font === "regular" ? "semibold" : p.font;
        if (typeof cell !== "string" && cell.chip) {
          const chipH = size + 4;
          this.chip(p.text, cx + g.padX, top + (row.h - chipH) / 2 - 0.5, cell.chip.fg, cell.chip.bg, size - 0.8, p.align, cw - 2 * g.padX);
        } else {
          row.lines[i].forEach((ln, li) => {
            this.text(ln, cx + g.padX, Layout.baseline(top + g.padY + li * g.lh, g.lh, size), {
              font,
              size,
              color: p.color ?? C.text,
              align: p.align,
              width: cw - 2 * g.padX,
            });
          });
        }
        if (typeof cell !== "string" && cell.link) this.link(cx, top, cw, row.h, cell.link);
      });
      this.y = top + row.h;
      if (!isFooter) this.line(g.x, this.y, g.x + g.width, this.y, { color: C.border, width: 0.4 });
    };

    spec.rows.forEach((r, i) => drawRow(r, i, false));
    (spec.footerRows ?? []).forEach((r, i) => drawRow(r, i, true));
    this.y += spec.after ?? 10;
  }

  /** Grade de KPIs. */
  tiles(
    items: { label: string; value: string; sub?: string; accent?: RGB; valueColor?: RGB }[],
    o: { cols?: number; height?: number; gap?: number; x?: number; width?: number; after?: number; valueSize?: number } = {},
  ): void {
    const cols = o.cols ?? 4;
    const gap = o.gap ?? 6;
    const x = o.x ?? this.x0;
    const width = o.width ?? this.width;
    const tileW = (width - gap * (cols - 1)) / cols;
    const h = o.height ?? 50;
    const rows = Math.ceil(items.length / cols);
    for (let r = 0; r < rows; r++) {
      this.ensure(h + gap);
      const top = this.y;
      items.slice(r * cols, r * cols + cols).forEach((it, j) => {
        const tx = x + j * (tileW + gap);
        this.rect(tx, top, tileW, h, { fill: C.white, stroke: C.border, strokeWidth: 0.7 });
        this.rect(tx, top, tileW, 2, { fill: it.accent ?? C.amber });
        const pad = 7;
        this.text(it.label.toUpperCase(), tx + pad, top + 12.5, { font: "semibold", size: 6.3, color: C.muted, width: tileW - 2 * pad, truncate: true });
        let vs = o.valueSize ?? 13.5;
        const vt = this.clean(it.value, "bold");
        while (vs > 8 && this.measure(vt, "bold", vs) > tileW - 2 * pad) vs -= 0.5;
        this.text(vt, tx + pad, top + 15.5 + vs, { font: "bold", size: vs, color: it.valueColor ?? C.navy });
        if (it.sub) {
          this.text(it.sub, tx + pad, top + h - 7, { size: 6.6, color: C.muted, width: tileW - 2 * pad, truncate: true });
        }
      });
      this.y = top + h + gap;
    }
    this.y += (o.after ?? 8) - gap;
  }
}
