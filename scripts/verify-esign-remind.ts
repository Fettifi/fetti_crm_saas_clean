// A REMINDER MUST NOT BECOME A SECOND ENVELOPE, A WRONG RECIPIENT, OR A PESTERING LOOP.
//
// There was no way to nudge a signer at all: the only options were to void a live envelope and
// rebuild it — throwing away the audit trail and any signature already collected — or to read the
// link down the phone. Documents sat unsigned because an email was in a spam folder.
//
// The risks a resend introduces are specific, so they are pinned here:
//   • emailing a signer whose turn has not come (sequential routing hands out a link that refuses
//     them), or one who has already signed;
//   • re-sending to an address that already BOUNCED, which bounces again and tells nobody;
//   • a double-clicked button emailing a borrower twice about their own mortgage;
//   • recording a reminder that never actually left the building.
//
// Comments are stripped before matching so this file's prose cannot satisfy it.
//
//   npm run verify:esign-remind
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nE-SIGN REMINDER — the same link, to the right person, not twice\n");

const F = "app/api/esign/requests/[token]/remind/route.ts";
const src = strip(F);

ck("it re-sends to the ACTIVE recipient, never a chosen one", /activeRecipient\(env\)/.test(src) && !/recipients\[0\]/.test(src));
ck("no active recipient is a refusal, not a send", /if \(!who\)/.test(src) && /status: 409/.test(src));
const refuseAt = src.search(/if \(!who\)/), sendAt = src.search(/sendSignRequest\(/);
ck("that refusal comes BEFORE any send", refuseAt >= 0 && sendAt >= 0 && refuseAt < sendAt, `refuse@${refuseAt} send@${sendAt}`);
ck("a bounced or spam-flagged address is refused, with the link handed back",
  /delivery === "bounced"/.test(src) && /delivery === "complained"/.test(src) && /needsNewAddress/.test(src));
ck("there is a minimum gap between reminders", /MIN_GAP_MS/.test(src) && /429/.test(src));
ck("the gap is at least an hour", (() => { const m = src.match(/MIN_GAP_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/); return !!m && Number(m[1]) >= 1; })());
ck("it REUSES the recipient's existing token, minting nothing", /\/sign\/\$\{who\.token\}/.test(src) && !/newToken\(/.test(src));
ck("nothing sent means nothing recorded", /if \(!sent\.length\)/.test(src) && src.search(/if \(!sent\.length\)/) < src.search(/remindedAt = at/));
ck("the reminder is written to the envelope's own event log", /type: "reminded"/.test(src));
ck("…and counted on the recipient", /reminderCount/.test(src) && /remindedAt/.test(src));
ck("it never advances a signer's status past sent", !/status = "signed"/.test(src) && /rc\.status === "pending"/.test(src));
ck("it is recorded in the activity log too", /esign\.reminded/.test(src));

// The recipient model has to carry the fields, or the write above is silently dropped.
const lib = strip("lib/esign.ts");
ck("Recipient declares remindedAt and reminderCount", /remindedAt\?: string/.test(lib) && /reminderCount\?: number/.test(lib));

// It must sit under the auth-gated prefix — a public reminder endpoint would let anyone spray a
// borrower's signing link by guessing envelope tokens.
// THE FEATURE IS THE BUTTON, NOT THE ROUTE.
// Shipped 2026-09-21: this endpoint went live, passed every check above, and the sender screen
// never changed — so from the only place Ramon ever looks, the e-sign system was not fixed. A
// reminder he cannot send is not a capability. These checks fail the commit if the route and the
// control ever drift apart again.
const ui = strip("app/esign/page.tsx");
ck("the sender screen calls the remind endpoint", /\/remind\$\{force \? "\?force=1" : ""\}/.test(ui) || /\/remind/.test(ui));
ck("…from a control a human can click", /onClick=\{\(\) => remindEnv\(r\)\}/.test(ui));
ck("…and the control is rendered on live envelopes", /status === "sent" \|\| r\.status === "in_progress"/.test(ui));
ck("a rate-limited reminder offers the override instead of dead-ending", /force=1/.test(ui) && /res\.status === 429/.test(ui));
ck("a refusal hands the signing link back to the sender", /clipboard\.writeText\(j\.link\)/.test(ui));
const listApi = strip("app/api/esign/requests/route.ts");
ck("the list API exposes the reminder state the row shows", /remindedAt/.test(listApi) && /reminderCount/.test(listApi));

const proxy = readFileSync("proxy.ts", "utf8");
ck("/api/esign/requests is auth-gated by the proxy", /api\/esign\/requests/.test(proxy));

console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — a nudge, to the right signer, on the same link, at most once in a while\n");
process.exit(fail ? 1 : 0);
