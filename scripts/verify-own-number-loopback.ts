// OUR OWN NUMBER IS NOT A LEAD.
//
// 2026-08-24: an RSVP confirmation sent FROM our toll-free line came back INTO /api/sms/inbound,
// and the funnel filed our own number as a warm lead — callback task, first-touch drip queued
// at ourselves, held only by AUTOMATION_PAUSED. It sat for 24 days. Nothing distinguished the
// number we send from from a borrower's.
//
// This guard proves the predicate (lib/ownNumbers.ts) answers correctly, that the inbound
// route drops a loopback BEFORE every lead/RSVP/owner branch, that sendSms refuses to text one
// of our own numbers, and — when the database is reachable — that no lead row carries the
// number we send from today.
//
//   npm run verify:own-number-loopback
//   GUARD_ROOT=<dir> …   read the route/comms sources from another tree (used to prove it fails)
import "./_env";
import { readFileSync } from "fs";
import { join } from "path";
import { isOwnNumber, ownNumberLast10s } from "../lib/ownNumbers";

const REAL_FROM = String(process.env.TWILIO_FROM || "").replace(/\D/g, "").slice(-10);
const ROOT = process.env.GUARD_ROOT || ".";
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

async function main() {
  console.log("\nOWN-NUMBER LOOPBACK — the number we send from is never a lead\n");

  // ── 1. The predicate. Synthetic 555 numbers only; the real value is restored afterwards.
  process.env.TWILIO_FROM = "+18665550100";
  process.env.TWILIO_OWN_NUMBERS = " +1 (866) 555-0101 ,8665550102,";
  ck("TWILIO_FROM is our number in E.164", isOwnNumber("+18665550100"));
  ck("…and in display form", isOwnNumber("(866) 555-0100"));
  ck("…and as bare ten digits", isOwnNumber("8665550100"));
  ck("TWILIO_OWN_NUMBERS entries count, however they are spelled", isOwnNumber("8665550101") && isOwnNumber("+18665550102"));
  ck("a number one digit off is NOT ours", !isOwnNumber("8665550199"));
  ck("a short fragment is NOT ours (no suffix matching)", !isOwnNumber("5550100") && !isOwnNumber(""));
  ck("the set holds exactly the three configured lines", ownNumberLast10s().size === 3, String(ownNumberLast10s().size));
  process.env.TWILIO_FROM = ""; process.env.TWILIO_OWN_NUMBERS = "";
  ck("with nothing configured, nothing is ours (never a false drop)", ownNumberLast10s().size === 0 && !isOwnNumber("8665550100"));

  // ── 2. The inbound route drops a loopback before ANY branch that treats the sender as a person.
  {
    const src = code("app/api/sms/inbound/route.ts");
    const drop = src.search(/if \(digits && isOwnNumber\(digits\)\)/);
    ck("inbound route checks isOwnNumber(digits)", drop >= 0);
    const after = src.slice(drop, drop + 600);
    ck("…and answers Twilio with an empty response (no reply, no lead)", /<Response><\/Response>/.test(after) && /status: 200/.test(after));
    ck("…and logs the drop so a loopback is visible, not silent", /sms\.loopback_dropped/.test(after));
    for (const [what, re] of [
      ["the owner task-by-text branch", /digits === ownerCell/],
      ["the unmatched-sender lead insert", /source: "sms_inbound"/],
      ["the STOP suppression row", /source: "sms_optout"/],
    ] as const) {
      const at = src.search(re);
      // A branch that no longer exists cannot act on a loopback, so there is nothing to
      // order against — say so out loud rather than passing silently. (The RSVP guest
      // conversation was removed 2026-09-21 once the event was over; this guard failed on
      // its absence and was right to make someone look.)
      if (at < 0) { console.log(`  ➖ ${what} is no longer in this route — nothing to order against`); continue; }
      ck(`…before ${what}`, at > drop, `drop@${drop} branch@${at}`);
    }
  }

  // ── 3. sendSms refuses to text one of our own numbers, permanently, before reaching Twilio.
  {
    const src = code("lib/comms.ts");
    const fn = src.indexOf("export async function sendSms");
    const body = src.slice(fn);
    const refuse = body.search(/if \(isOwnNumber\(toNorm\)\) return \{[^}]*permanent: true/);
    const twilio = body.search(/await fetch\(/);
    ck("sendSms refuses when the recipient is one of our own numbers", fn >= 0 && refuse >= 0);
    ck("…as a PERMANENT failure (no retry loop), before the Twilio call", refuse >= 0 && twilio > refuse, `refuse@${refuse} twilio@${twilio}`);
  }

  // ── 4. Live: no lead row carries the number we send from.
  if (REAL_FROM.length === 10 && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabaseAdmin } = await import("../lib/supabaseAdminClient");
      const { count, error } = await (supabaseAdmin as any).from("leads").select("id", { count: "exact", head: true }).ilike("phone", `%${REAL_FROM}`);
      if (error) throw error;
      ck("no lead in the database carries our own sending number", count === 0, `${count} row(s)`);
    } catch (e: any) { ck("live lead check ran", false, e?.message || String(e)); }
  } else {
    console.log("  ⚪ live lead check skipped (no TWILIO_FROM / database in this environment)");
  }

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — a text from ourselves is dropped, a text to ourselves is refused, and no lead is us\n");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
