// A SCREEN THAT ONLY REMEMBERS ITS FAILURES IS NOT A SCREEN.
//
// Ramon, 2026-08-02: "fix the unverified leads - run shield on all of them".
//
// app/api/cron/shield-sweep runs every 6 hours and scored EVERY in-scope lead — then wrote
// raw.shield only inside `if (hard || total >= qTh)`. A lead that passed had its verdict
// computed and discarded, four times a day, forever. lib/leadReality.ts returns "real" only
// when raw.shield.band === "clean" — a value nothing in the codebase ever wrote — so 166 of
// 170 drip-eligible leads read "Not yet screened by Lead Shield" while being screened
// continuously. The same shape as the heartbeat that logged success for a no-op.
//
// It matters more than a badge: as of 3779c29 the drip refuses "suspect"/"invalid" leads, so
// the verdict now decides whether a lead is worked at all.
//
//   npx tsx scripts/verify-shield-verdict.ts
import { readFileSync } from "fs";
import { leadReality } from "../lib/leadReality";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nSHIELD VERDICT — a pass is a finding\n`);

// ── 1. The sweep records a CLEAN result, not only a quarantine.
{
  const src = code("app/api/cron/shield-sweep/route.ts");
  chk(/band: total >= wTh \? "watch" : "clean"/.test(src),
    "the sweep records a band for a lead that passes — clean below the watch threshold, watch above it");
  chk(/verdict: "pass"/.test(src),
    "under the DECLARED verdict — lib/leadShield.ts:48 is \"pass\" | \"quarantine\", and 190 rows shipped carrying \"clear\", which is in neither");
  chk(/total >= wTh \? "watch"/.test(src),
    "and bands against the WATCH threshold — writing \"clean\" for everything under the QUARANTINE threshold collapsed 30-59 into clean");
  chk(/if \(!raw\.shield\)/.test(src),
    "on a FRESHLY re-read row, so a quarantine that landed since the bulk select is never overwritten by a clean band");
  chk(/cleared\+\+/.test(src) && /cleared \}/.test(src),
    "and the count is reported, so a run that clears 190 leads does not look identical to one that clears none");
}

// ── 2. A cleared record must NOT invent a Twilio lookup. leadReality reads lookup.valid and
//      lookup.lineType; a null lookup downgrades to suspect and a fabricated one asserts a
//      check that was never paid for or performed.
{
  const src = code("app/api/cron/shield-sweep/route.ts");
  const block = src.slice(src.indexOf('band: "clean"') - 400, src.indexOf('band: "clean"') + 400);
  chk(!/lookup/.test(block), "the cleared record omits `lookup` entirely rather than inventing or nulling it");
  chk(!/smsCapable/.test(block), "and omits smsCapable — false would read as 'landline, cannot text'");
}

// ── 3. The verdict actually produces "real" through the shipping function.
{
  const cleanShield = { version: 1, verdict: "clear", band: "clean", risk: 0, signals: [], channel: "api", retro: true };
  const r = leadReality({ raw: { shield: cleanShield }, name: "Dawn Engler", email: "dawn@example.com", phone: "5615550134" });
  chk(r.level === "real", `a clean band yields level "real" (got "${r.level}")`);

  // And the tiers below it still work.
  chk(leadReality({ raw: { shield: { ...cleanShield, band: "gray", verdict: "quarantine" } }, name: "x", email: "x@y.com", phone: "5615550134" }).level === "suspect",
    "a gray band is still suspect");
  chk(leadReality({ raw: { shield: { ...cleanShield, band: "junk" } }, name: "x", email: "x@y.com", phone: "5615550134" }).level === "invalid",
    "a junk band is still invalid");
  chk(leadReality({ raw: {}, name: "x", email: "x@y.com", phone: "5615550134" }).level === "unverified",
    "and no record at all is still unverified");
}

// ── 4. THE BACKFILL MUST NOT LAUNDER A LEAD THAT WAS ALREADY SUSPECT.
//      leadReality has a no-Shield fallback that flags a placeholder name or a disposable
//      address without any record. Writing band:"clean" over one of those would CLEAR a lead a
//      cheap check had already caught — the backfill would make the system less suspicious,
//      which is the opposite of what was asked for.
{
  const src = code("scripts/shield-backfill.ts");
  chk(/p\.before === "suspect" \|\| p\.before === "invalid"/.test(src),
    "the backfill refuses to upgrade a lead that already read suspect or invalid");
  chk(/l\.email \|\| l\.phone/.test(src),
    "and skips rows with neither an email nor a phone — there is no identity to screen, and 'junk' would libel a desk-created borrower");
}

// ── 5. A SCRIPT MUST LOAD .env BEFORE IT IMPORTS ANYTHING THAT READS IT.
//    ESM hoists every import above the module body, so `dotenv.config()` in the body runs
//    AFTER lib/supabaseAdminClient has already initialised — on an empty env, falling back to
//    a mock whose .upsert() does not exist. On 2026-08-02 that made a Twilio Lookup backfill
//    place all 174 PAID calls, write the results (its own client was fine), and then fail to
//    populate the 90-day cache — so the live sweep would have bought all 174 again. The part
//    that was billed worked, which is why it looked successful.
for (const f of ["scripts/shield-lookup-backfill.ts", "scripts/shield-backfill.ts"]) {
  const src = readFileSync(f, "utf8");
  const firstImport = (src.match(/^import .*$/m) || [""])[0];
  chk(/_env/.test(firstImport), `${f} imports ./_env FIRST (got: ${firstImport.slice(0, 46)})`);
  chk(!/dotenv\.config/.test(src), `${f} does not call dotenv.config in the body, where it runs too late`);
}
{
  const env = readFileSync("scripts/_env.ts", "utf8");
  chk(/NEXT_PUBLIC_SUPABASE_URL = process\.env\.SUPABASE_URL/.test(env),
    "and _env bridges SUPABASE_URL -> NEXT_PUBLIC_SUPABASE_URL, the name the admin client actually reads");
}

// ── 6. THE PAID LOOKUP MUST BE CACHED, or every sweep re-buys it.
{
  const src = readFileSync("scripts/shield-lookup-backfill.ts", "utf8");
  chk(/lookupPhone/.test(src),
    "the backfill reuses lib/leadShield.lookupPhone, so it shares the 90-day cache and the daily cap with the live sweep");
  chk(/new Set\(needing\.map/.test(src),
    "and looks up each DISTINCT number once rather than once per lead");
}

// ── 7. THE MIDDLE TIER. Shield has four bands and leadReality treats "watch" as suspect. My
//    first version of this guard asserted only that a clean band yields "real", so it passed
//    while the sweep laundered every lead scoring 30-59 — including one named "test test",
//    which scores 40. A guard that only checks the happy tier cannot see a collapsed one.
{
  const mk = (band: string) => leadReality({ raw: { shield: { band, verdict: band === "gray" || band === "junk" ? "quarantine" : "pass", risk: 40, signals: [] } }, name: "x", email: "x@y.com", phone: "5615550134" }).level;
  chk(mk("watch") === "suspect", `a watch band is suspect (got "${mk("watch")}")`);
  chk(mk("clean") === "real", "a clean band is still real");
  chk(mk("gray") === "suspect", "gray is suspect");
  chk(mk("junk") === "invalid", "junk is invalid");
}

// ── 8. ONE FACT, TWO SPELLINGS. The intake writer stores snake_case sms_capable; the lookup
//    backfill wrote camelCase smsCapable; leadReality read camel and the promote SMS gate read
//    snake. 184 records answered "undefined" — i.e. textable — for numbers the carrier had said
//    cannot receive a text.
{
  const base = { band: "clean", verdict: "pass", risk: 0, signals: [], lookup: { lineType: "landline", valid: true } };
  for (const key of ["smsCapable", "sms_capable"]) {
    const r = leadReality({ raw: { shield: { ...base, [key]: false } }, name: "x", email: "x@y.com", phone: "5615550134" }).level;
    chk(r === "suspect", `a landline flagged via ${key} reads suspect (got "${r}")`);
  }
  const shieldSrc = code("lib/leadShield.ts");
  chk(/sms_capable \?\? shield\.smsCapable/.test(shieldSrc) || /smsCapable \?\? shield\.sms_capable/.test(shieldSrc),
    "and the promote SMS gate reads both spellings too");
}

// ── 9. A FIXED VoIP IS NOT A BURNER. Non-fixed VoIP (TextNow, TextPlus — no address on file)
//    is the burner shape; fixed VoIP is ordinary cable phone service. Shield's own model prices
//    them 20 vs 10 points, and flagging both cost two real leads their nurture.
{
  const v = (lineType: string) => leadReality({ raw: { shield: { band: "clean", verdict: "pass", risk: 0, signals: [], lookup: { lineType, valid: true } } }, name: "x", email: "x@y.com", phone: "5615550134" }).level;
  chk(v("nonFixedVoip") === "suspect", "nonFixedVoip is suspect");
  chk(v("fixedVoip") === "real", `fixedVoip is NOT flagged (got "${v("fixedVoip")}")`);
  chk(v("mobile") === "real", "and a mobile is real");
}

// ── 10. THE GENERATOR. Recording clean verdicts retroactively is worthless if the intake path
//     still discards them — every new lead would start unverified again. Proven across the
//     whole database: the 9 intake-written shields were gray x7 and watch x2, zero clean, ever.
{
  const apply = code("app/api/apply/route.ts");
  chk(!/shield\.band !== "clean"/.test(apply),
    "the intake path records a clean verdict instead of skipping it");
  const digest = code("lib/notify/leadDigest.ts");
  chk(/\["watch", "gray", "junk"\]\.includes\(band\)/.test(digest),
    "and the lead digest names the BAD bands rather than inferring them from one that is not — it counted clean as junk and quarantined as good");
  const sweep = code("app/api/cron/shield-sweep/route.ts");
  chk(!/lead\.stage\.advanced/.test(sweep),
    "the sweep's engagement filter excludes our OWN outbound stage-advance — it was skipping 121 of 127 leads because our first touch had advanced them");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A verdict decides whether a lead is worked at all now; a screen that forgets its passes silently withholds that decision.\n`); process.exit(1); }
console.log(`PASS — a pass is recorded, a clean record claims no check it did not make, and the backfill cannot launder a flagged lead.\n`);
