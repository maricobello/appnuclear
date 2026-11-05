"use client";

import useSWR, { useSWRConfig } from "swr";
import { useBusyFlag } from "./busy";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * SWR com polling ("tempo real") e manutenção do render anterior durante refetch. O intervalo
 * pode depender da última resposta (ex.: voltar logo quando ela veio incompleta).
 */
/**
 * `veil: false` deixa o véu global de fora (para uma consulta secundária e lenta, que mostra
 * o próprio aviso com `trocando`).
 */
export function useApi<T>(url: string | null, refreshMs: number | ((data: T | undefined) => number) = 60_000, opts: { veil?: boolean } = {}) {
  const res = useSWR<T>(url, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });
  // véu de carregamento só quando o usuário trocou o que pede: a tela ainda mostra o dado da
  // URL anterior (keepPreviousData) e a URL atual não tem dado próprio no cache. A
  // revalidação de fundo da mesma URL e a volta a uma URL já carregada não ligam o véu.
  const { cache } = useSWRConfig();
  const temProprio = !!url && cache.get(url)?.data !== undefined;
  const trocando = !!url && res.isValidating && res.data !== undefined && !temProprio;
  useBusyFlag(opts.veil !== false && trocando);
  // o objeto do SWR rastreia o que é lido por getters: acrescenta o campo sem espalhar o objeto
  Object.defineProperty(res, "trocando", { value: trocando, configurable: true, enumerable: false });
  return res as typeof res & { readonly trocando: boolean };
}
