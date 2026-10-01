"use client";

import useSWR from "swr";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** SWR com polling ("tempo real") e manutenção do render anterior durante refetch. */
export function useApi<T>(url: string | null, refreshMs = 60_000) {
  return useSWR<T>(url, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    keepPreviousData: true,
    dedupingInterval: 5_000,
  });
}
