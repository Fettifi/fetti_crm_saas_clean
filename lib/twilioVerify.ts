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

export function webhookCandidateUrls(req: Request, path: string): string[] {
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
