/** Marca Aferi Capital: "A" geométrico com folha (energia limpa) */
export function LogoMark({ className = "size-8", inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <path d="M20 3 4.5 36h7.2L20 17.6 28.3 36h7.2z" fill={inverted ? "#ffffff" : "#0f2a44"} />
      <path d="M21.5 25.5c3.8-7.6 10.2-11 17-11.5-1.2 7.4-6.3 13.6-14.4 14.4-.9.1-1.8 0-2.6-.2z" fill="#22b573" />
      <path d="M21.4 28c3.6-3.8 7.6-6.6 12.4-8.6" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark inverted={inverted} />
      <span className="flex flex-col leading-none">
        <span className={`text-[21px] font-bold tracking-tight ${inverted ? "text-white" : "text-navy"}`}>Aferi</span>
        <span className="mt-0.5 text-[11px] font-semibold tracking-wide text-leaf">Capital</span>
      </span>
    </span>
  );
}
