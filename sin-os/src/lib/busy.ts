"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Contador global de "trabalho em andamento" que o usuário disparou (trocar distribuidora,
 * ler fatura, gerar PDF, rodar auditoria…). O véu de carregamento do Shell lê este contador.
 * A atualização automática de fundo NÃO entra aqui, para a tela não piscar a cada minuto.
 */
let count = 0;
let label: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function begin(l?: string) {
  count++;
  if (l) label = l;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count = Math.max(0, count - 1);
    if (!count) label = null;
    emit();
  };
}

/** Marca uma promessa como trabalho visível (véu enquanto ela não termina). */
export async function trackBusy<T>(p: Promise<T>, l?: string): Promise<T> {
  const end = begin(l);
  try {
    return await p;
  } finally {
    end();
  }
}

/** Enquanto `active` for verdadeiro, o véu fica ligado. */
export function useBusyFlag(active: boolean, l?: string) {
  useEffect(() => (active ? begin(l) : undefined), [active, l]);
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useBusy(): { busy: boolean; label: string | null } {
  const busy = useSyncExternalStore(subscribe, () => count > 0, () => false);
  const l = useSyncExternalStore(subscribe, () => label, () => null);
  return { busy, label: l };
}

/* o véu global avisa quando está de fato na tela (inclui o tempo mínimo e o fade) */
let veilVisible = false;
export function setVeilVisible(v: boolean) {
  if (veilVisible !== v) {
    veilVisible = v;
    emit();
  }
}
export const useVeilVisible = () => useSyncExternalStore(subscribe, () => veilVisible, () => false);
