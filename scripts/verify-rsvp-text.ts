// TEXT-TO-RSVP, DRIVEN THE WAY TWILIO DRIVES IT.
//
// Signed webhooks against the REAL /api/sms/inbound — same doctrine as verify:rsvp-line: a test
// that skips the signature gate is testing a different endpoint than the one guests reach.
//
//   npm run verify:rsvp-text                 # against production
//   RSVP_BASE=http://localhost:3200 npm run verify:rsvp-text
//
// Probe numbers are FICTIONAL 555 lines and every probe is deleted at the end and re-read to
// prove it is gone — the guest list is a real document Ramon and Piaget read.
import "./_env";
import crypto from "crypto";
import { listRsvps, removeRsvp, last10 } from "../lib/rsvp";

const BASE = process.env.RSVP_BASE || "https://app.fettifi.com";
const TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const URL_ = `${BASE}/api/sms/inbound`;

// Fictional, unroutable numbers. Never a real contact.
const A = "+15550101101";
const B = "+15550101102";
const C = "+15550101103";
const D = "+15550101104";
const PROBES = [A, B, C, D].map(last10);

let fail = 0;
const ck = (n: string, ok: boolean, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? ` — ${d}` : ""}`); };

function sign(url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function sms(from: string, body: string): Promise<string> {
  const params: Record<string, string> = { From: from, To: "+18664933884", Body: body, MessageSid: `SM${crypto.randomBytes(16).toString("hex")}` };
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sign(URL_, params) },
    body: new URLSearchParams(params).toString(),
  });
  const text = await r.text();
  if (r.status !== 200) return `HTTP ${r.status}: ${text.slice(0, 120)}`;
  return (text.match(/<Message>([\s\S]*?)<\/Message>/) || ["", ""])[1];
}

const onList = async (phone: string) => (await listRsvps()).find((x) => last10(x.phone) === last10(phone)) || null;

(async () => {
  if (!TOKEN) { console.error("no TWILIO_AUTH_TOKEN — cannot sign like Twilio does"); process.exit(1); }
  console.log(`\nTEXT-TO-RSVP — signed requests against ${BASE}\n`);

  const before = await listRsvps();
  console.log(`  guest list holds ${before.length} entr${before.length === 1 ? "y" : "ies"} before this run\n`);

  console.log("the bare code parks you on the list and asks for details:");
  let reply = await sms(A, "RSVP");
  ck("texting RSVP is answered", !!reply && !reply.startsWith("HTTP"), reply.slice(0, 90));
  ck("the answer asks for a name and a head count", /name/i.test(reply) && /how many|coming/i.test(reply));
  let e = await onList(A);
  ck("the guest is ON THE LIST immediately", !!e);
  ck("under a placeholder — a name is never invented", !!e && /name pending/i.test(e.name), e?.name);
  ck("and marked awaiting a count, not guessed", !!e?.party_pending);

  console.log("\ntheir reply fills in BOTH the name and the count:");
  reply = await sms(A, "Jordan Pike, 3");
  e = await onList(A);
  ck("the name is set from the reply", e?.name === "Jordan Pike", e?.name);
  ck("the head count is set", e?.party === 3, String(e?.party));
  ck("no longer pending", !e?.party_pending);
  ck("and they are told so", /3/.test(reply), reply.slice(0, 90));

  console.log("\nname and count in ONE text confirms on the spot:");
  reply = await sms(B, "RSVP Dana Reyes 2");
  e = await onList(B);
  ck("on the list with the name given", e?.name === "Dana Reyes", e?.name);
  ck("party of 2, nothing pending", e?.party === 2 && !e?.party_pending, `party=${e?.party} pending=${e?.party_pending}`);
  ck("confirmed in the reply", /2/.test(reply), reply.slice(0, 90));

  console.log("\na name with no number asks for the number:");
  reply = await sms(C, "RSVP Sam Whitfield");
  e = await onList(C);
  ck("on the list under their name", e?.name === "Sam Whitfield", e?.name);
  ck("awaiting the count", !!e?.party_pending);
  ck("the reply asks for it", /how many/i.test(reply), reply.slice(0, 90));
  reply = await sms(C, "just me");
  e = await onList(C);
  ck("a worded answer sets it", e?.party === 1 && !e?.party_pending, `party=${e?.party}`);

  console.log("\na regret is recorded, and never chased:");
  reply = await sms(D, "RSVP no, we can't make it");
  e = await onList(D);
  ck("recorded as a decline", e?.status === "no", e?.status);
  ck("acknowledged warmly", /miss|thank/i.test(reply), reply.slice(0, 90));

  console.log("\nA GUEST IS NOT A LEAD — and a lead is not a guest:");
  const mortgage = await sms("+15550101999", "What's my rate?");
  const stray = await onList("+15550101999");
  ck("a mortgage question does NOT reach the guest list", !stray, stray ? `added "${stray.name}"` : "");
  ck("…and is answered by the funnel, not the wedding", !/vow|renewal|guest list/i.test(mortgage), mortgage.slice(0, 70));
  const rsvpish = await sms("+15550101998", "I'll rsvp to that open house later");
  const stray2 = await onList("+15550101998");
  ck("the word rsvp MID-SENTENCE is not an RSVP", !stray2, stray2 ? `added "${stray2.name}"` : "");

  // CLEAN UP AND PROVE IT. Count first so the check measures the gate, not the cleanup.
  console.log("\ncleanup:");
  const during = await listRsvps();
  const mine = during.filter((x) => PROBES.includes(last10(x.phone)) || ["5550101999", "5550101998"].includes(last10(x.phone)));
  for (const m of mine) await removeRsvp(m.id);
  const after = await listRsvps();
  const left = after.filter((x) => PROBES.concat(["5550101999", "5550101998"]).includes(last10(x.phone)));
  ck(`all ${mine.length} probe(s) removed`, left.length === 0, left.map((x) => x.name).join(", "));
  ck("the real guest list is untouched", after.length === before.length, `${before.length} → ${after.length}`);

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : `\n✅ ALL PASSED — a guest can text ${"RSVP"} and land on the list\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
