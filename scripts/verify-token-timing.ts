// A SIGNED LINK IS THE ONLY THING STANDING BETWEEN A STRANGER AND A BORROWER'S CONSENT RECORD.
//
// Two public routes authenticate with a truncated HMAC and compared it with `!==`:
//
//     app/api/unsubscribe/route.ts   t !== unsubToken(l)       16 hex chars
//     app/api/optin/route.ts         t !== optInToken(id)      16 hex chars
//
// `!==` on strings short-circuits at the first differing character, so the time to reject leaks
// how much of a guessed token is correct — the classic byte-at-a-time oracle, and these are the
// shortest tokens in the repo (lib/notify/emailCopy.ts and lib/magicLink.ts both .slice(0, 16),
// so 64 bits). /api/optin is the one route in the system that can WRITE a TCPA consent artifact;
// forging a link there manufactures evidence that Fetti may text somebody. /api/unsubscribe can
// opt a named borrower out of their own loan's follow-up.
//
// Twelve other token checks in this repo already use crypto.timingSafeEqual — lib/cardAuth.ts,
// lib/portalSession.ts, lib/hotLead.ts, lib/connect.ts, lib/leadShield.ts, lib/twilioVerify.ts,
// app/api/apply/prefill, app/api/meta/webhook, app/api/voice/ingest, app/api/voice/lookup,
// app/api/calendly/webhook, app/api/pricing/feed. These two were the outliers.
//
// WHAT THIS GUARD ASSERTS, AND WHY BOTH HALVES ARE NEEDED:
//   • BEHAVIOUR, on the real route handlers — a correct token is still accepted, a wrong one is
//     refused, and a token of the WRONG LENGTH is refused rather than crashing the route.
//     That last one is the whole risk in this fix: crypto.timingSafeEqual THROWS on unequal
//     lengths, so a constant-time rewrite without a length test turns every mistyped or
//     truncated link into a 500. A one-click unsubscribe that 500s is a CAN-SPAM problem, and
//     "I fixed the timing leak" would be the reason it broke.
//   • SOURCE — that the comparison is timingSafeEqual and not `!==`. A behavioural test cannot
//     see the difference: `===` and timingSafeEqual return the same answers. Only the source
//     says which one is running, so a regression to `!==` has to be caught by reading it.
//
// NOTHING HERE WRITES. The accept path is exercised through /api/unsubscribe GET, which is
// documented and asserted below as read-only (a link scanner's prefetch must not opt anybody
// out), and through /api/optin POST with a random UUID that cannot match a row — the route
// returns before any update. The guard sets its own CRON_SECRET so the tokens are deterministic
// and are never the production signing key.
//
//   npm run verify:token-timing
process.env.CRON_SECRET = process.env.CRON_SECRET || "verify-token-timing-fixed-test-secret";
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import { unsubToken } from "../lib/notify/emailCopy";
import { optInToken } from "../lib/magicLink";
import { GET as unsubGET, POST as unsubPOST } from "../app/api/unsubscribe/route";
import { POST as optinPOST } from "../app/api/optin/route";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
/** Assert on CODE, not on the comments that describe the defect. */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const UNSUB = "https://app.fettifi.com/api/unsubscribe";
const LEAD = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const VALID = unsubToken(LEAD);

async function unsubBody(token: string, leadId = LEAD, method: "GET" | "POST" = "GET"): Promise<{ status: number; body: string }> {
  const url = `${UNSUB}?l=${encodeURIComponent(leadId)}&t=${encodeURIComponent(token)}`;
  const req = new NextRequest(url, { method });
  const res = method === "GET" ? await unsubGET(req) : await unsubPOST(req);
  return { status: res.status, body: await res.text() };
}

async function optin(token: unknown, id: string = LEAD): Promise<{ status: number; body: any }> {
  const req = new NextRequest("https://app.fettifi.com/api/optin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, t: token }),
  });
  const res = await optinPOST(req);
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

(async () => {
  console.log(`\nSIGNED-LINK TOKENS — constant time, and the link still works\n`);

  // ── 1. THE TOKEN SHAPE THIS IS ABOUT. If either helper stops truncating, the threat model
  //      changes and the comment above goes stale — so measure it rather than assert it.
  console.log("  -- the tokens --");
  chk(/^[0-9a-f]{16}$/.test(VALID), `the unsubscribe token is 16 hex characters (${VALID.length} measured) — 64 bits, the shortest in the repo`);
  chk(/^[0-9a-f]{16}$/.test(optInToken(LEAD)), `and so is the opt-in token (${optInToken(LEAD).length} measured)`);
  chk(VALID !== optInToken(LEAD), "and they are scoped apart, so an unsubscribe link cannot grant SMS consent");

  // ── 2. THE ACCEPT PATH. A guard that only proves rejection would pass with the comparison
  //      hardcoded to false, which silently breaks every unsubscribe link in every email.
  console.log("  -- a real link still works --");
  {
    const r = await unsubBody(VALID);
    chk(r.status === 200 && /Stop follow-up emails\?/.test(r.body),
      "a correctly-signed unsubscribe link renders the confirmation page");
    chk(!/isn't valid|isn’t valid/.test(r.body), "and is not rejected");
  }
  {
    // A valid token, correct length, verified by the comparator — the route must get PAST the
    // 401 and fail later on the row lookup instead. This is the opt-in accept path, proved
    // without writing anything: the UUID matches no lead.
    const r = await optin(optInToken(LEAD));
    chk(r.status !== 401, `a correctly-signed opt-in token is accepted by the comparator (status ${r.status}, not 401)`);
    chk(r.body?.error !== "invalid link", "and the route moves on to the lead lookup rather than refusing the link");
  }

  // ── 3. THE REJECT PATH, INCLUDING THE LENGTHS THAT MAKE timingSafeEqual THROW.
  //      Buffer lengths 1, 15, 17 and 64 against a 16-byte expected value: an implementation
  //      without the length test raises ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH here, which in a
  //      route handler is a 500 — or, inside the unsubscribe handler's own try/catch, a
  //      SUCCESS page for a forged link.
  console.log("  -- wrong, short, long and empty are all refused, and none of them crash --");
  const WRONG: [string, string][] = [
    ["0000000000000000", "a wrong token of exactly the right length"],
    [VALID.slice(0, 15), "a token one character SHORT"],
    [VALID + "0", "a token one character LONG"],
    [VALID.slice(0, 1), "a single character"],
    [VALID.repeat(4), "a 64-character token"],
    ["", "an empty token"],
    [VALID.slice(0, 15) + "f", "a token differing only in the LAST character"],
    [VALID.toUpperCase(), "the right token in the wrong case"],
  ];
  for (const [tok, why] of WRONG) {
    // Deliberately not `tok !== VALID` as the premise: assert the input really is different.
    if (tok === VALID) { chk(false, `${why} — TEST BUG: the input equals the valid token`); continue; }
    let r: { status: number; body: string } | null = null;
    let threw: string | null = null;
    try { r = await unsubBody(tok); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    chk(!threw, `${why} does not throw out of the handler${threw ? ` — threw: ${threw}` : ""}`);
    chk(!!r && r.status === 200 && /isn't valid|isn’t valid/.test(r.body), `${why} is refused with the "link problem" page`);
    chk(!!r && !/You're unsubscribed|Stop follow-up emails\?/.test(r.body), `${why} reaches neither the confirmation nor the success page`);

    let o: { status: number; body: any } | null = null;
    let othrew: string | null = null;
    try { o = await optin(tok); } catch (e) { othrew = e instanceof Error ? e.message : String(e); }
    chk(!othrew, `/api/optin: ${why} does not throw${othrew ? ` — threw: ${othrew}` : ""}`);
    chk(!!o && o.status === 401 && o.body?.error === "invalid link", `/api/optin: ${why} is a 401`);
  }
  // A non-string token is what a hand-crafted POST sends. Buffer.from(123) would throw.
  for (const weird of [null, undefined, 1234567890123456, { t: VALID }, [VALID]] as unknown[]) {
    let o: { status: number; body: any } | null = null;
    let threw: string | null = null;
    try { o = await optin(weird); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    chk(!threw, `/api/optin: a non-string token (${JSON.stringify(weird) ?? "undefined"}) does not throw${threw ? ` — threw: ${threw}` : ""}`);
    chk(!!o && o.status === 401, `/api/optin: a non-string token is a 401`);
  }

  // ── 3b. THE MUTATING HANDLER REFUSES THE SAME FORGERIES. POST is the RFC 8058 one-click
  //      endpoint — a mail client posts "List-Unsubscribe=One-Click" straight to it with no human
  //      in the loop — and it is the only handler that writes. A valid-token POST is deliberately
  //      NOT exercised here: it is the one call in this file that would touch a row.
  console.log("  -- the POST handler, which is the one that writes --");
  for (const tok of ["0000000000000000", VALID.slice(0, 15), VALID + "0", ""]) {
    let r: { status: number; body: string } | null = null;
    let threw: string | null = null;
    try { r = await unsubBody(tok, LEAD, "POST"); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    chk(!threw, `POST with ${JSON.stringify(tok)} does not throw${threw ? ` — threw: ${threw}` : ""}`);
    chk(!!r && /isn't valid|isn’t valid/.test(r.body) && !/You're unsubscribed/.test(r.body),
      `POST with ${JSON.stringify(tok)} is refused and never reports an opt-out it did not record`);
  }

  // ── 4. THE TOKEN IS BOUND TO THE ID. A valid token for lead A must not unsubscribe lead B.
  console.log("  -- and the signature is bound to the lead it names --");
  {
    const r = await unsubBody(VALID, OTHER);
    chk(r.status === 200 && /isn't valid|isn’t valid/.test(r.body), "lead A's token does not open lead B's unsubscribe");
    const r2 = await unsubBody(unsubToken(OTHER), OTHER);
    chk(/Stop follow-up emails\?/.test(r2.body), "while lead B's own token does");
    const o = await optin(optInToken(OTHER), LEAD);
    chk(o.status === 401, "and lead B's opt-in token cannot grant consent for lead A");
  }

  // ── 5. SOURCE: WHICH COMPARISON IS ACTUALLY RUNNING. Behaviour cannot tell `===` from
  //      timingSafeEqual — only this can.
  console.log("  -- the comparison itself --");
  for (const [f, helper] of [["app/api/unsubscribe/route.ts", "unsubToken"], ["app/api/optin/route.ts", "optInToken"]] as const) {
    const src = code(f);
    chk(/crypto\.timingSafeEqual\(/.test(src), `${f} compares with crypto.timingSafeEqual`);
    chk(new RegExp(`t\\s*!==\\s*${helper}`).test(src) === false, `${f} no longer uses \`t !== ${helper}(…)\` — that is the leak`);
    chk(/tokenEquals\(/.test(src), `${f} routes the check through one named comparator`);
    // The length test must come BEFORE the timingSafeEqual call, or a short token throws.
    const lenAt = src.search(/a\.length !== b\.length/);
    const tseAt = src.indexOf("crypto.timingSafeEqual(");
    chk(lenAt > 0, `${f} tests the lengths`);
    chk(lenAt > 0 && tseAt > 0 && lenAt < tseAt, `${f} tests the lengths BEFORE comparing — len@${lenAt} cmp@${tseAt}`);
    chk(/a\.length === 0\) return false/.test(src), `${f} refuses an empty token rather than comparing two empty buffers (which is TRUE)`);
  }

  // ── 6. GET STILL MUTATES NOTHING. The reason the opt-out lives in POST: email security
  //      appliances and inbox prefetchers GET every link in a message to scan it, and a GET that
  //      paused nurture would silently unsubscribe engaged borrowers. This guard calls GET with
  //      a VALID token several times above, so it is also the thing that would have done that.
  {
    const whole = code("app/api/unsubscribe/route.ts");
    const getAt = whole.indexOf("export async function GET");
    const postAt = whole.indexOf("export async function POST");
    chk(getAt > 0 && postAt > getAt, "the file declares GET then POST");
    const getBody = whole.slice(getAt, postAt);
    chk(!/\.update\(|\.insert\(|\.delete\(|logActivity\(/.test(getBody),
      "and the GET handler writes nothing at all — no update, no insert, no activity row");
    chk(/\.update\(\{ raw, nurture_paused: true \}\)/.test(whole.slice(postAt)),
      "the opt-out write lives in POST, which is also the RFC 8058 one-click endpoint");
  }

  console.log("");
  if (bad) {
    console.error(`FAIL — ${bad} problem(s). A forged /api/optin link manufactures TCPA consent; a broken /api/unsubscribe link is a CAN-SPAM failure. Both are 16-byte secrets.\n`);
    process.exit(1);
  }
  console.log(`PASS — constant-time comparison, no throw on a bad length, and the real links still work.\n`);
})();
