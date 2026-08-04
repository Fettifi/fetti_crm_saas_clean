import "./_env"; // MUST be first — see scripts/_env.ts
// VERIFY: the stalled-file worklist surface.
//
// What this guards, and why each check exists:
//
//  1. ONE SOURCE OF TRUTH. The board and the daily email must rank identically. The
//     failure mode is not a crash — it is a slow drift where someone "simplifies" the
//     API route to sort by `days`, and six weeks later the email says call Dominic
//     while the screen says call someone else, with nobody able to say which is right.
//     This repo has already been bitten by exactly that shape (a PDF and a public
//     letter rendering the same data from two lists, printing 18 rows vs 8). So the
//     route is checked to CALL findStalledFiles/nextAction rather than re-derive.
//
//  2. THE HARD RULE: never write to loan_files. Staleness is measured off
//     loan_files.updated_at, so ANY write — even a harmless "viewed_at" — makes a
//     50-day-cold file look worked today and permanently destroys the signal. This is
//     proved against the live table, not asserted: updated_at is snapshotted, the real
//     read path runs, and the snapshot must come back byte-identical.
//
//  3. A FAILED LOAD MUST NOT RENDER AS "ALL CLEAR". The entire feature exists because
//     silence was being read as health. If the panel's error branch ever collapses
//     into the empty-state branch, the bug reappears wearing a green checkmark.
//
//  4. RANK ORDER IS ACTUALLY APPLIED. severityOf() puts the flag in the high digit so
//     "the borrower is waiting on US" always outranks "this file is merely old". A
//     max() refactor would collapse those and bury the person closest to funding.
//
// Every check runs against the REAL module and the REAL database. Nothing here is
// mocked, and a mock Supabase client is a hard failure rather than a silent pass.
import { readFileSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { findStalledFiles, severityOf, isTerminal, nextAction, type StaleFile } from "../lib/stalledFiles";

const ROOT = process.cwd();
let failures = 0;
const fail = (msg: string) => { failures++; console.error("  ✗ " + msg); };
const pass = (msg: string) => console.log("  ✓ " + msg);

// ── 0. Refuse to "pass" against a mock client ────────────────────────────────
// A mock admin client returns empty data for everything, which would make checks
// 2 and 5 below pass vacuously — the exact way a guard reads a mock and reports green.
function assertRealClient() {
  console.log("\n[0] the Supabase client is real, not the mock fallback");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — every DB check below would pass vacuously");
    return false;
  }
  if (typeof (supabaseAdmin as any)?.from !== "function") {
    fail("supabaseAdmin has no .from() — this is the mock client");
    return false;
  }
  pass("real service-role client configured");
  return true;
}

// ── 1. The route renders the shared logic; it does not re-derive it ──────────
function checkSingleSourceOfTruth() {
  console.log("\n[1] /api/los/stalled renders lib/stalledFiles — it does not reimplement it");
  const p = join(ROOT, "app/api/los/stalled/route.ts");
  let src = "";
  try { src = readFileSync(p, "utf8"); } catch { fail(`cannot read ${p}`); return; }

  if (!/from\s+["']@\/lib\/stalledFiles["']/.test(src)) fail("route does not import @/lib/stalledFiles");
  else pass("imports @/lib/stalledFiles");

  if (!/findStalledFiles\s*\(/.test(src)) fail("route never calls findStalledFiles() — it is computing staleness itself");
  else pass("calls findStalledFiles()");

  if (!/nextAction\s*\(/.test(src)) fail("route never calls nextAction() — the board and the email would advise differently");
  else pass("calls nextAction() so the board and the digest give the same instruction");

  // The route must not re-sort. findStalledFiles already returns severity order; a
  // .sort() here is the drift this check exists to catch.
  if (/\.sort\s*\(/.test(src)) fail("route re-sorts the list — ranking must stay in findStalledFiles()");
  else pass("no re-sort: server ranking is passed through untouched");

  const client = join(ROOT, "components/StalledWorklist.tsx");
  let ui = "";
  try { ui = readFileSync(client, "utf8"); } catch { fail(`cannot read ${client}`); return; }
  if (/\.sort\s*\(/.test(ui)) fail("StalledWorklist re-sorts client-side — it would disagree with the email digest");
  else pass("StalledWorklist renders the server order as given");

  // Staleness thresholds must not be duplicated in the client. A second copy of
  // "7 / 14 / 30" is a constant that will be tuned in one place and not the other.
  if (/\b(?:>=|>)\s*(?:7|14|30)\b/.test(ui.replace(/`[^`]*`/g, "")))
    fail("StalledWorklist appears to re-derive a day threshold — thresholds live only in lib/stalledFiles");
  else pass("no duplicated day thresholds in the client");
}

// ── 2. THE HARD RULE — the read path must not touch loan_files.updated_at ────
async function checkNoWrites() {
  console.log("\n[2] HARD RULE: reading the worklist never writes to loan_files");
  const snap = async () => {
    const { data, error } = await supabaseAdmin
      .from("loan_files").select("id, updated_at").order("id").limit(2000);
    // Destructure the error — a select against a missing column returns null, not a
    // throw, and a swallowed error here would read as "no files" and pass vacuously.
    if (error) { fail(`loan_files snapshot failed: ${error.message}`); return null; }
    return (data || []).map((r: any) => `${r.id}:${r.updated_at}`).join("|");
  };

  const before = await snap();
  if (before === null) return;
  if (!before.length) { fail("loan_files is empty — this check would prove nothing"); return; }

  await findStalledFiles(); // the exact call the API route makes

  const after = await snap();
  if (after === null) return;
  if (before !== after) fail("loan_files.updated_at CHANGED across a read — the staleness signal is being destroyed");
  else pass(`updated_at identical across ${before.split("|").length} files before/after the read`);
}

// ── 3. The error state must not look like the healthy state ─────────────────
function checkFailClosed() {
  console.log("\n[3] a failed load renders as a warning, never as 'nothing is stale'");
  const p = join(ROOT, "components/StalledWorklist.tsx");
  let ui = "";
  try { ui = readFileSync(p, "utf8"); } catch { fail(`cannot read ${p}`); return; }

  if (!/setErr\(/.test(ui)) fail("no error state at all — a fetch failure would render the empty/success branch");
  else pass("fetch failures set an explicit error state");

  // The error branch must return BEFORE the success/empty branch, or it never renders.
  const errIdx = ui.indexOf("if (err)");
  const emptyIdx = ui.indexOf("if (!files.length)");
  if (errIdx === -1) fail("no `if (err)` early return in the render path");
  else if (emptyIdx === -1) fail("no empty-state branch found — cannot prove ordering");
  // Guard against the -1 < n trap: both indices are confirmed present above.
  else if (errIdx > emptyIdx) fail("the empty state renders BEFORE the error state — a failed load shows as an all-clear");
  else pass("the error branch returns before the empty state");

  if (!/not\*{0,2}\s*<?\/?b?>?\s*an all-clear|not<\/b> an all-clear/i.test(ui))
    console.log("  · note: error copy should say explicitly that it is not an all-clear");
  else pass("error copy states it is not an all-clear");
}

// ── 4. Ranking: "waiting on us" always beats "merely old" ───────────────────
function checkRanking() {
  console.log("\n[4] severity ranking puts the blocked borrower above the older file");
  // A borrower who delivered docs on a merely-WARM file must outrank a FROZEN file
  // we already answered. This is the collapse a max() refactor would cause.
  const blockedWarm = severityOf("warm", "awaiting_us");
  const answeredFrozen = severityOf("frozen", null);
  if (!(blockedWarm > answeredFrozen))
    fail(`awaiting_us/warm (${blockedWarm}) does not outrank frozen/none (${answeredFrozen}) — the blocked borrower gets buried`);
  else pass(`awaiting_us/warm (${blockedWarm}) > frozen/none (${answeredFrozen})`);

  const neverContactedWarm = severityOf("warm", "no_outreach");
  if (!(neverContactedWarm > answeredFrozen))
    fail("no_outreach does not outrank an old-but-answered file");
  else pass(`no_outreach/warm (${neverContactedWarm}) > frozen/none (${answeredFrozen})`);

  // Within the same flag, older still wins.
  if (!(severityOf("frozen", "awaiting_us") > severityOf("warm", "awaiting_us")))
    fail("age does not break ties within the same flag");
  else pass("age breaks ties within the same flag");

  // Terminal files are finished, not stalled.
  if (!isTerminal("Funded") || !isTerminal("closed") || isTerminal("Processing"))
    fail("isTerminal() misclassifies — funded/closed files would show up as stalled");
  else pass("terminal stages excluded (funded/closed in, processing out)");
}

// ── 5. Against live data: the list is real, ordered, and actionable ─────────
async function checkLive() {
  console.log("\n[5] live pipeline: the worklist is ordered and every row has a next move");
  let stale: StaleFile[] = [];
  try { stale = await findStalledFiles(); } catch (e: any) { fail(`findStalledFiles threw: ${e?.message}`); return; }

  console.log(`  · ${stale.length} open files are quiet ≥7d` +
    (stale.length ? ` (oldest ${Math.max(...stale.map((f) => f.days))}d)` : ""));

  if (!stale.length) {
    console.log("  · pipeline is clean — ordering/action checks skipped (nothing to order)");
    return;
  }

  // Descending severity, no exceptions.
  for (let i = 1; i < stale.length; i++) {
    if (stale[i - 1].severity < stale[i].severity) {
      fail(`row ${i} (sev ${stale[i].severity}) outranks row ${i - 1} (sev ${stale[i - 1].severity}) — list is not sorted worst-first`);
      break;
    }
  }
  if (!failures) pass("sorted worst-first by severity");

  // Every row must carry a concrete next move, or the worklist just relocates the decision.
  const mute = stale.filter((f) => !nextAction(f).trim());
  if (mute.length) fail(`${mute.length} files have no next action`);
  else pass("every file has a next action");

  const blocked = stale.filter((f) => f.flag === "awaiting_us" || f.flag === "no_outreach");
  if (blocked.length) {
    console.log(`  · ${blocked.length} borrowers are waiting on US:`);
    for (const f of blocked.slice(0, 6))
      console.log(`      ${f.borrower_name || f.file_number} — ${f.days}d quiet, ${f.docsDelivered} docs delivered, ${f.flag}`);
    // They must occupy the head of the list.
    const firstUnblocked = stale.findIndex((f) => f.flag !== "awaiting_us" && f.flag !== "no_outreach");
    const lastBlocked = stale.map((f) => f.flag === "awaiting_us" || f.flag === "no_outreach").lastIndexOf(true);
    if (firstUnblocked !== -1 && lastBlocked > firstUnblocked)
      fail("a blocked borrower is ranked below an unblocked file");
    else pass("all blocked borrowers sit at the head of the list");
  }
}

(async () => {
  console.log("VERIFY: stalled-file worklist (/api/los/stalled + components/StalledWorklist)");
  const real = assertRealClient();
  checkSingleSourceOfTruth();
  checkFailClosed();
  checkRanking();
  if (real) {
    await checkNoWrites();
    await checkLive();
  } else {
    console.log("\n[2][5] SKIPPED — no real DB client (counted as a failure above)");
  }

  console.log(failures ? `\nFAILED — ${failures} problem(s)\n` : "\nPASS — worklist is one source of truth, read-only, and fails loudly\n");
  process.exit(failures ? 1 : 0);
})();
