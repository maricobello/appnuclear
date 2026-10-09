import { Container } from "@/components/ui";

export default function Loading() {
  return (
    <Container className="py-12" aria-busy="true">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
      <div className="mt-4 h-10 w-80 animate-pulse rounded bg-surface-2" />
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <p className="mt-6 text-[14px] text-muted">Consultando NASA POWER, PVGIS, IBGE e Banco Central e rodando os modelos…</p>
    </Container>
  );
}
