// A SCANNER'S FILENAME MUST NOT RIDE ALONG WITH THE NAME RAMON GAVE THE DOCUMENT.
//
// Ramon, 2026-09-12, raising it for at least the third time: "the documents that I just saved
// and renamed are not showing up — they're still showing as the scan name as they originally
// scanned in."
//
// The rename DID work every time. It reached the database and it reached the disk. What he was
// looking at was the scanner's filename still glued to the end of his own label:
//
//     july bank statement — Scan_to_OneDrive_2026-09-11-16-46-06.pdf
//     credit report — dhqPDF.aspx-48.pdf
//     Government-issued photo ID — 20240130_084321.jpg
//
// sync-loan-docs keeps the uploaded stem as a suffix so a name like `W-2_2025` does not lose its
// YEAR. Right idea; the "meaningless name" list was just too narrow. It held a bare `scan`, and
// `Scan_to_OneDrive_2026-09-11-16-46-06` does not match that — there are letters after "scan" —
// so every scanned document carried its scanner timestamp forever, in the very folder he browses
// when uploading to a wholesale portal.
//
// This guard asserts the classifier drops machine names and KEEPS informative ones, and that no
// live file in the mirror still carries such a suffix.
//
//   npm run verify:mirror-names
import "./_env";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

// Compiled from the SHIPPING source, so the guard can never drift from the rule it checks.
function genericFromSource(): RegExp {
  const src = readFileSync("scripts/sync-loan-docs.ts", "utf8");
  // Accept BOTH spellings. Reading only `new RegExp(...)` meant a refactor to a literal read as
  // "the rule was deleted" and the guard refused to run — fail-closed, but it hid WHICH check
  // would have gone red, which is the thing worth seeing.
  const built = src.match(/const GENERIC = new RegExp\(([\s\S]*?)\);/);
  const literal = src.match(/const GENERIC = (\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*);/);
  if (!built && !literal) throw new Error("GENERIC not found in sync-loan-docs.ts — the rule moved or was deleted");
  // eslint-disable-next-line no-eval
  return eval(built ? `new RegExp(${built[1]})` : literal![1]) as RegExp;
}

(async () => {
  console.log("\nMIRROR FILENAMES — the label he typed, not the name the scanner chose\n");
  const G = genericFromSource();

  console.log("── machine names are DROPPED ──");
  for (const n of [
    "Scan_to_OneDrive_2026-09-11-16-46-06", "Scan to OneDrive_2026-08-12-20-08-24",
    "dhqPDF.aspx-48", "20240130_084321", "20260723_211741",
    "Screenshot_20260707-122639_ADPMobile", "IMG_1752", "image", "image (16)", "unnamed",
  ]) ck(`"${n}"`, G.test(n));

  console.log("\n── informative names are KEPT ──");
  // The suffix exists for these. If the pattern ever swallows one, a tax year or a bank name is
  // lost and two different documents collapse into the same filename.
  for (const n of [
    "W-2_2025", "EmployeePayStub__16_", "Wells_Fargo_June", "1342 Edgemont 1003",
    "CPL_110100036994", "Signed-Kelly-Dorsey-Credit-Report-Authorization", "2024 tax return",
  ]) ck(`"${n}"`, !G.test(n));

  console.log("\n── nothing live in the mirror still carries one ──");
  const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
  let scanned = 0; const offenders: string[] = [];
  if (existsSync(ROOT)) {
    for (const dir of readdirSync(ROOT)) {
      const p = join(ROOT, dir);
      if (dir.startsWith(".") || !statSync(p).isDirectory()) continue;
      for (const f of readdirSync(p)) {
        if (f.startsWith(".")) continue;
        scanned++;
        // "— original" copies are deliberately archived supersessions; they keep their names.
        if (/— original/.test(f)) continue;
        const stem = f.replace(/\.[^.]+$/, "");
        if (!stem.includes(" — ")) continue;
        const tail = stem.split(" — ").pop() || "";
        if (G.test(tail)) offenders.push(`${dir}/${f}`);
      }
    }
  }
  for (const o of offenders.slice(0, 8)) console.log(`     ↳ ${o}`);
  ck(`no live mirrored file ends in a machine name`, offenders.length === 0, `${offenders.length} of ${scanned} files`);
  ck("…and the mirror was actually read — this check is not vacuous", scanned > 0, `${scanned} files scanned`);

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — the folder shows the name he gave the document\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
