// pinnedAt IS AN EXEMPTION WINDOW. MOVING IT FORGIVES DRIFT NOBODY LOOKED AT.
//
// 2026-09-24 autopilot. scripts/income-logic-manifest.json carries `pinnedAt`, documented and
// consumed as "when the current LOGIC_VERSION was pinned". verify:income-replay reads it as the
// single dividing line in its most important judgement call (scripts/verify-income-replay.ts:210):
//
//     const pending = pinnedAt && envVerifiedAt && Date.parse(envVerifiedAt) < Date.parse(pinnedAt);
//
// A file verified BEFORE the pin is "not yet read under the current logic" — so when its stored
// number no longer replays, that is the cache key working, not drift, and the file is EXEMPTED
// from the drift check. A file verified AFTER the pin that no longer replays is the 2026-08-04
// defect and fails hard. The whole distinction rests on pinnedAt being the truth.
//
// It was not. scripts/verify-income-logic.ts stamped `pinnedAt: new Date().toISOString()` on EVERY
// --repin, including a --no-reroll repin, whose entire premise is that LOGIC_VERSION did NOT move.
// A no-reroll repin invalidates no cached number — LOGIC_VERSION is half the cache key and it did
// not change — so every file verified before it HAS been read under the current logic. Advancing
// pinnedAt swept those settled files into "pending", where a genuine drift is printed as an
// advisory line under a PASS.
//
// It had already happened six times. Walking the manifest's own history:
//
//     f1eda56  2026-08-19   pinnedAt 2026-08-17 -> 2026-08-19   version unchanged
//     f5f6d50  2026-08-21   pinnedAt 2026-08-19 -> 2026-08-21   version unchanged
//     793b7ca  2026-09-03   pinnedAt 2026-08-21 -> 2026-09-03   version unchanged
//     ff217bd  2026-09-10   pinnedAt 2026-09-07 -> 2026-09-10   version unchanged
//     a91310c  2026-09-12   pinnedAt 2026-09-11 -> 2026-09-12   version unchanged
//     2c95521  2026-09-23   pinnedAt 2026-09-19 -> 2026-09-23   version unchanged
//
// The last one moved the pin of an UNCHANGED LOGIC_VERSION forward four days, widening the
// exemption to cover every file verified 09-19..09-23. The window only ever grows, and the replay
// guard only announces that it proved nothing when ALL files are pending — one short of that, it
// prints PASS.
//
// So the invariant, checked against the data and not against a comment: THE CURRENT pinnedAt MUST
// EQUAL THE pinnedAt RECORDED WHEN THE CURRENT logicVersion FIRST APPEARED. Re-hashing engine files
// or recording a no-reroll claim does not re-pin a version that did not move.
//
// 2026-09-25 autopilot — THE DIRECTION. The first cut of the regression check below flagged ANY
// pinnedAt change on an unchanged version. The remediation commit 7277a40 moved the pin BACK,
// 09-23 -> 09-19, which is the fix itself — and the guard, committed in that same commit, counted
// it as a fresh violation and went red on the very next run against a correct tree. It had never
// been run after the commit existed: the pre-commit hook runs before the commit it is checking,
// so the walk could not yet see it. It is wired into that hook, so it would have blocked every
// income-path commit from here on, and the escape from a guard that can never be green is
// --no-verify. Advancing the pin widens the exemption and forgives unexamined drift; moving it
// back only turns exempted files into checked ones. Only an advance is a regression.
//
//   npm run verify:income-pin-date
//   PIN_GUARD_MANIFEST=<path>   read the manifest from elsewhere (used to prove this fails)
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const MANIFEST = process.env.PIN_GUARD_MANIFEST || path.join("scripts", "income-logic-manifest.json");

let fail = 0;
const ck = (n: string, c: boolean, d = "") => {
  if (!c) fail++;
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`);
};

console.log("\nLOGIC_VERSION PIN DATE — an exemption window that only ever grows is not a window\n");

if (!existsSync(MANIFEST)) {
  console.error(`FAIL — no manifest at ${MANIFEST}. verify:income-replay would then treat every ` +
    `mismatch as a hard failure, which is the safe direction, but this guard cannot check anything.`);
  process.exit(1);
}

const cur = JSON.parse(readFileSync(MANIFEST, "utf8"));
const curVersion = String(cur.logicVersion || "");
const curPinned = String(cur.pinnedAt || "");

ck("the manifest records a logicVersion and a pinnedAt", !!curVersion && !!curPinned,
  `logicVersion=${curVersion || "(missing)"} pinnedAt=${curPinned || "(missing)"}`);
if (!curVersion || !curPinned) { console.log(""); process.exit(1); }

// Walk the manifest's own git history oldest-first and find the commit where THIS logicVersion
// first appears. Reads committed DATA, never source text: a comment cannot satisfy this.
const TRACKED = path.join("scripts", "income-logic-manifest.json");
let hashes: string[] = [];
try {
  hashes = execSync(`git log --format=%H -- ${TRACKED}`, { encoding: "utf8", maxBuffer: 1e8 })
    .trim().split("\n").filter(Boolean).reverse();
} catch {
  console.log("  ⚠️  no git history for the manifest — cannot check the pin against it.\n");
  process.exit(1);
}

let firstPin = "", firstHash = "", firstDate = "";
const advanced: string[] = [];   // pin moved FORWARD with no version bump — the defect
const narrowed: string[] = [];   // pin moved BACK with no version bump — the remediation
let prevVersion = "", prevPinned = "";
for (const h of hashes) {
  let m: any;
  try { m = JSON.parse(execSync(`git show ${h}:${TRACKED}`, { encoding: "utf8", maxBuffer: 1e8 })); }
  catch { continue; }
  const v = String(m.logicVersion || ""), p = String(m.pinnedAt || "");
  const d = execSync(`git log -1 --format=%ad --date=short ${h}`, { encoding: "utf8" }).trim();
  if (prevVersion && v === prevVersion && p !== prevPinned) {
    const line = `${h.slice(0, 7)}  ${d}   pinnedAt ${prevPinned.slice(0, 10)} -> ${p.slice(0, 10)}   version unchanged ("${v}")`;
    // DIRECTION IS THE WHOLE INVARIANT, and the first cut of this check was blind to it.
    // ADVANCING the pin forgives drift nobody looked at — that is the defect. Moving it BACK
    // shrinks the exemption and can only turn exempted files into checked ones, which is the
    // safe direction and is exactly what the remediation commit did. Counting both as the same
    // event made this guard go red on its own fix, permanently, on a correct tree: a guard that
    // can never be green is retired by whoever hits it, with --no-verify.
    const from = Date.parse(prevPinned), to = Date.parse(p);
    // An unparseable date is not evidence of safety — flag it with the advances.
    if (Number.isFinite(from) && Number.isFinite(to) && to < from) narrowed.push(line);
    else advanced.push(line);
  }
  if (v === curVersion && !firstPin) { firstPin = p; firstHash = h.slice(0, 7); firstDate = d; }
  prevVersion = v; prevPinned = p;
}

// 1. THE LIVE CHECK. The current pin must be the pin this version was actually given.
if (!firstPin) {
  // A version that appears in no commit is a working-tree bump not yet committed — the repin is
  // part of this change, and there is nothing historical to compare it against.
  ck(`LOGIC_VERSION "${curVersion}" is not yet in git history — nothing to compare (new bump, uncommitted)`, true);
} else {
  ck(`pinnedAt is the date this LOGIC_VERSION was actually pinned`,
    curPinned === firstPin,
    curPinned === firstPin
      ? `"${curVersion}" pinned ${curPinned.slice(0, 10)} at ${firstHash}`
      : `"${curVersion}" first appeared at ${firstHash} (${firstDate}) with pinnedAt=${firstPin.slice(0, 10)}, ` +
        `but the manifest now says ${curPinned.slice(0, 10)}.\n       ` +
        `A repin that does not move LOGIC_VERSION invalidates no cached number, so it must not move ` +
        `the pin.\n       Every file verified between those dates is now EXEMPTED from ` +
        `verify:income-replay's drift check.\n       Restore pinnedAt to ${firstPin} in ${TRACKED}.`);
}

// 2. THE REGRESSION CHECK. The writer must never do this again. History already contains the six
// instances catalogued above; this asserts that no NEW *advance* has been added since the fix
// landed. A narrowing is not a regression — see the direction note in the walk above.
const FIXED_AT = "2026-09-24";   // the commit that made pinnedAt carry forward on a no-bump repin
const dateOf = (l: string) => (l.match(/\s(\d{4}-\d{2}-\d{2})\s/) || [])[1] || "";
const fresh = advanced.filter((l) => dateOf(l) >= FIXED_AT);
ck(`no repin since ${FIXED_AT} advanced pinnedAt without moving LOGIC_VERSION`,
  fresh.length === 0,
  fresh.length ? fresh.join("\n       ") : `${advanced.length} historical advance(s), all before the fix` +
    (narrowed.length ? `; ${narrowed.length} narrowing(s), which are corrections` : ""));

if (advanced.length) {
  console.log(`\n  Historical record — ${advanced.length} repin(s) ADVANCED the pin with no version bump:`);
  for (const l of advanced) console.log(`     ${l}`);
}
if (narrowed.length) {
  console.log(`\n  ${narrowed.length} repin(s) moved the pin BACK with no version bump — corrections, not defects:`);
  for (const l of narrowed) console.log(`     ${l}`);
}

console.log(fail ? `\nFAIL — ${fail} check(s) red.\n` : `\nPASS — the pin is the date the current LOGIC_VERSION was given.\n`);
process.exit(fail ? 1 : 0);
