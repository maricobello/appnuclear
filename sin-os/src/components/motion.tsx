"use client";

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Movimento com intenção (Apple HIG): curto, amortecido, sem "quicar", e desligado quando o
 * sistema pede "reduzir movimento". Serve para orientar (o que entrou, o que mudou), nunca
 * para decorar.
 */
export const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };
export const EASE = [0.25, 0.1, 0.25, 1] as const;

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={SPRING}>{children}</MotionConfig>;
}

/** Entrada discreta (opacidade + 4 px), com atraso opcional para escalonar blocos. */
export function Appear({ children, delay = 0, className, as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" }) {
  const Comp = as === "section" ? motion.section : as === "li" ? motion.li : motion.div;
  return (
    <Comp className={className} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay }}>
      {children}
    </Comp>
  );
}

/**
 * Número que interpola até o novo valor e pisca verde/vermelho quando sobe/desce — como um
 * tick de terminal. Renderiza o texto final no servidor (SSR estável) e anima só no cliente.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  flash = true,
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  className?: string;
  flash?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  useLayoutEffect(() => {
    fmt.current = format;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      el.textContent = "—";
      prev.current = null;
      return;
    }
    const from = prev.current;
    prev.current = value;
    if (from === null || reduce || from === value) {
      el.textContent = fmt.current(value);
      return;
    }
    if (flash) {
      el.animate(
        [{ color: value > from ? "var(--good)" : "var(--critical)" }, { color: "inherit" }],
        { duration: 900, easing: "ease-out" },
      );
    }
    const ctl = animate(from, value, { duration: 0.5, ease: EASE, onUpdate: (v) => (el.textContent = fmt.current(v)) });
    return () => ctl.stop();
  }, [value, reduce, flash]);

  // o React só escreve o texto inicial (SSR); depois o efeito é dono do conteúdo do span —
  // assim a reconciliação nunca disputa o nó de texto com a animação
  const [initial] = useState(() => (value === null || value === undefined || !Number.isFinite(value) ? "—" : format(value)));
  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  );
}
