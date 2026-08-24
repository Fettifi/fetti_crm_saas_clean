// A WEBHOOK MUST VERIFY THE URL TWILIO ACTUALLY SIGNED — QUERY STRING AND ALL.
//
// webhookCandidateUrls rebuilt the URL from a bare path and dropped the query, so every webhook
// carrying one rejected Twilio's own requests with 403. Two routes had hand-rolled workarounds;
// the third (the RSVP phone line, ?step=name / ?step=party) 403'd every caller instead. Proved
// against production before this guard existed.
//
//   npx tsx scripts/verify-twilio-signature.ts
import crypto from "crypto";
import { webhookCandidateUrls, twilioSignatureValid } from "../lib/twilioVerify";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const TOKEN = "test-token-not-a-secret";
let bad = 0;
const ok = (c: boolean, m: string, d = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}${d ? ` — ${d}` : ""}`); if (!c) bad++; };

const sign = (url: string, params: Record<string, string>) =>
  crypto.createHmac("sha1", TOKEN)
    .update(Buffer.from(url + Object.keys(params).sort().map((k) => k + params[k]).join(""), "utf-8"))
    .digest("base64");

console.log("\nTWILIO SIGNATURE — the signed URL includes the query string\n");

for (const [path, label] of [
  ["/api/voice/rsvp-line?step=name", "the RSVP line's name step"],
  ["/api/voice/rsvp-line?step=party&id=r_123_abc", "the RSVP line's head-count step"],
  ["/api/voice/lo/turn?n=3&t=abc", "the loan-officer turn (its workaround is now removed)"],
  ["/api/sms/inbound", "a webhook with no query at all"],
] as [string, string][]) {
  const url = APP + path;
  const params = { From: "+15550001234", Digits: "3", CallSid: "CAtest" };
  const req = new Request(url, { method: "POST" });
  const cands = webhookCandidateUrls(req, path.split("?")[0]);
  ok(cands.includes(url), `${label}: the real URL is among the candidates`, cands[0]);
  ok(twilioSignatureValid(TOKEN, sign(url, params), cands, params), `${label}: Twilio's own signature verifies`);
}

// And the whole point of the gate: a forgery still fails.
{
  const url = APP + "/api/voice/rsvp-line?step=party&id=r_1";
  const params = { From: "+15550001234", Digits: "9" };
  const req = new Request(url, { method: "POST" });
  const cands = webhookCandidateUrls(req, "/api/voice/rsvp-line");
  ok(!twilioSignatureValid(TOKEN, sign(url, { ...params, Digits: "1" }), cands, params),
    "a signature over DIFFERENT params is still rejected");
  ok(!twilioSignatureValid(TOKEN, "not-a-signature", cands, params), "garbage is rejected");
}

console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
