/**
 * GUARD: every stage that exists in the DATA must be known to the drip gates.
 *
 * The defect this exists to prevent, found 2026-10-17: `leads` carries nine distinct stage
 * strings in production — New Lead, Contacted, Engaged, Application, Submitted, Funded, Review,
 * Dead and **Client**. The canonical vocabulary in lib/leadStage.ts lists six. "Client" is in
 * none of the three lists the nurture engine consults:
 *
 *   LEAD_STAGES            (leadStage.ts)  — the six it believes exist
 *   CONVERTED_LEAD_STAGES  (inProcess.ts)  — application/submitted/funded/closed/won
 *   STOP_STAGES            (nurture.ts)    — closed/won/funded/dead/lost
 *
 * so a lead marked "Client" — a word that plainly means a customer — was drip-ELIGIBLE. It did
 * no harm on the day it was found only because all three such rows happened to carry
 * nurture_paused = true and had never been sent anything. That is luck, not a mechanism.
 *
 * THIS IS THE SAME FAILURE lib/nurture.ts ALREADY DOCUMENTS HAVING FIXED ONCE, in its own words:
 *
 *   "DONE_STAGES below tests for 'processing/underwriting/approved/clear to close' against LEAD
 *    stages, which are New Lead/Contacted/Engaged/Application/Submitted/Funded. Those
 *    vocabularies do not overlap, so that check matched ZERO of 202 leads while looking like
 *    protection."
 *
 * A guard written against a vocabulary somebody typed will drift from the vocabulary the data
 * actually uses, and the drift is invisible because both sides keep working. So this does not
 * check a list against another list — it reads the DISTINCT stages out of the live table and
 * demands that every one of them be accounted for.
 *
 *   npm run verify:stage-vocabulary
 *
 * Exit 1 = a stage exists in production that no gate recognises. Decide what it means and add it
 * to the right list; do NOT add it here to silence this.
 */
import "./_env";   // MUST be first — without it the live read below silently uses a mock and
                   // proves nothing, which is this guard's own version of the bug it checks for.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { LEAD_STAGES } from "@/lib/leadStage";
import { CONVERTED_LEAD_STAGES } from "@/lib/inProcess";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond || !detail ? "" : `\n      ${detail}`}`);
  if (!cond) failures++;
};

// Mirrors lib/nurture.ts. Kept here as a literal ON PURPOSE rather than imported: importing it
// would make this guard agree with nurture.ts by construction even if nurture.ts were wrong,
// which is the "assert the metric, not the field" rule. If these two ever disagree, the
// disagreement is the finding.
const STOP_STAGES = ["closed", "won", "funded", "dead", "lost"];
// nurture.ts skips stage "review" explicitly, before the stop-stage test.
const EXPLICITLY_HANDLED = ["review"];

const known = (stage: string): string | null => {
  const s = stage.trim().toLowerCase();
  if (!s) return null;
  if (LEAD_STAGES.some((v) => v.toLowerCase() === s)) return "LEAD_STAGES";
  if (CONVERTED_LEAD_STAGES.some((v) => s.includes(v))) return "CONVERTED_LEAD_STAGES";
  if (STOP_STAGES.some((v) => s.includes(v))) return "STOP_STAGES";
  if (EXPLICITLY_HANDLED.includes(s)) return "explicit skip in nurture.ts";
  return null;
};

console.log("\nSTAGE VOCABULARY — is every stage in the data known to the drip gates?\n");

// ── PURE CHECKS FIRST, so a broken live read cannot be mistaken for a pass ────────────────────
ok("the canonical six are recognised",
   LEAD_STAGES.every((s) => known(s) !== null));
ok("'Client' is recognised — the stage that was unknown to every gate on 2026-10-17",
   known("Client") !== null, `got ${known("Client")}`);
ok("'Dead' is recognised", known("Dead") !== null);
ok("'Review' is recognised", known("Review") !== null);
// NOT VACUOUS: a `known()` that returned a truthy string for anything would pass every row above.
ok("an invented stage is NOT recognised — this guard can fail",
   known("Marzipan") === null, `got ${known("Marzipan")}`);
ok("an empty stage is not silently recognised", known("") === null);
ok("a converted stage reports WHY it is converted",
   known("Application") === "LEAD_STAGES" || known("Application") === "CONVERTED_LEAD_STAGES");

// ── THE LIVE READ. A vocabulary check against hand-typed lists proves nothing about the data. ──
// Wrapped in main() rather than using top-level await: tsx transforms these scripts to CJS and
// rejects it outright. Caught by running it, which is the only reason this file is not a
// permanently-broken guard that nobody notices because it is never green.
async function main() {
  let stages: string[] = [];
  try {
    const { data, error } = await supabaseAdmin.from("leads").select("stage").limit(5000);
    if (error) throw new Error(error.message);
    // `new Set(...)` spread infers unknown[] here, which broke the PRODUCTION BUILD on
    // 2026-10-18: the pre-commit hook does not type-check scripts/, Vercel does, and
    // "Type 'unknown[]' is not assignable to type 'string[]'" took the whole deploy down.
    // Type the Set explicitly. Lesson recorded: npx tsc --noEmit before any push.
    stages = [...new Set<string>((data || []).map((r: any) => String(r.stage ?? "")).filter(Boolean))].sort();
  } catch (e: any) {
    // "could not read" and "nothing unknown" must never produce the same result.
    console.log(`  ✗ could not read the live stage vocabulary — ${String(e?.message).slice(0, 120)}`);
    console.log("      UNKNOWN is not clean. Fix the read before trusting this guard.\n");
    process.exit(1);
  }

  ok("the live read returned stages at all", stages.length > 0, `${stages.length} distinct`);
  const unknown = stages.filter((s) => known(s) === null);
  ok(`every one of the ${stages.length} live stages is accounted for`, unknown.length === 0,
     unknown.length ? `UNRECOGNISED: ${unknown.join(", ")}\n      ` +
       "A lead in one of these is drip-eligible unless something else happens to stop it.\n      " +
       "Decide what the stage MEANS, then add it to LEAD_STAGES (a prospect stage),\n      " +
       "CONVERTED_LEAD_STAGES (the application has happened) or STOP_STAGES (terminal)." : "");

  console.log("\n  live vocabulary:");
  for (const s of stages) console.log(`    ${s.padEnd(14)} -> ${known(s) ?? "!! UNRECOGNISED"}`);

  console.log(failures ? `\n❌ verify:stage-vocabulary — ${failures} failure(s)\n`
                       : `\n✅ verify:stage-vocabulary — every live stage is known to a gate\n`);
  process.exit(failures ? 1 : 0);
}
main();
