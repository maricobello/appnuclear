import { getT } from "@/i18n/server";

/** Aviso, fora do português, de que a página ainda não foi traduzida. */
export async function PtOnlyNote() {
  const { locale, d } = await getT();
  if (locale === "pt") return null;
  return (
    <p lang={locale} className="mb-6 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
      {d.common.ptOnly}
    </p>
  );
}
