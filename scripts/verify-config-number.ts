// A SETTING THE WRITER ACCEPTS AS ZERO MUST STILL BE ZERO WHEN IT IS READ BACK.
//
// 2026-10-15. app/api/settings/margin/route.ts validates the loan margin as `pct < 0 || pct > 100`
// — so 0 is admitted ON PURPOSE — writes the string "0" into app_settings, and answers
// `{ ok: true, pct: 0 }`. Every reader then ran `Number(await cfg("LOAN_MARGIN_PCT")) || 2.75`,
// and `||` rejects every falsy value including 0, so the saved zero came back as 2.75. The save
// reported success and the dashboard printed projected earnings on a margin the broker had just
// set to nothing — a dollar figure nobody entered, on a licensed brokerage's own dashboard.
//
// WHY NOTHING CAUGHT IT, which is the more useful half. scripts/verify-patterns.ts SHAPE 3 already
// hunts this family: `Number(cfg(...))` where cfg() returns null when unset, Number(null) === 0,
// and a cap silently becomes zero — the 2026-07-26 incident where NURTURE_FIRST_TOUCH_CAP
// defaulted to 0 = disabled and 159 texts went out at once. That detector accepts a non-zero
// `|| default` as the REMEDY. Finding (D) is the same family read backwards: when 0 is a legal
// configured value, `|| default` IS the defect. The existing detector blesses the exact shape, so
// it could never have found this. The two rules are mirror images and both are right; the thing
// that tells them apart is not mechanical, it is whether ZERO is a legal value for that key.
//
// So this guard uses the only authority on that question: THE WRITE PATH. If the route that saves
// the setting admits 0, every route that reads it must preserve 0.
//
//   npm run verify:config-number
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { settingNumber } from "../lib/configNumber";

const read = (p: string) => readFileSync(p, "utf8");
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`); };

// Known-outstanding read sites, DECLARED with a reason — never left to omission, the way
// scripts/verify-hook-wired.ts declares its manual guards. A site listed here still has the bug;
// listing it keeps it visible and keeps this guard from blocking commits in other people's files.
// Each entry must still exist, and any read site NOT listed here must be correct.
const OUTSTANDING: Record<string, string> = {
  "app/api/settings/margin/route.ts":
    "the GET half of the writer itself still answers Number(getSetting(...)) || 2.75, so the settings " +
    "screen shows 2.75 for a saved 0 while the dashboard now shows 0. Outside the infra cluster on " +
    "2026-10-15; fix: settingNumber(await getSetting(\"LOAN_MARGIN_PCT\"), 2.75, { min: 0, max: 100 }).",
  "app/api/cron/org-learn/route.ts":
    "writes margin_pct into the org-learning snapshot through the same falsy coalesce, so a saved 0 " +
    "is recorded as 2.75 in the learning record. Outside the infra cluster on 2026-10-15; same fix.",
};

console.log("\nNUMERIC SETTINGS — \"\" is absent, 0 is not\n");

// ── 1. the helper's behaviour, including the differential against the shape it replaces ───────
const F = 2.75;
ck("a saved \"0\" resolves to 0 — the defect, asserted directly",
   settingNumber("0", F, { min: 0, max: 100 }) === 0,
   `got ${settingNumber("0", F, { min: 0, max: 100 })}`);
// Not a comparison of a value to itself: the OLD expression and the NEW one are evaluated on the
// same real input and must now DISAGREE. If they ever agree again, the fix has been undone.
const oldShape = Number("0") || F;
ck("…and the old `Number(x) || 2.75` really did return 2.75 on that same input",
   oldShape === 2.75 && oldShape !== settingNumber("0", F, { min: 0, max: 100 }),
   `old shape: ${oldShape} · new: ${settingNumber("0", F, { min: 0, max: 100 })}`);
ck("an ABSENT setting (null) falls back", settingNumber(null, F) === F);
ck("an EMPTY string falls back — \"\" is the one falsy value that does mean absent",
   settingNumber("", F) === F);
ck("whitespace falls back", settingNumber("   ", F) === F);
ck("unparseable text falls back", settingNumber("two point seven five", F) === F);
ck("Infinity falls back (Number(\"Infinity\") is finite-looking but is not)",
   settingNumber("Infinity", F) === F);
ck("a real value survives", settingNumber("3.125", F) === 3.125);
ck("a padded real value survives", settingNumber(" 0.5 ", F) === 0.5);
ck("the number 0 passed directly survives too", settingNumber(0, F, { min: 0, max: 100 }) === 0);
ck("a value below min falls back — a negative margin would print negative earnings",
   settingNumber("-40", F, { min: 0, max: 100 }) === F);
ck("a value above max falls back — 4000% would print a plausible-looking dollar figure",
   settingNumber("4000", F, { min: 0, max: 100 }) === F);
ck("and the arithmetic the dashboard does with it: margin 0 projects ZERO earnings",
   1_000_000 * (settingNumber("0", F, { min: 0, max: 100 }) / 100) === 0,
   `a $1,000,000 pipeline at a saved margin of 0 must project $0, not $${(1_000_000 * (F / 100)).toLocaleString()}`);

// ── 2. the write path is still the authority on whether 0 is legal ────────────────────────────
// If this route ever starts REJECTING 0, the premise of everything above changes and this guard
// should be revisited rather than quietly protecting a value nobody can save. The bounds are
// extracted and EVALUATED, not matched as text.
const WRITER = "app/api/settings/margin/route.ts";
ck(`${WRITER} exists (it is the authority on whether 0 is a legal margin)`, existsSync(WRITER));
const writer = existsSync(WRITER) ? read(WRITER) : "";
const lo = writer.match(/pct\s*<\s*(-?[\d.]+)/);
const hi = writer.match(/pct\s*>\s*(-?[\d.]+)/);
const admits = (v: number) => !!lo && !!hi && !(v < Number(lo[1])) && !(v > Number(hi[1]));
ck("the writer's own validation ADMITS a margin of 0", !!lo && !!hi && admits(0),
   lo && hi ? `rejects pct < ${lo[1]} or pct > ${hi[1]} — 0 passes` : "could not read the validation bounds");
ck("…and still rejects a negative margin and one over 100 (the bounds are real, not vacuous)",
   !admits(-0.01) && !admits(100.01));

// ── 3. every reader of the key must preserve the zero ─────────────────────────────────────────
const KEY = "LOAN_MARGIN_PCT";
// THE PREDICATE, AND THE FIRST VERSION OF IT WAS BLIND TO BOTH LINES IT EXISTS TO FIND.
// `Number\([^)]*\)` cannot cross the inner `)` of `getSetting("LOAN_MARGIN_PCT")`, so
// `Number(await getSetting("LOAN_MARGIN_PCT")) || 2.75` did not match and both known-bad sites
// reported CLEAN. Only the stale-declaration cross-check below caught it. Hence: one level of
// nested parens, and a lookbehind so `settingNumber(` is not read as `Number(`.
const EATS_ZERO = /(?<![A-Za-z$_])(?:Number|parseFloat|parseInt)\s*\((?:[^()]|\([^()]*\))*\)\s*(?:\|\||\?\?)\s*\S/;
const grep = (() => {
  try { return execSync(`grep -rln "${KEY}" --include=*.ts --include=*.tsx app lib components 2>/dev/null`, { encoding: "utf8" }); }
  catch { return ""; }
})();
const sites = grep.split("\n").filter(Boolean).filter((f) => !f.startsWith("lib/configNumber.ts"));
ck(`found the read sites of ${KEY} (${sites.length}) — the enumeration is not empty`, sites.length >= 3,
   sites.join(", "));
for (const f of sites) {
  const src = read(f);
  // The falsy coalesce, on a line that actually reads this key. A comment is not code: strip
  // whole-line comments first, or this guard matches the prose that documents the bug.
  const offending = src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(({ l }) => l.includes(KEY) && EATS_ZERO.test(l));
  const declared = f in OUTSTANDING;
  if (offending.length && declared) {
    console.log(`  ·  ${f}:${offending.map((o) => o.n).join(",")} — DECLARED OUTSTANDING`);
    console.log(`       ${OUTSTANDING[f]}`);
    continue;
  }
  ck(`${f} does not turn a saved 0 back into the default`, offending.length === 0,
     offending.map((o) => `line ${o.n}: ${o.l.trim()}`).join("\n       "));
}
// A stale declaration hides a real gap: if the file is gone or already fixed, the entry must go.
for (const [f, why] of Object.entries(OUTSTANDING)) {
  const present = sites.includes(f);
  const stillBad = present && read(f).split("\n").some((l) => !/^\s*\/\//.test(l) && l.includes(KEY) && EATS_ZERO.test(l));
  // ck() prints its detail on a pass too, so only build one when the check actually fails —
  // "this file is FIXED" under a green tick is a message that reads as its own opposite.
  ck(`the declaration for ${f} is still true (it still has the defect)`, stillBad,
     stillBad ? "" : present
       ? "this file is FIXED — delete its OUTSTANDING entry so a regression fails again"
       : `${f} no longer reads ${KEY} — stale declaration (${why.slice(0, 40)}…)`);
}

// ── 4. the dashboard — this cluster's file — goes through the helper ──────────────────────────
const dash = read("app/api/dashboard/route.ts");
ck("app/api/dashboard/route.ts resolves the margin with settingNumber()",
   /settingNumber\s*\(\s*await\s+cfg\s*\(\s*"LOAN_MARGIN_PCT"/.test(dash));
ck("…and still divides by 100 before applying it (the projection must not move by 100x)",
   /const\s+MARGIN\s*=\s*marginPct\s*\/\s*100/.test(dash));
ck("…and the earnings block still multiplies volume by that MARGIN",
   /pipeline:\s*pipelineVolume\s*\*\s*MARGIN/.test(dash));

console.log(fail
  ? `\n❌ ${fail} check(s) failed — a margin the broker saved must be the margin the dashboard uses\n`
  : `\n✅ ALL PASS — 0 survives the round trip; ${Object.keys(OUTSTANDING).length} site(s) declared outstanding above\n`);
process.exit(fail ? 1 : 0);
