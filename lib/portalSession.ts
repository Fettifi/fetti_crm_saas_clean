import crypto from "crypto";
import { signingSecret } from "@/lib/signingSecret";

// Borrower-portal auth primitives. The portal has no Supabase auth session, so we
// mint our own: verify-otp sets a signed, httpOnly cookie (HMAC of leadId+expiry)
// that the server validates on every data read — the client can no longer authorize
// itself by writing a leadId into localStorage. Same trust model / secret as the
// magic-apply + unsubscribe + file links (CRON_SECRET).
const SECRET = signingSecret() + ":portal";
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14-day session

export const PORTAL_COOKIE = "fetti_portal";

// One-way hash for the 6-digit access code, so the code is never stored in plaintext
// (a DB read no longer leaks a working login code).
export function hashOtp(code: string): string {
  return crypto.createHmac("sha256", SECRET + ":otp").update(String(code)).digest("hex");
}

export function signPortalSession(leadId: string): string {
  const payload = `${leadId}.${Date.now() + TTL_MS}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

// Returns the authorized leadId, or null if the token is missing/forged/expired.
export function verifyPortalSession(token: string | undefined | null): string | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [leadId, expStr, sig] = parts;
  const expect = crypto.createHmac("sha256", SECRET).update(`${leadId}.${expStr}`).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return null;
  return leadId;
}

// Constant-time compare for the hashed OTP.
export function otpMatches(submitted: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashOtp(submitted)), b = Buffer.from(String(storedHash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
