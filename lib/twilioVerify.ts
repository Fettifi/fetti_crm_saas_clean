// Verify that an incoming webhook really came from Twilio (not a forger).
// Twilio signs each request: base64(HMAC-SHA1(authToken, URL + sorted key+value
// of POST params)) in the X-Twilio-Signature header. We recompute and compare
// timing-safe. To survive host/path variants (apex vs app, proxy rewrites), we
// accept the signature if it matches ANY plausible URL the request arrived on.
// A forger can't produce a valid HMAC without the auth token regardless of URL.
import crypto from "crypto";

export function twilioSignatureValid(
  authToken: string,
  signature: string,
  candidateUrls: string[],
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  const tail = Object.keys(params).sort().map((k) => k + params[k]).join("");
  const sigBuf = Buffer.from(signature);
  for (const url of candidateUrls) {
    const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(url + tail, "utf-8")).digest("base64");
    const expBuf = Buffer.from(expected);
    if (expBuf.length === sigBuf.length && crypto.timingSafeEqual(expBuf, sigBuf)) return true;
  }
  return false;
}

// Shared gate for every Twilio webhook. Returns null to PROCEED, or an object
// with the HTTP status to REJECT with. Fail-closed semantics:
//  • token set  → require a valid signature (rejects forged/unsigned → 403).
//  • token unset → in production this is a misconfiguration; reject 503 (Twilio
//    retries once the token is restored) rather than silently accepting forgeries.
//    In local dev (no token) we allow, so testing isn't blocked.
export function twilioGate(req: Request, candidateUrls: string[], params: Record<string, string>): { status: number } | null {
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!token) {
    const prod = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    return prod ? { status: 503 } : null;
  }
  const sig = req.headers.get("x-twilio-signature") || "";
  return twilioSignatureValid(token, sig, candidateUrls, params) ? null : { status: 403 };
}

// TWILIO SIGNS THE FULL URL, QUERY STRING INCLUDED.
//
// This helper used to rebuild the URL from a bare path, so any webhook carrying a query string
// failed its own signature check and returned 403 — to Twilio, in production. Two routes had
// already worked around it by hand (/api/voice/turn passing pathname+search, /api/voice/lo/turn
// re-appending "?n=&t=" to every candidate) and the comment there says exactly what was wrong:
// "webhookCandidateUrls drops the query". The third caller to arrive — the RSVP line, whose
// steps are ?step=name and ?step=party — walked straight into it and 403'd every caller.
//
// Fixing the helper instead of adding a third workaround. Callers may still pass a path that
// already carries its own query; that one is left exactly as given.
export function webhookCandidateUrls(req: Request, path: string): string[] {
  if (!path.includes("?")) {
    try { path += new URL(req.url).search || ""; } catch { /* keep the bare path */ }
  }
  const out: string[] = [];
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com").replace(/\/$/, "");
  out.push(base + path);
  try {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (host) out.push(`${proto}://${host}${path}`);
  } catch { /* ignore */ }
  return [...new Set(out)];
}
