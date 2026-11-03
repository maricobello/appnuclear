"use client";

import { useMemo, useSyncExternalStore } from "react";
import { CARTEIRA_GD, EMPTY_CARTEIRA, type CarteiraGD, type FaturaGD, type UcGD } from "./types";

/**
 * Carteira de GD neste navegador (localStorage): faturas já lidas e UCs cadastradas.
 * Nada vai para servidor nenhum até o usuário perguntar algo à Iara — e aí só os campos
 * numéricos (sem nome, CPF ou endereço).
 */
const KEY = "sinos.gd.v1";
let listeners: (() => void)[] = [];
let memo: { raw: string; value: CarteiraGD } | null = null;

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseCarteira(raw: string): CarteiraGD {
  if (!raw) return EMPTY_CARTEIRA;
  if (memo?.raw === raw) return memo.value;
  try {
    const r = CARTEIRA_GD.safeParse(JSON.parse(raw));
    const value = r.success ? r.data : EMPTY_CARTEIRA;
    memo = { raw, value };
    return value;
  } catch {
    return EMPTY_CARTEIRA;
  }
}

export const getCarteira = (): CarteiraGD => parseCarteira(read());

function write(next: CarteiraGD) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* cheio ou modo privado */
  }
  listeners.forEach((l) => l());
}

/** Junta faturas novas; a mesma fatura (id) ou o mesmo mês da mesma UC fica com a leitura mais completa. */
export function addFaturas(novas: FaturaGD[]) {
  const cur = getCarteira();
  const byKey = new Map<string, FaturaGD>();
  const k = (f: FaturaGD) => (f.uc && f.ref ? `${f.uc}|${f.ref}` : f.id);
  for (const f of [...cur.faturas, ...novas]) {
    const prev = byKey.get(k(f));
    if (!prev || f.confianca >= prev.confianca) byKey.set(k(f), f);
  }
  write({ ...cur, faturas: [...byKey.values()].slice(-800) });
}

export function removeFatura(id: string) {
  const cur = getCarteira();
  write({ ...cur, faturas: cur.faturas.filter((f) => f.id !== id) });
}

export function upsertUc(patch: Partial<UcGD> & { uc: string }) {
  const cur = getCarteira();
  const i = cur.ucs.findIndex((u) => u.uc === patch.uc);
  const ucs = [...cur.ucs];
  if (i >= 0) ucs[i] = { ...ucs[i], ...patch, contrato: patch.contrato ? { ...ucs[i].contrato, ...patch.contrato } : ucs[i].contrato };
  else ucs.push(patch);
  const r = CARTEIRA_GD.safeParse({ ...cur, ucs });
  if (r.success) write(r.data);
}

export function clearCarteira() {
  write(EMPTY_CARTEIRA);
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

export function useCarteira(): CarteiraGD {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => parseCarteira(raw), [raw]);
}

export interface LeituraResultado {
  nome: string;
  fatura?: FaturaGD;
  trilha?: Record<string, string>;
  erro?: string;
}

/** Envia os arquivos um a um (3 em paralelo) para a leitura determinística e guarda na carteira. */
export async function lerFaturas(files: File[], headers: Record<string, string> = {}, onProgress?: (feitos: number, total: number) => void): Promise<LeituraResultado[]> {
  const out: LeituraResultado[] = new Array(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      try {
        const fd = new FormData();
        fd.append("arquivo", f, f.name);
        const res = await fetch("/api/gd/faturas", { method: "POST", body: fd, headers });
        const j = (await res.json().catch(() => ({}))) as { faturas?: LeituraResultado[]; error?: string };
        out[i] = res.ok && j.faturas?.[0] ? j.faturas[0] : { nome: f.name, erro: j.error ?? `HTTP ${res.status}` };
      } catch {
        out[i] = { nome: f.name, erro: "sem conexão com o servidor" };
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  const ok = out.filter((r) => r.fatura).map((r) => r.fatura!);
  if (ok.length) addFaturas(ok);
  return out;
}

export async function lerTexto(texto: string, nome = "texto colado"): Promise<LeituraResultado> {
  try {
    const res = await fetch("/api/gd/faturas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto, nome }) });
    const j = (await res.json().catch(() => ({}))) as { faturas?: LeituraResultado[]; error?: string };
    const r = res.ok && j.faturas?.[0] ? j.faturas[0] : { nome, erro: j.error ?? `HTTP ${res.status}` };
    if (r.fatura) addFaturas([r.fatura]);
    return r;
  } catch {
    return { nome, erro: "sem conexão com o servidor" };
  }
}
