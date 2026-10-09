import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getT();
  return { title: { absolute: d.lp.title } };
}

export default function Home() {
  return <Landing />;
}
