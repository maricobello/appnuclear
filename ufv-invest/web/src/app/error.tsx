"use client";

import { buttonClass, Container } from "@/components/ui";
import { useT } from "@/i18n/client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { d } = useT();
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl font-semibold">{d.err.title}</h1>
      <p className="mt-3 text-ink-2">{d.err.text}</p>
      <button onClick={reset} className={`${buttonClass.primary} mt-8`}>
        {d.err.retry}
      </button>
    </Container>
  );
}
