// A REAL FOLDER ON THE MAC THAT MIRRORS THE LOS.
//
// Ramon, 2026-08-06: "Is there a path to access those files in the file folders if I was to just
// click the normal way?"
//
// There was not. Loan documents live in Supabase Storage, and their paths are
// `<loanFileId-uuid>/<epoch>-<original name>` — cloud-side, and the folder is a raw UUID. Even
// mounting the bucket over S3 would show him `b0f692ab-e276-4e6c-…` and no way to tell whose file
// that is. Nothing a file picker can usefully browse.
//
// So this mirrors them DOWN, into names he already thinks in:
//
//     ~/Fetti Loan Files/
//         Magali Lopez Villafuerte — FF-202607-8421/
//             W2_2024.pdf
//             Wells_Fargo_June.pdf
//
// Every "Attach file" dialog on the machine — Outlook, a wholesale portal, anything — can then
// reach them the normal way. He never saves a thing; the folder keeps itself filled.
//
// DELIBERATELY ONE-WAY. It downloads and never uploads, and it never deletes a local file even
// when the document is removed in the CRM. A sync that can delete his files is a sync that will
// eventually delete the wrong one; the cost of a stale leftover is a stray PDF.
//
//   npx tsx scripts/sync-loan-docs.ts            # mirror new/changed documents
//   npx tsx scripts/sync-loan-docs.ts --dry-run  # show what would be written, touch nothing
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const BUCKET = "loan-docs";
const DRY = process.argv.includes("--dry-run");

// Finder and every file dialog choke on "/" and ":" in a name; the rest is trimmed so a long
// condition sentence used as a document label cannot produce a 300-character filename.
function safe(s: string, max = 70): string {
  return String(s || "")
    .replace(/[/\\:*?"<>|\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, "") || "untitled";
}

(async () => {
  const { data: files, error: fErr } = await supabaseAdmin
    .from("loan_files").select("id, file_number, borrower_name");
  if (fErr) throw new Error("loan_files: " + fErr.message);

  // ORDER IS LOAD-BEARING. Two documents on one file can share an uploaded name (a borrower
  // sending "2024_TaxReturn.pdf" twice), and the collision suffix — "(2)", "(3)" — is assigned in
  // iteration order. Postgres returns rows in NO guaranteed order without ORDER BY, so on the
  // first build the suffixes shuffled between runs: the same document landed as "(2)" once and
  // "(3)" the next time, its size stopped matching, and it re-downloaded on every single pass.
  // Deterministic order keeps each document's local NAME stable run to run, which is what the
  // manifest below is keyed against.
  const { data: docs, error: dErr } = await supabaseAdmin
    .from("loan_documents")
    .select("id, loan_file_id, name, file_name, storage_path, size_bytes")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (dErr) throw new Error("loan_documents: " + dErr.message);

  // What we have already pulled down, by storage path — our own record, not the CRM's.
  const MANIFEST = join(ROOT, ".fetti-sync.json");
  let manifest: Record<string, { file: string; bytes: number }> = {};
  try { if (existsSync(MANIFEST)) manifest = JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { manifest = {}; }

  const byFile = new Map<string, any>((files || []).map((f: any) => [f.id, f]));
  let wrote = 0, skipped = 0, failed = 0, orphaned = 0;
  const used = new Map<string, number>();   // per-folder filename collisions

  for (const d of (docs || []) as any[]) {
    const f = byFile.get(d.loan_file_id);
    if (!f) { orphaned++; continue; }       // a document whose loan file is gone

    const folder = join(ROOT, safe(`${f.borrower_name || "Borrower"} — ${f.file_number || d.loan_file_id.slice(0, 8)}`, 90));
    // Prefer the name it was uploaded under — that is what he recognises. The checklist label is
    // the fallback, and it can be an entire underwriting condition, so it gets truncated.
    const base = d.file_name || `${safe(d.name, 60)}.${String(d.storage_path).split(".").pop() || "pdf"}`;
    let name = safe(base, 90);
    const key = `${folder}/${name.toLowerCase()}`;
    const seen = used.get(key) || 0;
    used.set(key, seen + 1);
    if (seen > 0) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}` : `${name} (${seen + 1})`;
    }
    const dest = join(folder, name);

    // ALREADY MIRRORED? Compare against OUR OWN record, never the CRM's size_bytes column.
    //
    // The first version trusted size_bytes and re-downloaded one document on every single run
    // forever: Dominic Glover's VOE letter is recorded as 86,596 bytes and the file in storage is
    // actually 87,448. The column is stale, so the check could never be satisfied. Metadata about
    // a file is not the file.
    //
    // Storage paths are immutable — every upload gets a fresh `<epoch>-<name>` — so an unchanged
    // path means unchanged bytes. Keyed that way, this needs no size from the database at all.
    const prev = manifest[d.storage_path];
    if (prev && existsSync(dest) && statSync(dest).size === prev.bytes) { skipped++; continue; }

    if (DRY) { console.log(`  would write  ${dest.replace(homedir(), "~")}`); wrote++; continue; }

    const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
    if (error || !blob) { console.warn(`  FAILED  ${name} — ${error?.message || "no data"}`); failed++; continue; }
    mkdirSync(folder, { recursive: true });
    const bytes = Buffer.from(await blob.arrayBuffer());
    writeFileSync(dest, bytes);
    manifest[d.storage_path] = { file: dest, bytes: bytes.length };
    console.log(`  wrote  ${dest.replace(homedir(), "~")}`);
    wrote++;
  }

  if (!DRY) { mkdirSync(ROOT, { recursive: true }); writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1)); }
  console.log(`\n${DRY ? "DRY RUN — " : ""}${wrote} written · ${skipped} already current · ${failed} failed · ${orphaned} with no loan file`);
  console.log(`Folder: ${ROOT.replace(homedir(), "~")}`);
  if (failed) process.exitCode = 1;
})();
