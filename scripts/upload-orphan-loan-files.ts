// PUSH DOCUMENTS THAT WERE SAVED INTO THE LOCAL MIRROR BUT NEVER REACHED THE LOS.
//
// Ramon, 2026-08-13: "I saved them in the Fetti loan files, but now that I go into the LOS I
// don't see them. Where did they go?"
//
// They were exactly where he put them. `~/Fetti Loan Files/` is the DOWNLOAD mirror
// (scripts/sync-loan-docs.ts, "DELIBERATELY ONE-WAY. It downloads and never uploads"), so a file
// dropped into it is filed in a photocopy of the cabinet — on the Mac, invisible to the LOS. Three
// loan files had documents sitting in that state, the oldest for a week. An underwriter
// conditioning on a document that "is in the file" is the failure this produces.
//
// This is the one-time repair. The permanent fix is the mirror learning to push, which is
// scripts/sync-loan-docs.ts --push.
//
// Conventions are copied from the borrower upload route (app/api/file/[token]/upload/route.ts)
// so these rows are indistinguishable from a normal upload:
//   bucket        loan-docs
//   storage path  `${loan_file_id}/${Date.now()}-${safeName}`
//   row           category "Additional", required false, status "received"
//   uploaded_by   "lo" — Ramon put these in by hand; they did not come from the borrower portal
//
//   npx tsx scripts/upload-orphan-loan-files.ts            # dry run, writes nothing
//   npx tsx scripts/upload-orphan-loan-files.ts --commit   # actually upload
import "./_env";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { supabaseAdmin } from "../lib/supabaseAdminClient";

const ROOT = join(homedir(), "Fetti Loan Files");
const MANIFEST = join(ROOT, ".fetti-sync.json");
const BUCKET = "loan-docs";
const ALLOWED = /\.(pdf|png|jpe?g|heic|webp|doc|docx|xls|xlsx|csv|txt)$/i;
const MAX_BYTES = 25 * 1024 * 1024;
const COMMIT = process.argv.includes("--commit");

/**
 * The upload route's sanitiser, plus tidying — these names are read by a human in the LOS.
 *
 * The route maps every disallowed character to "_", which is right for safety but turns
 * "bank statement 2  .pdf" into "bank_statement_2__.pdf". Files that arrived by email routinely
 * carry trailing and doubled spaces, so collapse runs of underscores and strip them from the edges
 * of the stem. Same character class, same 120-char cap — just legible.
 */
function safe(name: string): string {
  const i = name.lastIndexOf(".");
  const stem = (i > 0 ? name.slice(0, i) : name).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const ext = i > 0 ? name.slice(i).replace(/[^a-zA-Z0-9.]/g, "") : "";
  return `${stem || "document"}${ext}`.slice(0, 120);
}

/** Every local path the download sync itself wrote — anything else is a file Ramon added. */
function syncedPaths(): Set<string> {
  const out = new Set<string>();
  if (!existsSync(MANIFEST)) return out;
  const walk = (o: unknown) => {
    if (typeof o === "string") out.add(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  };
  walk(JSON.parse(readFileSync(MANIFEST, "utf8")));
  return out;
}

(async () => {
  const synced = syncedPaths();
  const { data: files, error } = await supabaseAdmin
    .from("loan_files").select("id, file_number, borrower_name");
  if (error) throw new Error(`could not read loan_files: ${error.message}`);
  const byNumber = new Map((files || []).map((f) => [String(f.file_number), f]));

  type Job = { abs: string; folder: string; fileId: string; fileNumber: string; storeName: string; bytes: number };
  const jobs: Job[] = [];
  const skipped: string[] = [];

  for (const folder of readdirSync(ROOT)) {
    const dir = join(ROOT, folder);
    if (!statSync(dir).isDirectory()) continue;
    // Folder names are "<Borrower> — <FF-number>", written by the download sync, so the file
    // number is authoritative here — never guess a loan file from the borrower name.
    const num = folder.split("—").pop()?.trim() || "";
    const lf = byNumber.get(num);
    if (!lf) { skipped.push(`${folder}: no loan file matches "${num}"`); continue; }

    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (entry.startsWith(".") || !statSync(abs).isFile()) continue;
      if (synced.has(abs)) continue;                       // came from the LOS already

      const bytes = statSync(abs).size;
      if (bytes > MAX_BYTES) { skipped.push(`${folder}/${entry}: ${(bytes / 1048576).toFixed(1)} MB over the 25 MB limit`); continue; }

      // A file saved from an email client can arrive with no extension. Trust the magic bytes,
      // not the name: "2025 W2" with no suffix is a real PDF and belongs in the file.
      let name = entry.trim();
      if (!ALLOWED.test(name)) {
        const magic = readFileSync(abs).subarray(0, 5).toString("latin1");
        if (magic === "%PDF-") name = `${name}.pdf`;
        else { skipped.push(`${folder}/${entry}: unsupported type (starts "${magic}")`); continue; }
      }
      jobs.push({ abs, folder, fileId: lf.id, fileNumber: num, storeName: safe(name), bytes });
    }
  }

  console.log(`${jobs.length} document(s) to push${COMMIT ? "" : "  (DRY RUN — nothing is written)"}\n`);
  let last = "";
  for (const j of jobs) {
    if (j.folder !== last) { console.log(`  ${j.folder}`); last = j.folder; }
    console.log(`     ${j.storeName.padEnd(52)} ${(j.bytes / 1024).toFixed(0).padStart(6)} KB`);
  }
  if (skipped.length) { console.log("\nskipped:"); skipped.forEach((s) => console.log(`  ! ${s}`)); }
  if (!COMMIT) { console.log("\nRe-run with --commit to upload."); return; }

  let ok = 0, failed = 0;
  for (const j of jobs) {
    // Idempotent: if a row already carries this file_name on this loan file, it is already in.
    const { data: dupe } = await supabaseAdmin.from("loan_documents")
      .select("id").eq("loan_file_id", j.fileId).eq("file_name", j.storeName).limit(1).maybeSingle();
    if (dupe?.id) { console.log(`  = ${j.storeName} already on the file`); continue; }

    const path = `${j.fileId}/${Date.now()}-${j.storeName}`;
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(path, readFileSync(j.abs), { contentType: "application/pdf", upsert: false });
    if (upErr) { console.error(`  ! ${j.storeName}: ${upErr.message}`); failed++; continue; }

    const { error: rowErr } = await supabaseAdmin.from("loan_documents").insert([{
      loan_file_id: j.fileId, name: j.storeName, category: "Additional", required: false,
      status: "received", storage_path: path, file_name: j.storeName, size_bytes: j.bytes,
      uploaded_by: "lo",
    }]);
    if (rowErr) {
      // Never leave an object in storage with no row pointing at it — that is a file nobody can
      // find and nobody knows to delete.
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      console.error(`  ! ${j.storeName}: row insert failed (${rowErr.message}) — storage object rolled back`);
      failed++; continue;
    }
    console.log(`  + ${j.storeName}`);
    ok++;
  }
  console.log(`\n${ok} uploaded · ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
