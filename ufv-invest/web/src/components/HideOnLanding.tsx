"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Esconde cabeçalho e rodapé da plataforma na landing (tela única, imersiva) */
export function HideOnLanding({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : <>{children}</>;
}
