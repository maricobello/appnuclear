"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Preferências da Iara (neste navegador). Desligada por padrão: nada de microfone nem de
 * chamadas à IA até o usuário ativar.
 */
export interface IaraSettings {
  enabled: boolean;
  /** Responder falando quando a pergunta veio por voz. */
  speak: boolean;
  /** Voltar a ouvir depois de responder (conversa contínua, como a Siri). */
  continuous: boolean;
  /** Senha simples do front ou o código da Vercel (ASSISTANT_ACCESS_CODE). */
  code: string;
  voiceURI: string | null;
  /** Usar a voz natural do servidor (OpenVoice/ElevenLabs/Azure) quando houver. */
  natural: boolean;
}

export const DEFAULT_IARA: IaraSettings = { enabled: false, speak: true, continuous: false, code: "", voiceURI: null, natural: true };
const KEY = "sinos.iara.v1";
let listeners: (() => void)[] = [];

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseIara(raw: string): IaraSettings {
  try {
    const o = JSON.parse(raw) as Partial<IaraSettings>;
    return {
      enabled: o.enabled === true,
      speak: o.speak !== false,
      continuous: o.continuous === true,
      code: typeof o.code === "string" ? o.code.slice(0, 200) : "",
      voiceURI: typeof o.voiceURI === "string" ? o.voiceURI : null,
      natural: o.natural !== false,
    };
  } catch {
    return DEFAULT_IARA;
  }
}

export function saveIara(patch: Partial<IaraSettings>) {
  const next = { ...parseIara(read() || "{}"), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* modo privado */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useIara(): IaraSettings {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => (raw ? parseIara(raw) : DEFAULT_IARA), [raw]);
}
