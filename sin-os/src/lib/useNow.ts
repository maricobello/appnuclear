"use client";

import { useSyncExternalStore } from "react";

/**
 * "Agora" estável para o render (regra de pureza do React 19): muda só a cada `stepMs` e
 * todos os componentes que usam o mesmo passo veem o mesmo instante.
 */
export function useNow(stepMs = 60_000): number {
  return useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, Math.min(stepMs, 15_000));
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / stepMs) * stepMs,
    () => 0,
  );
}
