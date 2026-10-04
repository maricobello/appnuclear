export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="12" r="6" fill="#f5a524" />
      <g stroke="#f5a524" strokeWidth="2" strokeLinecap="round">
        <path d="M16 1.5v2.5M5.5 12H3M29 12h-2.5M8.6 4.6l1.7 1.7M23.4 4.6l-1.7 1.7" />
      </g>
      <path d="M4 22.5h24l-2.5 7h-19z" fill="#3987e5" />
      <path d="M10.5 22.5l-1 7M16 22.5v7M21.5 22.5l1 7M5.2 26h21.6" stroke="#0c1219" strokeWidth="1.2" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-ink">
        UFV <span className="text-brand">Invest</span>
      </span>
    </span>
  );
}
