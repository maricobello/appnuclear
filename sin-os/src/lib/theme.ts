"use client";

import { useSyncExternalStore } from "react";
import { APPEARANCE_KEY, UI_KEY } from "./theme-boot";

/**
 * Aparência: segue o sistema por padrão (como os apps da Apple); "light"/"dark" forçam o tema
 * gravando `data-theme` no <html>. O script inline do layout aplica a escolha antes da pintura.
 *
 * Visual: "modern" (padrão) ou "terminal" — o visual clássico do SIN OS (escuro, denso, números
 * em fonte mono e faixa de cotações no topo), gravado como `data-ui="terminal"`. No Terminal o
 * tema é sempre escuro.
 */
export type Appearance = "system" | "light" | "dark";
export type Scheme = "light" | "dark";
export type UiMode = "modern" | "terminal";

const EVENT = "sinos-appearance";

export function getAppearance(): Appearance {
  try {
    const a = localStorage.getItem(APPEARANCE_KEY);
    return a === "light" || a === "dark" ? a : "system";
  } catch {
    return "system";
  }
}

export function setAppearance(a: Appearance) {
  try {
    if (a === "system") localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, a);
  } catch {
    // sem armazenamento (aba privada): vale só nesta sessão
  }
  const root = document.documentElement;
  if (a === "system") delete root.dataset.theme;
  else root.dataset.theme = a;
  window.dispatchEvent(new Event(EVENT));
}

export function setUiMode(m: UiMode) {
  try {
    if (m === "terminal") localStorage.setItem(UI_KEY, "terminal");
    else localStorage.removeItem(UI_KEY);
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
  const root = document.documentElement;
  if (m === "terminal") root.dataset.ui = "terminal";
  else delete root.dataset.ui;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const currentUi = (): UiMode => (document.documentElement.dataset.ui === "terminal" ? "terminal" : "modern");

function currentScheme(): Scheme {
  if (currentUi() === "terminal") return "dark";
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Tema efetivo (claro/escuro). No servidor assume escuro; o cliente corrige na hidratação. */
export const useScheme = (): Scheme => useSyncExternalStore(subscribe, currentScheme, () => "dark");

/** Escolha do usuário (sistema/claro/escuro). */
export const useAppearance = (): Appearance => useSyncExternalStore(subscribe, getAppearance, () => "system");

/** Visual escolhido (moderno/terminal). No servidor assume o moderno. */
export const useUiMode = (): UiMode => useSyncExternalStore(subscribe, currentUi, () => "modern");
