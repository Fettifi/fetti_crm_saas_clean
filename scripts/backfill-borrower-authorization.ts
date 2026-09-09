// EVERY OPEN FILE GETS THE CHECKLIST ITEM. Adding it to docChecklistFor() only reaches files
// created AFTER this change; the 34 already in the pipeline would never show it.
//
// Adds the item as `needed` where it is absent. Never overwrites an existing row, never marks
// anything received, and never touches a file that is finished (status AND stage — a closed
// file is not chased, see lib/fileLiveness.ts).
//
//   npx tsx --conditions=react-server scripts/backfill-borrower-authorization.ts          # dry run
//   npx tsx --conditions=react-server scripts/backfill-borrower-authorization.ts --write
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { isOpenFile } from "../lib/fileLiveness";
import { AUTHORIZATION_TITLE } from "../lib/borrowerAuthorization";

const WRITE = process.argv.includes("--write");
const NAME = AUTHORIZATION_TITLE; // "Borrower's Certification and Authorization"

(async () => {
  const { data: files, error: e1 } = await supabaseAdmin.from("loan_files").select("id, file_number, borrower_name, status, stage");
  if (e1) throw new Error("loan_files: " + e1.message);
  const { data: docs, error: e2 } = await supabaseAdmin.from("loan_documents").select("loan_file_id, name");
  if (e2) throw new Error("loan_documents: " + e2.message);

  const byFile = new Map<string, string[]>();
  for (const d of docs || []) byFile.set(d.loan_file_id, [...(byFile.get(d.loan_file_id) || []), d.name]);

  const add: any[] = [];
  let skippedClosed = 0, already = 0;
  for (const f of files || []) {
    if (!isOpenFile(f.status, f.stage)) { skippedClosed++; continue; }
    const names = byFile.get(f.id) || [];
    if (names.some((n) => /certification and authorization/i.test(n))) { already++; continue; }
    add.push({ loan_file_id: f.id, name: NAME, category: "Identity", required: true, status: "needed" });
    console.log(`  + ${f.file_number}  ${f.borrower_name}  [${f.stage}]`);
  }
  console.log(`\n${add.length} open file(s) need the item · ${already} already have it · ${skippedClosed} finished file(s) skipped`);
  if (!add.length) return;
  if (!WRITE) { console.log("\nDRY RUN — re-run with --write to apply."); return; }
  const { error } = await supabaseAdmin.from("loan_documents").insert(add);
  if (error) throw new Error("insert: " + error.message);
  console.log(`\nWROTE ${add.length} checklist row(s).`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
