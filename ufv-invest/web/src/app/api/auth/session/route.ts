import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  const s = await getSession();
  return NextResponse.json(s ? { address: s.address, exp: s.exp } : { address: null }, { headers: { "Cache-Control": "no-store" } });
}
