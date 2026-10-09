import "server-only";
import { cookies } from "next/headers";
import { getAddress, type Address } from "viem";
import { signToken, verifyToken } from "./token";

export const SESSION_COOKIE = "ufv_session";
export const NONCE_COOKIE = "ufv_nonce";
const SESSION_TTL_S = 60 * 60 * 8; // 8 h

export interface Session {
  address: Address;
  chainId: number;
  iat: number;
  exp: number;
}

const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const s = verifyToken<Session>(jar.get(SESSION_COOKIE)?.value, "session");
  if (!s) return null;
  try {
    return { ...s, address: getAddress(s.address) };
  } catch {
    return null;
  }
}

export async function startSession(address: Address, chainId: number): Promise<Session> {
  const now = Math.floor(Date.now() / 1000);
  const session: Session = { address: getAddress(address), chainId, iat: now, exp: now + SESSION_TTL_S };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken({ ...session }, "session"), { ...cookieBase, maxAge: SESSION_TTL_S });
  return session;
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export const nonceCookieOptions = { ...cookieBase, maxAge: 600 };
