/** Bandeiras em SVG (emoji de bandeira não aparece no Windows). Desenho simplificado, proporção 4:3. */
export function Flag({ code, className = "h-3.5 w-[18px]" }: { code: "br" | "us" | "es" | "fr" | "de" | "cn" | "jp"; className?: string }) {
  const body = {
    br: (
      <>
        <rect width="24" height="18" fill="#009c3b" />
        <path d="M12 2.2 21.6 9 12 15.8 2.4 9z" fill="#ffdf00" />
        <circle cx="12" cy="9" r="3.9" fill="#002776" />
        <path d="M8.3 8.2c2.6-.5 5.2-.1 7.4 1.2" stroke="#fff" strokeWidth=".7" fill="none" />
      </>
    ),
    us: (
      <>
        <rect width="24" height="18" fill="#fff" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} y={i * 1.385} width="24" height="1.385" fill="#b22234" />
        ))}
        <rect width="10.5" height="9.7" fill="#3c3b6e" />
        {[1.6, 4.2, 6.8, 9.4].flatMap((x) => [1.8, 4.8, 7.8].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".55" fill="#fff" />))}
      </>
    ),
    es: (
      <>
        <rect width="24" height="18" fill="#c60b1e" />
        <rect y="4.5" width="24" height="9" fill="#ffc400" />
      </>
    ),
    fr: (
      <>
        <rect width="8" height="18" fill="#002395" />
        <rect x="8" width="8" height="18" fill="#fff" />
        <rect x="16" width="8" height="18" fill="#ed2939" />
      </>
    ),
    de: (
      <>
        <rect width="24" height="6" fill="#000" />
        <rect y="6" width="24" height="6" fill="#dd0000" />
        <rect y="12" width="24" height="6" fill="#ffce00" />
      </>
    ),
    cn: (
      <>
        <rect width="24" height="18" fill="#de2910" />
        <path d="m4.5 2.2.9 2.7h2.8l-2.3 1.7.9 2.7-2.3-1.7-2.3 1.7.9-2.7L.8 4.9h2.8z" fill="#ffde00" />
        {[
          [9, 1.6],
          [10.6, 3.4],
          [10.6, 6],
          [9, 7.8],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r=".7" fill="#ffde00" />
        ))}
      </>
    ),
    jp: (
      <>
        <rect width="24" height="18" fill="#fff" />
        <circle cx="12" cy="9" r="5" fill="#bc002d" />
      </>
    ),
  }[code];
  return (
    <svg viewBox="0 0 24 18" className={`${className} shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/15`} aria-hidden>
      {body}
    </svg>
  );
}
