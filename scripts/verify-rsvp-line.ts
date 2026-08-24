// THE RSVP PHONE LINE, DRIVEN THE WAY TWILIO DRIVES IT.
//
// Signs each request with the real Auth Token, so the deployed webhooks run their genuine
// signature gate — a test that skips the gate is testing a different endpoint than the one
// answering the phone.
//
// Uses a 555 number and a name nobody has, and DELETES the entry at the end: a guest list that
// a caterer eventually reads must never contain a probe.
//
//   npx tsx scripts/verify-rsvp-line.ts
import "./_env";
import { requireLiveDb } from "./_liveDb";
import crypto from "crypto";
import { findByPhone, removeRsvp, listRsvps } from "../lib/rsvp";

const BASE = process.env.VOICE_BASE || "https://app.fettifi.com";
const TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const FROM = "+15550001234";            // 555 — unroutable, so no human is ever texted
const NAME = "Verify Probe Guest";

let bad = 0;
const ok = (c: boolean, m: string, d = "") => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}${d ? ` — ${d}` : ""}`); if (!c) bad++; };

/** Twilio's scheme: HMAC-SHA1 over the full URL plus every POST param, sorted by key. */
function sign(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function post(path: string, params: Record<string, string>): Promise<string> {
  const url = `${BASE}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sign(url, params) },
    body: new URLSearchParams(params).toString(),
  });
  const body = await r.text();
  if (r.status !== 200) { console.error(`  (HTTP ${r.status} from ${path}) ${body.slice(0, 200)}`); }
  return body;
}

async function main() {
  await requireLiveDb("verify:rsvp-line");
  if (!TOKEN) { console.error("no TWILIO_AUTH_TOKEN — cannot sign like Twilio does"); process.exit(1); }
  console.log(`\nRSVP PHONE LINE — signed requests against ${BASE}\n`);

  // 1. the front door offers the guest list to a caller who is not a lead
  const incoming = await post("/api/voice/incoming", { From: FROM, To: "+18664933884", CallSid: "CAverify1" });
  ok(/press 1/i.test(incoming), "an unknown caller is offered the guest list");
  ok(/R S V P/i.test(incoming), "the offer says RSVP clearly enough for a phone speaker");
  ok(/<Gather[^>]*rsvp-line/.test(incoming), "the keypress goes to the RSVP line");
  ok(/<Connect><Stream/.test(incoming), "and pressing NOTHING still hands the call to Penny");

  // 2. pressing something else must not trap them
  const other = await post("/api/voice/rsvp-line?step=choose", { From: FROM, Digits: "9", CallSid: "CAverify2" });
  ok(/<Connect><Stream/.test(other) && !/Gather/.test(other), "pressing 9 goes straight to Penny");

  // 3. press 1 → asked for a name
  const chose = await post("/api/voice/rsvp-line?step=choose", { From: FROM, Digits: "1", CallSid: "CAverify3" });
  ok(/<Gather[^>]*input="speech"[^>]*step=name/.test(chose), "press 1 asks for their name");
  ok(/<Connect><Stream/.test(chose), "a silent caller is never stranded — Penny picks it up");

  // 4. name → on the list immediately, before any head count
  const named = await post("/api/voice/rsvp-line?step=name", { From: FROM, SpeechResult: `My name is ${NAME}.`, CallSid: "CAverify4" });
  ok(/numDigits="2"/.test(named), "then asks for the head count on the keypad");
  const afterName = await findByPhone(FROM);
  ok(!!afterName, "the guest is ON THE LIST before they answer the head count");
  ok(afterName?.name === NAME, "the name is cleaned of \"My name is\" and the full stop", JSON.stringify(afterName?.name));
  ok(afterName?.party_pending === true, "and is marked awaiting a count, not guessed");

  // 5. keypad → resolved
  const id = afterName?.id || "";
  const party = await post(`/api/voice/rsvp-line?step=party&id=${encodeURIComponent(id)}`, { From: FROM, Digits: "3", CallSid: "CAverify5" });
  ok(/<Hangup\/>/.test(party), "the call ends after the confirmation");
  // Penny speaks through ElevenLabs when it is up (a <Play> of generated audio) and falls back
  // to a neural <Say> when it is not. Both are correct; a guard that only knew one of them
  // failed this run for the wrong reason. What must be true is that SOMETHING is spoken, and
  // that when it is audio, the audio is really there — a <Play> pointing at a dead URL is
  // silence on the call, which is the failure this is here to catch.
  const playUrl = party.match(/<Play>([^<]+)<\/Play>/)?.[1];
  const said = /<Say[^>]*>([^<]*)<\/Say>/.exec(party)?.[1] || "";
  ok(!!playUrl || /of you|Perfect/i.test(said), "the caller hears the confirmation", playUrl ? "spoken audio" : said.slice(0, 60));
  if (playUrl) {
    const audio = await fetch(playUrl);
    const bytes = Buffer.from(await audio.arrayBuffer());
    ok(audio.ok && bytes.length > 2000, "and that audio is real, not a dead link",
      `HTTP ${audio.status}, ${(bytes.length / 1024).toFixed(0)}KB`);
  }
  const done = await findByPhone(FROM);
  ok(done?.party === 3, "the keypad set the head count", `party=${done?.party}`);
  ok(done?.party_pending === false, "and it is no longer pending");

  // 6. clean up — and prove it
  if (done) await removeRsvp(done.id);
  const gone = await findByPhone(FROM);
  ok(!gone, "the probe is removed from the guest list");
  console.log(`  (guest list now holds ${(await listRsvps()).length} real ${(await listRsvps()).length === 1 ? "entry" : "entries"})`);

  console.log(bad === 0 ? "\nALL CHECKS PASSED — a guest can phone in and hear themselves put on the list.\n" : `\n${bad} FAILED\n`);
  process.exit(bad === 0 ? 0 : 1);
}
main();
