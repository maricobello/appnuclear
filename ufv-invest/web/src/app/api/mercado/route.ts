import { NextResponse } from "next/server";
import { getMarketRates } from "@/lib/sources";

export async function GET() {
  const rates = await getMarketRates();
  return NextResponse.json(rates, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } });
}
