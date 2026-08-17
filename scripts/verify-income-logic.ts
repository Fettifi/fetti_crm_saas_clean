// THE INCOME CACHE KEY MUST MOVE WHEN THE INCOME ENGINE MOVES.
//
// `LOGIC_VERSION` in the verify-income route is one half of the cache key for every borrower's
// qualifying income. Change the engine without changing it and the fix does not reach a single
// existing file: every cached number keeps being served by logic that has since been corrected,
// until something unrelated forces a re-verify — and then it jumps.
//
// WHAT ACTUALLY HAPPENED. From 2026-07-22 to 2026-08-02 the constant was bumped on all 27
// income-logic commits, without exception. Then on 2026-08-04 six more landed — four of them
// rewriting lib/income/docFacts.ts, which is the fact extraction itself:
//
//     3c513ba  the same job spelled two ways is not a job change
//     20032df  variable pay must be DOCUMENTED, not inferred by subtraction
//     2afc558  a fraction-of-a-percent YTD difference is rounding, not a bonus
//     5f85bb3  an identity distinguishes only when both sides declare one
//
// Those are the Magali/Milton corrections — the ones that had produced a phantom job change,
// $4,091/mo of invented variable pay and a salary counted twice. Not one of the six touched
// LOGIC_VERSION. It still reads "2026-08-01-override-exemplars", set on 2026-08-02.
//
// So on 2026-08-15 five of ten live files still carried income computed by the pre-correction
// engine — Brijanae Aubrey, jazmine wilson, Dominic Glover, Merwin Bachiller, Corine Lucas —
// and the corrections written for exactly those defects had never been applied to them. The one
// file that did get re-verified afterwards, Asia Dearman (FF-202607-9927) on 08-05, moved
// $5,102 -> $8,645 on documents nobody had touched. That is what verify:income spent three days
// reporting as "the engine disagreeing with itself". It was not disagreeing with itself. It was
// the 08-04 engine meeting an 08-03 number, one file at a time, in no particular order.
//
// A version constant that a human has to remember to bump is not a mechanism. This is:
//
//   npm run verify:income-logic
//
// It pins the CONTENT of every file the engine computes from against the LOGIC_VERSION that was
// current when they were pinned, and fails when the content moved and the version did not.
//
//   npm run verify:income-logic -- --repin
//       after a real logic change. Requires LOGIC_VERSION to have been bumped, because that is
//       the whole point: a changed engine must invalidate the caches it invalidates.
//
//   npm run verify:income-logic -- --repin --no-reroll --reason="…"
//       for a change that provably cannot move a number — a comment, a type, a new export
//       nothing calls yet. The claim is recorded in the manifest with the version it was made
//       under, so "this one is harmless" is a decision on the record and not a shrug.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { createHash } from "crypto";
import path from "path";

const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";
const INCOME_DIR = "lib/income";
const MANIFEST = path.join(process.cwd(), "scripts", "income-logic-manifest.json");

type Manifest = {
  logicVersion: string;
  pinnedAt: string;
  files: Record<string, string>;
  /** Changes accepted as unable to move a borrower's number, with the reason and the version. */
  noRerollClaims?: { at: string; logicVersion: string; reason: string; files: string[] }[];
};

/**
 * Every file the engine computes a borrower's number from.
 *
 * DISCOVERED BY DIRECTORY, never a hardcoded list. A list is a second thing to remember, and
 * this guard exists because remembering failed — a new lib/income/*.ts would otherwise be
 * unguarded from the day it was added, which is precisely the day it is most likely to be wrong.
 * PROGRAMS.md is excluded deliberately: it is prose reference, read by people, never at runtime
 * (checked — nothing imports or reads it).
 */
function logicFiles(): string[] {
  const dir = path.join(process.cwd(), INCOME_DIR);
  const found = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${INCOME_DIR}/${f}`);
  return [ROUTE, ...found].sort();
}

const sha = (rel: string) =>
  createHash("sha256").update(readFileSync(path.join(process.cwd(), rel))).digest("hex").slice(0, 16);

function currentVersion(): string {
  const src = readFileSync(path.join(process.cwd(), ROUTE), "utf8");
  const m = src.match(/const LOGIC_VERSION = "([^"]+)";/);
  if (!m) {
    console.error(`\nCould not read LOGIC_VERSION from ${ROUTE}. It is the income cache key — if it was ` +
      `renamed or removed, every borrower's cached number just lost the only thing that invalidates it.`);
    process.exit(1);
  }
  return m[1];
}

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

function main() {
  const repin = process.argv.includes("--repin");
  const noReroll = process.argv.includes("--no-reroll");
  const reason = (argValue("--reason") || "").trim();

  const version = currentVersion();
  const files = logicFiles();
  const now: Record<string, string> = {};
  for (const f of files) now[f] = sha(f);

  if (!existsSync(MANIFEST)) {
    const m: Manifest = { logicVersion: version, pinnedAt: new Date().toISOString(), files: now };
    writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
    console.log(`No manifest existed — pinned ${files.length} file(s) at LOGIC_VERSION="${version}".`);
    return;
  }

  const base: Manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const changed = files.filter((f) => base.files[f] !== now[f]);
  const added = files.filter((f) => !(f in base.files));
  const removed = Object.keys(base.files).filter((f) => !files.includes(f));
  const versionMoved = base.logicVersion !== version;
  const drift = changed.length || added.length || removed.length;

  if (repin) {
    // A repin that does not carry a version bump is the exact defect this guard exists for, so
    // it has to be claimed explicitly and in writing.
    if (drift && !versionMoved && !noReroll) {
      console.error(
        `\nREFUSING TO REPIN. ${changed.length + added.length + removed.length} engine file(s) changed but ` +
        `LOGIC_VERSION is still "${version}".\n` +
        changed.map((f) => `  ~ ${f}`).join("\n") + (changed.length ? "\n" : "") +
        added.map((f) => `  + ${f}`).join("\n") + (added.length ? "\n" : "") +
        removed.map((f) => `  - ${f}`).join("\n") + (removed.length ? "\n" : "") +
        `\nPinning this would record the engine as unchanged and leave every cached number to be served ` +
        `by the old logic until something forces a re-read — which is how Asia Dearman's file moved ` +
        `$5,102 -> $8,645 with nobody touching a document.\n\n` +
        `Bump LOGIC_VERSION in ${ROUTE} and repin, or — only if this change genuinely cannot move any ` +
        `borrower's number — say so on the record:\n` +
        `  npm run verify:income-logic -- --repin --no-reroll --reason="…"`,
      );
      process.exit(1);
    }
    if (noReroll && !reason) {
      console.error(`\n--no-reroll requires --reason="…". An unexplained "this one is harmless" is the ` +
        `claim that needs the most explaining.`);
      process.exit(1);
    }
    if (noReroll && !drift) {
      console.error(`\n--no-reroll was passed but nothing changed. Refusing to record a claim about a change ` +
        `that did not happen.`);
      process.exit(1);
    }
    const next: Manifest = {
      logicVersion: version,
      pinnedAt: new Date().toISOString(),
      files: now,
      noRerollClaims: base.noRerollClaims || [],
    };
    if (noReroll) {
      next.noRerollClaims!.push({
        at: next.pinnedAt, logicVersion: version, reason,
        files: [...changed, ...added.map((f) => `+${f}`), ...removed.map((f) => `-${f}`)],
      });
    }
    writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + "\n");
    console.log(`Pinned ${files.length} engine file(s) at LOGIC_VERSION="${version}".`);
    if (versionMoved) console.log(`  LOGIC_VERSION moved "${base.logicVersion}" -> "${version}" — every cached income will re-read on next verify.`);
    if (noReroll) console.log(`  RECORDED as unable to move a number: "${reason}"`);
    return;
  }

  if (!drift) {
    if (versionMoved) {
      console.error(`\nFAIL — LOGIC_VERSION moved "${base.logicVersion}" -> "${version}" but no engine file ` +
        `changed.\nThat invalidates every borrower's cached income for nothing: each file pays a full ` +
        `document re-read and may show the LO a different number, with no change behind it.\n` +
        `If it is deliberate, repin:  npm run verify:income-logic -- --repin`);
      process.exit(1);
    }
    console.log(`PASS — ${files.length} engine file(s) unchanged at LOGIC_VERSION="${version}".`);
    return;
  }

  if (versionMoved) {
    console.error(`\nFAIL — the engine changed AND LOGIC_VERSION was bumped to "${version}", but the manifest ` +
      `still records "${base.logicVersion}".\nThis is the good case: pin it so the next change is measured ` +
      `from here.\n  npm run verify:income-logic -- --repin`);
    process.exit(1);
  }

  console.error(
    `\nFAIL — the income engine changed and LOGIC_VERSION did NOT.\n\n` +
    `  LOGIC_VERSION is still "${version}" (pinned ${String(base.pinnedAt).slice(0, 10)})\n\n` +
    changed.map((f) => `  ~ ${f}`).join("\n") + (changed.length ? "\n" : "") +
    added.map((f) => `  + ${f}`).join("\n") + (added.length ? "\n" : "") +
    removed.map((f) => `  - ${f}`).join("\n") + (removed.length ? "\n" : "") +
    `\nLOGIC_VERSION is half the cache key for every borrower's qualifying income. Leaving it means ` +
    `this change reaches NO existing file — each one keeps serving the old number until something ` +
    `unrelated forces a re-verify, and then it moves on its own. That is the 2026-07-22 complaint, ` +
    `and it is what happened on 2026-08-04.\n\n` +
    `Bump LOGIC_VERSION in ${ROUTE}, then:\n` +
    `  npm run verify:income-logic -- --repin\n` +
    `Or, if this change provably cannot move any borrower's number:\n` +
    `  npm run verify:income-logic -- --repin --no-reroll --reason="…"`,
  );
  process.exit(1);
}

main();
