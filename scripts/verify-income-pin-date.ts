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
const movedWithoutBump: string[] = [];
let prevVersion = "", prevPinned = "";
for (const h of hashes) {
  let m: any;
  try { m = JSON.parse(execSync(`git show ${h}:${TRACKED}`, { encoding: "utf8", maxBuffer: 1e8 })); }
  catch { continue; }
  const v = String(m.logicVersion || ""), p = String(m.pinnedAt || "");
  const d = execSync(`git log -1 --format=%ad --date=short ${h}`, { encoding: "utf8" }).trim();
  if (prevVersion && v === prevVersion && p !== prevPinned) {
    movedWithoutBump.push(`${h.slice(0, 7)}  ${d}   pinnedAt ${prevPinned.slice(0, 10)} -> ${p.slice(0, 10)}   version unchanged ("${v}")`);
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

// 2. THE REGRESSION CHECK. The writer must never do this again. History already contains the five
// instances catalogued above; this asserts that no NEW one has been added since the fix landed.
const FIXED_AT = "2026-09-24";   // the commit that made pinnedAt carry forward on a no-bump repin
const fresh = movedWithoutBump.filter((l) => {
  const d = l.match(/\s(\d{4}-\d{2}-\d{2})\s/);
  return d ? d[1] >= FIXED_AT : false;
});
ck(`no repin since ${FIXED_AT} advanced pinnedAt without moving LOGIC_VERSION`,
  fresh.length === 0,
  fresh.length ? fresh.join("\n       ") : `${movedWithoutBump.length} historical instance(s), all before the fix`);

if (movedWithoutBump.length) {
  console.log(`\n  Historical record — ${movedWithoutBump.length} repin(s) moved the pin with no version bump:`);
  for (const l of movedWithoutBump) console.log(`     ${l}`);
}

console.log(fail ? `\nFAIL — ${fail} check(s) red.\n` : `\nPASS — the pin is the date the current LOGIC_VERSION was given.\n`);
process.exit(fail ? 1 : 0);
