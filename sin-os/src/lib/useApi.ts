"use client";

import useSWR from "swr";

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
export function useApi<T>(url: string | null, refreshMs: number | ((data: T | undefined) => number) = 60_000) {
  return useSWR<T>(url, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });
}
