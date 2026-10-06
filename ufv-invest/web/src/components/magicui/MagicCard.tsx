"use client";

import { useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Magic Card (Magic UI): brilho radial que acompanha o cursor. */
export function MagicCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r || !ref.current) return;
        ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
        ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cx(
        "relative overflow-hidden rounded-2xl border border-line bg-surface shadow-sm",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition before:duration-300 hover:before:opacity-100",
        "before:bg-[radial-gradient(420px_circle_at_var(--mx,50%)_var(--my,50%),rgba(245,165,36,0.10),transparent_45%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
