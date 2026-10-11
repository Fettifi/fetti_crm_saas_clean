// label-loan-document.ts — put a document in the RIGHT CATEGORY, with the RIGHT LABEL, where it sticks.
//
// Ramon, 2026-10-01: "in the LOS, when you're doing the document identification, once you read and
// identify the documents, if something is in the wrong place, I want you to label it right and put it
// in the right category. You don't need to ask me to do that."
//
// MY FIRST ATTEMPT AT THIS WAS THE WRONG MECHANISM ENTIRELY, and it did harm. I renamed the files in
// ~/Fetti Loan Files, because that is where I was reading them. Two things happened:
//   1. The rename does not stick. The mirror re-derives every local filename from `loan_documents.name`
//      on each 60-second cycle. The label I wrote was never the label he reads.
//   2. The rename PUSHED. The two-way sync saw a local file it had not written, and uploaded it as a
//      NEW document — three live loan files gained a second, byte-identical copy of a document they
//      already held, while I was in the middle of deleting duplicates for him.
//
// The label that sticks lives on the ROW: `name` is the checklist label, `category` files it, and
// `notes` already carries the `[auto-id]` content read. That is what the LOS shows, what the mirror
// derives filenames from, and what survives.
//
//   npx tsx scripts/label-loan-document.ts --id=<uuid> [--name="…"] [--category=Income] [--note="…"]
//   npx tsx scripts/label-loan-document.ts --id=<uuid> --note="…" --dry-run
//
// `--note` APPENDS, never replaces: the auto-id evidence trail is how a later read knows what was
// already established, and overwriting it would destroy the only record of the previous finding.
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const arg = (k: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};
const DRY = process.argv.includes("--dry-run");

// The categories actually in use. A typo here would file a document into a category that renders
// nowhere, which is indistinguishable from losing it.
const CATEGORIES = new Set(["Additional", "Assets", "Other", "Income", "Identity", "Property",
  "Added by LO", "Signed", "borrower-to-complete", "Business", "Project", "Origination", "Uploaded",
  "Credit", "Entity", "Experience", "Lender condition"]);

async function main() {
  const id = arg("id"), name = arg("name"), category = arg("category"), note = arg("note");
  if (!id) { console.error("✖ --id=<uuid> is required"); process.exit(1); }
  if (!name && !category && !note) { console.error("✖ nothing to change — pass --name, --category or --note"); process.exit(1); }
  if (category && !CATEGORIES.has(category)) {
    console.error(`✖ "${category}" is not a category in use. One of: ${[...CATEGORIES].join(", ")}`);
    process.exit(1);
  }

  const { data: before, error } = await supabaseAdmin.from("loan_documents").select("*").eq("id", id).maybeSingle();
  if (error) { console.error("✖ " + error.message); process.exit(1); }
  if (!before) { console.error(`✖ no live document with id ${id}`); process.exit(1); }

  const { data: lf } = await supabaseAdmin.from("loan_files")
    .select("borrower_name, file_number").eq("id", before.loan_file_id).maybeSingle();

  const patch: Record<string, any> = {};
  if (name) patch.name = name;
  if (category) patch.category = category;
  if (note) patch.notes = ((before.notes || "").trim() + (before.notes ? "\n" : "") + note).trim();

  console.log(`${lf?.borrower_name || "?"} — ${lf?.file_number || before.loan_file_id}`);
  console.log(`  file: ${before.file_name}  (${before.size_bytes ?? "?"} b)`);
  for (const k of Object.keys(patch)) {
    if (k === "notes") { console.log(`  notes  += ${note}`); continue; }
    console.log(`  ${k.padEnd(8)} ${JSON.stringify(before[k])}  ->  ${JSON.stringify(patch[k])}`);
  }
  if (DRY) { console.log("\nDRY RUN — nothing written."); process.exit(0); }

  const { error: uErr } = await supabaseAdmin.from("loan_documents").update(patch).eq("id", id);
  if (uErr) { console.error("✖ " + uErr.message); process.exit(1); }

  // Keep the previous values, so a wrong relabel is reversible without guessing.
  appendFileSync(join(process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files"), ".los-label-log.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), id, borrower: lf?.borrower_name,
      was: { name: before.name, category: before.category, notes: before.notes }, patch }) + "\n");
  console.log("\n✓ relabelled. Previous values appended to .los-label-log.jsonl");
  console.log("  The mirror renames the local copy from `name` on its next cycle — do not rename it by hand.");
}

main().catch(e => { console.error("✖ " + (e?.message || e)); process.exit(1); });
