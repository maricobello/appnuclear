"use client";

import { buttonClass, Container } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl font-semibold">Algo deu errado</h1>
      <p className="mt-3 text-ink-2">Não foi possível carregar esta página agora. Tente novamente em instantes.</p>
      <button onClick={reset} className={`${buttonClass.primary} mt-8`}>
        Tentar de novo
      </button>
    </Container>
  );
}
