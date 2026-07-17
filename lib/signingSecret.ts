// Single source of truth for the app's HMAC signing secret. It signs borrower-portal
// sessions, magic-apply links, unsubscribe/file tokens, Lead Shield tokens, connect
// links and voice-LO nonces. In PRODUCTION a missing/weak CRON_SECRET is a hard
// misconfiguration — throw rather than silently fall back to a shipped constant
// (which would let anyone forge every one of those tokens). CRON_SECRET is set in
// prod today, so this changes no resolved secret; it only removes the footgun.
export function signingSecret(): string {
  const s = process.env.CRON_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("CRON_SECRET is unset or too short — refusing to sign tokens with a fallback secret.");
  }
  // Local/dev only: keep a stable value so dev links work without a configured secret.
  return s || "dev-only-insecure-signing-secret";
}
