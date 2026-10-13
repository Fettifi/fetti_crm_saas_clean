// NO BORROWER DATA IN A TRACKED FILE. EVER.
//
// 2026-10-13. scripts/income-baseline.json sat in a repo that was PUBLIC on GitHub from 2026-08-01.
// Fetched anonymously, with no login, it gave up 35 borrowers by name, 13 of them with their
// qualifying monthly income printed beside the name, document labels carrying account last-4s and
// balances, third-party tenant names, and a 14-entry audit trail naming employers, hire dates and
// benefit income. Ten weeks. Nobody noticed because nothing was looking.
//
// The repo is private now and the baseline is redacted — but both of those are states, and states
// drift back. A generated file regains a field the day someone adds one to the snapshot; a private
// repo goes public the day someone wants to show it to a contractor. This is the part that does not
// drift: a guard that reads what is ACTUALLY ON DISK and refuses the commit.
//
//   npm run verify:baseline-clean      # exit 0 = clean · 1 = borrower data in a tracked file
//
// It asserts the SHAPE the file is allowed to have rather than hunting for known names, because a
// denylist of surnames only ever catches the borrowers you already thought of.
import { readFileSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "scripts", "income-baseline.json");

let bad = 0;
const ck = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
};

if (!existsSync(BASELINE)) {
  console.log("\nNo income baseline on disk — nothing to check.\n");
  process.exit(0);
}

const raw = readFileSync(BASELINE, "utf8");
const snap = JSON.parse(raw);
const files = Object.values(snap.files || {}) as any[];
const candidates = files.flatMap((f) => f.candidates || []) as string[];

console.log(`\nBASELINE PRIVACY — ${path.relative(ROOT, BASELINE)}, ${files.length} file(s), ${candidates.length} candidate(s)\n`);

// 1. NO NAMES. The guard resolves these live at report time; nothing needs them on disk.
const withNames = files.filter((f) => String(f.borrower || "").trim() !== "");
ck("no borrower name is stored", withNames.length === 0,
   `${withNames.length} file(s) carry a borrower name, e.g. "${withNames[0]?.borrower}"`);

// 2. EVERY DOCUMENT LABEL IS A HASH. This is the positive assertion — a shape, not a denylist.
//    Document names carried "Simply Checking 4803", "avail 3023.15" and tenant names.
const badLabels = candidates.filter((c) => {
  const i = c.indexOf("|");
  return i < 0 || !/^[0-9a-f]{12}$/.test(c.slice(i + 1));
});
ck("every document label is a 12-char hash, never the real name", badLabels.length === 0,
   `${badLabels.length} unhashed, e.g. ${badLabels[0]}`);

// 3. THE AUDIT TRAIL IS NOT IN HERE. It names employers, hire dates and benefit income; it lives in
//    scripts/.income-accepted-moves.local.json, which is gitignored.
ck("the accepted-moves audit trail is not in the tracked file", !("acceptedMoves" in snap),
   "acceptedMoves is back in the baseline — it carries borrower prose and must stay local");

// 4. SHAPES THAT ARE NEVER OK, whatever the field is called. Cheap, and catches a field nobody
//    thought about — which is exactly how this happened the first time.
const SHAPES: [string, RegExp][] = [
  ["US SSN", /\b\d{3}-\d{2}-\d{4}\b/],
  ["account last-4 fragment", /(?:^|[^A-Za-z0-9])(?:x|xx)\d{3,4}(?![0-9a-f])/i],
  ["dollar amount with cents", /\d{1,3},\d{3}\.\d{2}/],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["phone number", /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/],
];
for (const [what, rx] of SHAPES) {
  const m = raw.match(rx);
  ck(`no ${what} anywhere in the file`, !m, m ? `found: ${String(m[0]).slice(0, 40)}` : "");
}

// 5. THE LEDGER IT MOVED TO MUST STAY IGNORED. If someone removes the .gitignore line, the audit
//    trail silently becomes trackable again and the next `git add -A` publishes all of it.
const gi = existsSync(path.join(ROOT, ".gitignore")) ? readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
ck("the local accepted-moves ledger is still gitignored", /income-accepted-moves/.test(gi),
   "add `scripts/.income-accepted-moves.local.json` back to .gitignore");

console.log("");
if (bad) {
  console.error(
    `FAIL — ${bad} problem(s). A borrower's name and income are in a file that git tracks.\n` +
    `Re-baseline with:  npm run verify:income -- --save   (redactForStorage strips it)\n` +
    `and if a NEW field is carrying it, redact that field there too.\n`,
  );
  process.exit(1);
}
console.log("PASS — the tracked baseline carries no borrower name, label, figure or identifier.\n");
