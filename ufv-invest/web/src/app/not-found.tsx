import Link from "next/link";
import { buttonClass, Container } from "@/components/ui";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const { d } = await getT();
  return (
    <Container className="py-24 text-center">
      <h1 className="text-3xl font-semibold">{d.nf.title}</h1>
      <p className="mt-3 text-ink-2">{d.nf.text}</p>
      <Link href="/usinas" className={`${buttonClass.primary} mt-8`}>
        {d.nf.cta}
      </Link>
    </Container>
  );
}
