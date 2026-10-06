"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Number Ticker (padrão Magic UI, implementação local sem dependências): conta de 0 até o
 * valor quando entra na tela. O HTML do servidor já traz o valor final (página completa sem
 * JS e para leitores de tela); respeita prefers-reduced-motion.
 */
export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1400,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);

  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(value)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(value * eased);
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  const finalText = `${prefix}${fmt(value)}${suffix}`;
  return (
    <span ref={ref} className={className} aria-label={finalText}>
      <span aria-hidden>{shown === null ? finalText : `${prefix}${fmt(shown)}${suffix}`}</span>
    </span>
  );
}
