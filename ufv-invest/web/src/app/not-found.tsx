import Link from "next/link";
import { buttonClass, Container } from "@/components/ui";

export default function NotFound() {
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl font-semibold">Página não encontrada</h1>
      <p className="mt-3 text-ink-2">A usina ou página que você procura não existe.</p>
      <Link href="/usinas" className={`${buttonClass.primary} mt-8`}>
        Ver usinas
      </Link>
    </Container>
  );
}
