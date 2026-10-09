/**
 * Ilustração vetorial de uma usina (vista aérea em perspectiva), gerada de forma determinística
 * a partir do slug: estrutura fixa = fileiras Leste-Oeste; seguidor solar = fileiras Norte-Sul
 * convergindo para o horizonte. Terreno e luz variam por região. Sem imagem externa (CSP 'self').
 * Quando a usina tiver foto/arte real (`plant.cover`), a vitrine usa a imagem no lugar.
 */

type Variant = { sky: [string, string, string]; ground: [string, string]; veg: string[]; sunX: number; river?: boolean };

const VARIANTS: Record<string, Variant> = {
  // cerrado do norte de Minas, fim de tarde
  "ufv-janauba-1": { sky: ["#4f9ee0", "#a8d2f2", "#fbe3b8"], ground: ["#a08a5c", "#6e5a36"], veg: ["#4f6b2e", "#65803a", "#3e5524"], sunX: 380 },
  // caatinga do Vale do São Francisco, luz alta com rio ao lado
  "ufv-petrolina-1": { sky: ["#5aa8e8", "#b3dbf7", "#fdebc6"], ground: ["#b8925a", "#7a5a32"], veg: ["#7d7a40", "#938a4c", "#5e5a30"], sunX: 120, river: true },
  // oeste baiano, solo avermelhado, manhã
  "ufv-bom-jesus-da-lapa-1": { sky: ["#4c9be0", "#a6d0f2", "#fde2b0"], ground: ["#b0663e", "#74391f"], veg: ["#55672f", "#6b7c39", "#435224"], sunX: 90 },
};

function rng(seedStr: string) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 480;
const H = 300;
const HORIZON = 104;

/** borda do campo: interpola entre o horizonte e a base */
function edges(y: number) {
  const t = (y - HORIZON) / (H - HORIZON);
  return { l: 168 - t * 250, r: 312 + t * 250 };
}

export function PlantArt({ slug, mounting, className, title }: { slug: string; mounting: "fixed" | "single-axis"; className?: string; title?: string }) {
  const v = VARIANTS[slug] ?? VARIANTS["ufv-janauba-1"];
  const rand = rng(slug);
  const id = slug.replace(/[^a-z0-9]/gi, "");

  // vegetação fora do campo
  const veg: { x: number; y: number; r: number; c: string }[] = [];
  for (let i = 0; i < 90; i++) {
    const y = HORIZON + 6 + Math.pow(rand(), 1.4) * (H - HORIZON);
    const { l, r } = edges(y);
    const side = rand() < 0.5;
    const x = side ? l - 8 - rand() * 140 : r + 8 + rand() * 140;
    const scale = 0.4 + ((y - HORIZON) / (H - HORIZON)) * 1.6;
    veg.push({ x, y, r: (1.6 + rand() * 2.6) * scale, c: v.veg[Math.floor(rand() * v.veg.length)] });
  }

  const panels: { d: string; sheen: number }[] = [];
  if (mounting === "fixed") {
    // fileiras Leste-Oeste: faixas horizontais com espaçamento em perspectiva, divididas em mesas
    const rows = 17;
    for (let i = 0; i < rows; i++) {
      const t0 = Math.pow(i / rows, 1.7);
      const t1 = Math.pow((i + 0.55) / rows, 1.7);
      const y0 = HORIZON + 4 + t0 * (H - HORIZON);
      const y1 = HORIZON + 4 + t1 * (H - HORIZON);
      const e0 = edges(y0);
      const e1 = edges(y1);
      const tables = 7;
      for (let k = 0; k < tables; k++) {
        const a = k / tables + 0.012;
        const b = (k + 1) / tables - 0.012;
        const x00 = e0.l + (e0.r - e0.l) * a;
        const x01 = e0.l + (e0.r - e0.l) * b;
        const x10 = e1.l + (e1.r - e1.l) * a;
        const x11 = e1.l + (e1.r - e1.l) * b;
        const cx = (x00 + x11) / 2;
        panels.push({ d: `M${x00},${y0}L${x01},${y0}L${x11},${y1}L${x10},${y1}Z`, sheen: Math.max(0, 1 - Math.abs(cx - v.sunX) / 220) });
      }
    }
  } else {
    // seguidor de um eixo: fileiras Norte-Sul convergindo ao ponto de fuga
    const cols = 15;
    for (let k = 0; k < cols; k++) {
      const a = k / cols + 0.018;
      const b = (k + 1) / cols - 0.018;
      const segs = 6;
      for (let s = 0; s < segs; s++) {
        const t0 = Math.pow(s / segs, 1.5);
        const t1 = Math.pow((s + 0.92) / segs, 1.5);
        const y0 = HORIZON + 4 + t0 * (H - HORIZON);
        const y1 = HORIZON + 4 + t1 * (H - HORIZON);
        const e0 = edges(y0);
        const e1 = edges(y1);
        const x00 = e0.l + (e0.r - e0.l) * a;
        const x01 = e0.l + (e0.r - e0.l) * b;
        const x10 = e1.l + (e1.r - e1.l) * a;
        const x11 = e1.l + (e1.r - e1.l) * b;
        const cx = (x00 + x11) / 2;
        panels.push({ d: `M${x00},${y0}L${x01},${y0}L${x11},${y1}L${x10},${y1}Z`, sheen: Math.max(0, 1 - Math.abs(cx - v.sunX) / 200) });
      }
    }
  }

  const fieldTop = edges(HORIZON + 2);
  const fieldBot = edges(H);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label={title ?? "Ilustração da usina solar"}>
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v.sky[0]} />
          <stop offset="0.6" stopColor={v.sky[1]} />
          <stop offset="1" stopColor={v.sky[2]} />
        </linearGradient>
        <linearGradient id={`ground-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v.ground[0]} />
          <stop offset="1" stopColor={v.ground[1]} />
        </linearGradient>
        <linearGradient id={`panel-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c4f86" />
          <stop offset="1" stopColor="#13284a" />
        </linearGradient>
        <radialGradient id={`sun-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff4d6" />
          <stop offset="0.25" stopColor="#ffd27a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`fade-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.6" stopColor="#0b1b2b" stopOpacity="0" />
          <stop offset="1" stopColor="#0b1b2b" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      <rect width={W} height={HORIZON + 2} fill={`url(#sky-${id})`} />
      <circle cx={v.sunX} cy={HORIZON - 6} r="70" fill={`url(#sun-${id})`} />
      <circle cx={v.sunX} cy={HORIZON - 6} r="11" fill="#fff1c9" />
      {/* serras ao fundo */}
      <path d={`M0,${HORIZON} L40,${HORIZON - 12} L90,${HORIZON - 6} L150,${HORIZON - 18} L210,${HORIZON - 8} L270,${HORIZON - 15} L330,${HORIZON - 5} L400,${HORIZON - 16} L480,${HORIZON - 7} L480,${HORIZON + 2} L0,${HORIZON + 2}Z`} fill="#6f86a3" opacity="0.45" />
      <rect y={HORIZON} width={W} height={H - HORIZON} fill={`url(#ground-${id})`} />

      {v.river && <path d={`M480,${HORIZON + 6} C430,${HORIZON + 40} 470,${HORIZON + 90} 420,${H}`} stroke="#3a7fb5" strokeWidth="16" fill="none" opacity="0.7" />}

      {/* estrada de acesso e subestação */}
      <path d={`M${fieldBot.l + 60},${H} L${fieldTop.l + 20},${HORIZON + 4}`} stroke="#c9b48a" strokeWidth="2.5" opacity="0.35" fill="none" />
      <rect x={fieldTop.r + 6} y={HORIZON + 6} width="14" height="7" fill="#d0d4da" opacity="0.7" />

      {/* área do campo (terra compactada) */}
      <path d={`M${fieldTop.l - 4},${HORIZON + 2} L${fieldTop.r + 4},${HORIZON + 2} L${fieldBot.r + 10},${H} L${fieldBot.l - 10},${H}Z`} fill="#000" opacity="0.12" />

      {veg.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.c} opacity="0.9" />
      ))}

      {panels.map((p, i) => (
        <g key={i}>
          <path d={p.d} fill={`url(#panel-${id})`} />
          {p.sheen > 0.05 && <path d={p.d} fill="#bcd8ff" opacity={p.sheen * 0.35} />}
        </g>
      ))}

      <rect width={W} height={H} fill={`url(#fade-${id})`} />
    </svg>
  );
}
