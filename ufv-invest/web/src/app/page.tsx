import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: { absolute: "Aferi Capital — Invista no sol" } };

export default function Home() {
  return <Landing />;
}
