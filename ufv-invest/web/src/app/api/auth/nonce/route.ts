import { NextResponse } from "next/server";
import { NONCE_COOKIE, nonceCookieOptions } from "@/lib/auth/session";
import { randomNonce, signToken } from "@/lib/auth/token";

export async function GET() {
  const nonce = randomNonce();
  const exp = Math.floor(Date.now() / 1000) + 600;
  const res = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(NONCE_COOKIE, signToken({ nonce, exp }, "siwe-nonce"), nonceCookieOptions);
  return res;
}
