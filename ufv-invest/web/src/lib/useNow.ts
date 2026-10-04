"use client";

import { useSyncExternalStore } from "react";

/** Relógio compartilhado (segundos Unix) que atualiza a cada 15 s — puro durante o render. */
let now = Math.floor(Date.now() / 1000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(cb: () => void) {
  listeners.add(cb);
  now = Math.floor(Date.now() / 1000);
  timer ??= setInterval(() => {
    now = Math.floor(Date.now() / 1000);
    listeners.forEach((l) => l());
  }, 15_000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNowSec(): number {
  return useSyncExternalStore(subscribe, () => now, () => 0);
}

const noop = () => () => {};
/** true só no cliente após a hidratação (sem setState em efeito) */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
