// A CLOSED FILE IS NOT A LIVE FILE, ON EVERY SCREEN AND IN EVERY SENDER.
//
// `loan_files` carries two state columns. `status` is the Reg B disposition (active |
// withdrawn | denied | closed) and stays "active" for a file's whole life — right through
// funding — because nobody withdrew or denied it. `stage` is where the file actually is.
// Liveness is the AND of the two, and on 2026-09-06 five places asked only `status`:
//
//   status: active 32, withdrawn 2   ← says 32 of 34 files are live
//   stage : Application 15, Processing 10, Approved 6, Underwriting 2, Closed 1
//
// Charletha Osborne (FF-202608-1913) sat at stage="Closed", status="active", with one
// outstanding required document and BOTH an email and a phone on file. /api/los/remind-all
// asked `mayChaseDocs(f.status)` and did not select `stage` at all, so "Remind All" would
// have emailed and texted a closed borrower for proof of non-ownership on an address. That
// is the same document chaser that put 16 unconsented texts on handsets on 2026-08-01.
//
//   npm run verify:file-liveness
import "./_env";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { isOpenFile, mayChaseDocs, isTerminalFileValue, isActiveDisposition, TERMINAL_STAGES } from "../lib/fileLiveness";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

// Strip comments before grepping source. A guard in this repo once passed with the code
// DELETED because it matched the comment that explained the code, and every file here is
// heavily commented — including with the very strings being searched for.
const code = (f: string) => readFileSync(f, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((ln) => {
    let out = "", q: string | null = null;
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i], n = ln[i + 1];
      if (q) { out += c; if (c === q && ln[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
      if (c === "/" && n === "/") break;
      out += c;
    }
    return out;
  }).join("\n");

const tracked = execSync("git ls-files", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  .split("\n").filter((f) => /^(app|components|lib|hooks|scripts)\//.test(f) && /\.(ts|tsx)$/.test(f));

(async () => {
  console.log("\nFILE LIVENESS — status is the disposition, stage is the pipeline, liveness is both\n");

  console.log("── the predicate ──");
  ck("Osborne's exact shape (active + Closed) is NOT open", isOpenFile("active", "Closed") === false);
  ck("…and must NOT be chased for documents", mayChaseDocs("active", "Closed") === false);
  ck("a withdrawn file still sitting in Application is NOT open", isOpenFile("withdrawn", "Application") === false);
  ck("a funded file is NOT open", isOpenFile("active", "Funded") === false);
  ck("a working file IS open", isOpenFile("active", "Processing") === true);
  ck("…and may be chased", mayChaseDocs("active", "Processing") === true);
  ck("a blank stage on an active file is open, not terminal", isOpenFile("active", null) === true);
  ck("hand-typed variants still read as terminal",
     ["Closed - Withdrawn", "CANCELLED", "dead", "Declined"].every(isTerminalFileValue));
  ck("every TERMINAL_STAGE is recognised by the value test", TERMINAL_STAGES.every(isTerminalFileValue));
  ck("isActiveDisposition answers the DISPOSITION only — a funded file is still active",
     isActiveDisposition("active") === true && isOpenFile("active", "Funded") === false);

  console.log("\n── you cannot ask half the question ──");
  // Both parameters are required, so `mayChaseDocs(f.status)` is a compile error and the
  // query is forced to select `stage`. Proven by arity, which survives a refactor.
  ck("mayChaseDocs takes two required arguments", mayChaseDocs.length === 2, `arity ${mayChaseDocs.length}`);
  ck("isOpenFile takes two required arguments", isOpenFile.length === 2, `arity ${isOpenFile.length}`);

  console.log("\n── the duplicates stay collapsed ──");
  // Before 2026-09-06 the terminal list existed twice: lib/stalledFiles.ts had one covering
  // BOTH columns, lib/los.ts had a predicate that looked only at `status`, and the dashboard
  // had a third literal. They disagreed about whether a stage="Closed" file was live.
  const los = code("lib/los.ts"), stalled = code("lib/stalledFiles.ts"), dash = code("app/api/dashboard/route.ts");
  ck("lib/los.ts sources the predicates from lib/fileLiveness", /export\s*\{[\s\S]{0,200}?isOpenFile[\s\S]{0,200}?\}\s*from\s+"@\/lib\/fileLiveness"/.test(los));
  ck("…and defines no liveness predicate of its own", !/(const|function)\s+(isActiveFile|isOpenFile|mayChaseDocs)\s*[=(]/.test(los));
  ck("lib/stalledFiles.ts imports the shared predicate", /import\s*\{[^}]*isOpenFile[^}]*\}\s*from\s+"@\/lib\/fileLiveness"/.test(stalled));
  ck("…and keeps no private TERMINAL list", !/const\s+TERMINAL\s*=\s*\[/.test(stalled));
  ck("the dashboard derives its funded list from TERMINAL_STAGES", /FUNDED_STAGES[^=]*=\s*TERMINAL_STAGES/.test(dash));

  console.log("\n── no consumer of loan_files decides liveness from status alone ──");
  const offenders: string[] = [];
  for (const f of tracked) {
    if (f === "lib/fileLiveness.ts" || f === "scripts/verify-file-liveness.ts") continue;
    const src = code(f);
    if (!/loan_files|files\.filter|loan_file/.test(src)) continue;
    for (const [i, ln] of src.split("\n").entries()) {
      // `status === "active"` or `.eq("status","active")` with no mention of stage on the line.
      const asksStatus = /\bstatus\b\s*(?:\)\s*)?===\s*"active"|\.eq\(\s*"status"\s*,\s*"active"\s*\)|toLowerCase\(\)\s*===\s*"active"/.test(ln);
      if (!asksStatus) continue;
      if (/\bstage\b|isActiveDisposition|FILE_STATUSES/.test(ln)) continue;   // asked both, or asked the disposition on purpose
      offenders.push(`${f}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    }
  }
  for (const o of offenders) console.log(`     ↳ ${o}`);
  ck("no file keys liveness on status alone", offenders.length === 0, `${offenders.length} site(s)`);

  console.log("\n── the document chaser selects the column it needs ──");
  const ra = code("app/api/los/remind-all/route.ts");
  ck("remind-all calls mayChaseDocs with BOTH columns", /mayChaseDocs\(\s*f\.status\s*,\s*f\.stage\s*\)/.test(ra));
  ck("…and its query actually selects stage", /\.select\([^)]*\bstage\b[^)]*\)/.test(ra));
  const board = code("app/los/page.tsx");
  ck("the LOS board's active list uses the shared predicate", /isOpenFile\(\s*f\.status\s*,\s*f\.stage\s*\)/.test(board));
  ck("…and the board does not import the server-only lib/los", !/from\s+"@\/lib\/los"/.test(board));

  console.log("\n── against the LIVE table ──");
  await requireLiveDb("verify:file-liveness");
  const files = await rows<any>("verify:file-liveness",
    supabaseAdmin.from("loan_files").select("id, file_number, borrower_name, status, stage, email, phone"), { minRows: 1 });
  const docs = await rows<any>("verify:file-liveness",
    supabaseAdmin.from("loan_documents").select("loan_file_id, required, status").eq("status", "needed"), { minRows: 0 });
  const needs = new Set((docs || []).filter((d) => d.required).map((d) => d.loan_file_id));

  const open = files.filter((f) => isOpenFile(f.status, f.stage));
  const byStatusOnly = files.filter((f) => isActiveDisposition(f.status));
  console.log(`  ${files.length} files — status alone calls ${byStatusOnly.length} live; status AND stage call ${open.length} live`);
  ck("the two answers differ — this guard is not vacuous", byStatusOnly.length !== open.length,
     "every live file is mid-pipeline right now; the drifted row was fixed or removed");
  for (const f of files) if (isActiveDisposition(f.status) && !isOpenFile(f.status, f.stage))
    console.log(`     ↳ ${f.file_number} ${f.borrower_name} — status=${f.status} stage=${f.stage} (disposition never recorded; pipeline is done)`);

  // THE ONE THAT MATTERS: who would "Remind All" actually contact.
  const wouldChase = files.filter((f) => mayChaseDocs(f.status, f.stage) && needs.has(f.id) && (f.email || f.phone));
  const chasedButDone = wouldChase.filter((f) => isTerminalFileValue(f.stage) || isTerminalFileValue(f.status));
  console.log(`  "Remind All" would contact ${wouldChase.length} borrower(s)`);
  for (const f of chasedButDone) console.log(`     ↳ WOULD CHASE A FINISHED FILE: ${f.file_number} ${f.borrower_name} (${f.status}/${f.stage})`);
  ck("no finished file is in the chase list", chasedButDone.length === 0, `${chasedButDone.length} file(s)`);
  ck("…and the chase list is not empty for a trivial reason", files.length > 0);

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — one predicate, both columns, and nobody chases a closed file\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
