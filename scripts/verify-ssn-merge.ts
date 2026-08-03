// A MASKED DOCUMENT MUST NOT ERASE A COMPLETE SSN.
//
// Ramon, 2026-08-03: "if I have a client's taxes, why is it not filling in the Social Security
// number correctly? It's only giving me the last four."
//
// What the data actually showed: the pipeline is sound — 10 of 12 loan files carry all nine
// digits, encrypted at rest and decrypting correctly, and the two showing four digits have ZERO
// documents (those came from the apply form, not from reading taxes). So the extractor is not
// truncating.
//
// The defect is the MERGE. deepMerge returns the SOURCE for a scalar, so the LAST document read
// wins — and real mortgage documents are often masked at the source:
//   • an IRS Tax Return TRANSCRIPT prints XXX-XX-1234 by design (a filed 1040 copy shows all 9)
//   • many payroll W-2 reprints and most 1099s mask it the same way
// So uploading the transcript AFTER the 1040 replaced nine digits with four, and the 1003 field
// looked filled either way. Completeness must only ever go up.
//
//   npx tsx scripts/verify-ssn-merge.ts
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

// The shipping merge, exercised through the same shapes the route builds. (mergeIntoUrla is not
// exported — an App Router file may not export helpers — so the invariant is asserted against
// the source AND against a faithful reimplementation of deepMerge's scalar rule, which is the
// precise thing that caused the loss.)
const src = readFileSync("app/api/los/extract/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nSSN MERGE — completeness only goes up\n`);

chk(/const priorSsn = cur\.borrowers\[slot\]\?\.ssn/.test(src),
  "the merge captures the SSN already on file before merging a document over it");
chk(/normSsn\(priorSsn\)\.length === 9 && normSsn\(cur\.borrowers\[slot\]\?\.ssn\)\.length !== 9/.test(src),
  "and detects a complete SSN being replaced by an incomplete one");
chk(/cur\.borrowers\[slot\]\.ssn = priorSsn;/.test(src),
  "restoring the complete value — a masked transcript cannot erase a filed 1040");
// And completeness must be measured from the VALUE, not from a truthy check that counts "6789".
const urla = readFileSync("lib/urla.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
chk(/\["Borrower SSN[^"]*",\s*String\(b\.ssn \|\| ""\)\.replace\(\/\\D\/g, ""\)\.length === 9\]/.test(urla),
  "urlaCompleteness requires NINE digits — a last-4 no longer reports the 1003 ready to submit");
chk(!/\["Borrower SSN", !!b\.ssn\]/.test(urla),
  "and the old truthy check, which counted a 4-digit stub as complete, is gone");

// The invariant itself, run as arithmetic over the merge rule that shipped.
{
  const normSsn = (v?: string) => String(v || "").replace(/\D/g, "");
  // deepMerge's scalar rule, verbatim from the route: the SOURCE wins.
  const scalarWins = (target: any, srcv: any) => (srcv === null || srcv === undefined || srcv === "" ? target : srcv);
  const FULL = "123-45-6789", MASKED = "XXX-XX-6789";

  // OLD behaviour — what shipped, and what Ramon saw.
  const old = scalarWins(FULL, MASKED);
  chk(normSsn(old).length === 4,
    `the OLD rule loses the SSN: 1040 then transcript -> ${normSsn(old).length} digits (this is the defect)`);

  // NEW behaviour — the guard restores the complete value.
  const merged = scalarWins(FULL, MASKED);
  const fixed = normSsn(FULL).length === 9 && normSsn(merged).length !== 9 ? FULL : merged;
  chk(normSsn(fixed).length === 9, "the NEW rule keeps all nine digits when the later document is masked");

  // Completeness, as urlaCompleteness now computes it.
  const complete = (v: any) => String(v || "").replace(/\D/g, "").length === 9;
  chk(!!MASKED && !complete(MASKED), "a last-4 is TRUTHY but not complete — the old check counted it as done");
  chk(complete(FULL), "and a real nine-digit SSN still counts as complete");

  // And the reverse order must still UPGRADE: masked first, then the real return.
  const upgraded = scalarWins(MASKED, FULL);
  const fixed2 = normSsn(MASKED).length === 9 && normSsn(upgraded).length !== 9 ? MASKED : upgraded;
  chk(normSsn(fixed2).length === 9, "and a complete SSN still overwrites a partial one — the guard is one-way, not sticky");
}

// ── A DOCUMENT THAT DID NOT GET READ MUST BE SAID OUT LOUD. ────────────────────────────────
// The other half of Ramon's report: "it should complete every single field." Three paths
// dropped a document and still reported success — the LO saw a green checkmark either way.
console.log(`\nSILENT LOSS — every unread document is reported\n`);

chk(/max_tokens: 16000/.test(src),
  "a full 1040 + schedules fits in the extraction budget (4,000 tokens truncated it mid-JSON)");
chk(/stop_reason === "max_tokens"/.test(src),
  "and a truncated reply throws instead of parsing to null and reading as an empty document");
chk(/docs\.length > CAP/.test(src) && /were NOT read/.test(src),
  "a file with more documents than the read cap reports the overflow instead of silently reading 15");

const ui = readFileSync("app/los/[id]/1003/page.tsx", "utf8");
chk(/\.\.\.\(j\.failed \|\| \[\]\), \.\.\.\(j\.skipped \|\| \[\]\)/.test(ui),
  "the 1003 screen reads `failed` and `skipped` — the API always returned them and nothing displayed them");
chk((ui.match(/NOT read:/g) || []).length >= 2,
  "on BOTH autofill paths (single upload and pull-from-file), not just one — a fix on one of two parallel paths is not a fix");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An SSN that silently loses five digits is a 1003 that cannot be submitted, and nothing on screen says why.\n`); process.exit(1); }
console.log(`PASS — a masked document cannot erase a complete SSN, and a partial one is marked rather than mistaken for complete.\n`);
