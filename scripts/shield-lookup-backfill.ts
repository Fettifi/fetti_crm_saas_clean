// CARRIER-VERIFY THE PHONE ON EVERY LEAD.
//
// Ramon, 2026-08-02: "run the twilio lookup on all of them".
//
// The free-signal backfill cleared 190 leads, but "clean" there means "passed the name/email/
// pattern checks" — not "this is a reachable mobile". lib/leadReality.ts asks the carrier for
// the rest: lookup.valid === false makes a lead INVALID, and a VoIP/virtual lineType or
// smsCapable === false makes it SUSPECT. Without a lookup those branches are unreachable, so
// a burner VoIP number reads exactly like a real mobile.
//
// It reuses lib/leadShield.lookupPhone so the 90-day cache and the daily budget cap are the
// same ones the live sweep uses — a number verified here is free for the sweep afterwards,
// and re-running this costs nothing for anything already checked.
//
// COST: Twilio Lookup v2 line_type_intelligence, $0.005 per NEW number. Cached and duplicate
// numbers are free. The dry run prints the exact spend before anything is called.
//
//   npx tsx scripts/shield-lookup-backfill.ts          # count + cost, no API calls
//   npx tsx scripts/shield-lookup-backfill.ts --apply  # run the lookups
import "./_env";
import { createClient } from "@supabase/supabase-js";
import { lookupPhone } from "../lib/leadShield";
import { leadReality } from "../lib/leadReality";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");
const PRICE_PER_LOOKUP = 0.005;

const digits = (p: any) => String(p || "").replace(/\D/g, "").slice(-10);

(async () => {
  let leads: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("leads").select("id, full_name, email, phone, stage, nurture_paused, raw").range(f, f + 999);
    if (error) throw new Error(error.message);
    leads = leads.concat(data || []);
    if ((data || []).length < 1000) break;
  }

  const withPhone = leads.filter((l) => digits(l.phone).length === 10 && !/@fetti-internal\.test$/i.test(String(l.email || "")));
  const needing = withPhone.filter((l) => !l.raw?.shield?.lookup);
  // One API call per distinct NUMBER, not per lead — duplicates share the answer.
  const distinct = [...new Set(needing.map((l) => digits(l.phone)))];

  console.log(`\nleads with a usable phone      : ${withPhone.length}`);
  console.log(`already carry a lookup         : ${withPhone.length - needing.length}`);
  console.log(`leads needing one              : ${needing.length}`);
  console.log(`DISTINCT numbers to look up    : ${distinct.length}`);
  console.log(`max spend (cache misses only)  : $${(distinct.length * PRICE_PER_LOOKUP).toFixed(2)}`);

  if (!APPLY) { console.log(`\nDRY RUN — no API calls made. Re-run with --apply.\n`); return; }

  // Look up each distinct number ONCE, then fan the result out to every lead that shares it.
  const byNumber = new Map<string, any>();
  let called = 0, failed = 0;
  for (const p of distinct) {
    const lu = await lookupPhone(p);
    if (lu) { byNumber.set(p, lu); called++; } else { failed++; }
    if (called % 25 === 0 && called) console.log(`   … ${called}/${distinct.length}`);
  }
  console.log(`\nlookups returned: ${called}   no result (cap/disabled/error): ${failed}`);

  let written = 0;
  const moves: Record<string, number> = {};
  for (const l of needing) {
    const lu = byNumber.get(digits(l.phone));
    if (!lu) continue;
    // Concurrency-safe: re-read the freshest raw, merge only inside shield.
    const { data: fresh } = await sb.from("leads").select("raw").eq("id", l.id).maybeSingle();
    const raw = ((fresh as any)?.raw && typeof (fresh as any).raw === "object" ? { ...(fresh as any).raw } : {}) as any;
    const shield = { ...(raw.shield || {}) };
    shield.lookup = lu;
    // smsCapable is what the send gates read. A landline, an invalid number or a
    // non-messageable type cannot receive a text no matter how clean the name looked.
    if (lu.lineType === "landline" || !lu.valid || ["tollFree", "premium", "pager", "voicemail", "invalid"].includes(lu.lineType)) {
      shield.smsCapable = false;
    } else if (lu.lineType === "mobile") {
      shield.smsCapable = true;
    }
    raw.shield = shield;
    const before = leadReality({ raw: l.raw, name: l.full_name, email: l.email, phone: l.phone }).level;
    const after = leadReality({ raw, name: l.full_name, email: l.email, phone: l.phone }).level;
    moves[`${before} -> ${after}`] = (moves[`${before} -> ${after}`] || 0) + 1;
    const { error } = await sb.from("leads").update({ raw }).eq("id", l.id);
    if (!error) written++;
  }

  console.log(`\nrecorded on ${written} leads. Transitions:`);
  for (const [k, v] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(4) + "  " + k);

  const types: Record<string, number> = {};
  for (const lu of byNumber.values()) types[`${lu.lineType}${lu.valid === false ? " (INVALID)" : ""}`] = (types[`${lu.lineType}${lu.valid === false ? " (INVALID)" : ""}`] || 0) + 1;
  console.log(`\nline types seen:`);
  for (const [k, v] of Object.entries(types).sort((a, b) => b[1] - a[1])) console.log("   " + String(v).padStart(4) + "  " + k);
  console.log(`\nactual spend: $${(called * PRICE_PER_LOOKUP).toFixed(2)} (cache hits were free)\n`);
})();
