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
// NOW TWO-WAY, as of 2026-08-13. It downloads, and it pushes back anything Ramon drops in.
//
// It used to download only, and that cost us. Ramon saved documents that had been emailed to him
// straight into the borrower's folder — the obvious thing to do with a folder named after the
// loan file — and they never reached the LOS: "I saved them in the Fetti loan files, but now that
// I go into the LOS I don't see them. Where did they go?" Eleven documents across three files sat
// like that, the oldest for a week, including a W-2 and four bank statements on a live file. A
// drop folder that silently swallows documents is worse than no drop folder, because it looks
// like it worked.
//
// It still NEVER DELETES, in either direction. A sync that can delete his files is a sync that
// will eventually delete the wrong one; the cost of a stale leftover is a stray PDF.
//
// What the push will and will not send, because this runs unattended every 15 minutes:
//   - only files the download did not put there (tracked in the manifest)
//   - only types the borrower upload route accepts, or a file whose bytes say %PDF- regardless of
//     its name (documents saved out of a mail client routinely arrive with no extension)
//   - nothing under 25 MB, nothing hidden, nothing modified in the last 60s (still being written)
//   - never a second copy: a file_name already on that loan file is left alone
//
//   npx tsx scripts/sync-loan-docs.ts            # pull, then push
//   npx tsx scripts/sync-loan-docs.ts --dry-run  # show what would move, touch nothing
//   npx tsx scripts/sync-loan-docs.ts --no-push  # download only, the old behaviour
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const BUCKET = "loan-docs";
const DRY = process.argv.includes("--dry-run");
const NO_PUSH = process.argv.includes("--no-push");
/** Mirrors app/api/file/[token]/upload/route.ts, plus tidying — Ramon reads these names in the
 *  LOS, and files off a scanner arrive as "bank statement 2  .pdf". */
const PUSH_ALLOWED = /\.(pdf|png|jpe?g|heic|webp|doc|docx|xls|xlsx|csv|txt)$/i;
const PUSH_MAX_BYTES = 25 * 1024 * 1024;
function pushSafeName(name: string): string {
  const i = name.lastIndexOf(".");
  const stem = (i > 0 ? name.slice(0, i) : name)
    .replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const ext = i > 0 ? name.slice(i).replace(/[^a-zA-Z0-9.]/g, "") : "";
  return `${stem || "document"}${ext}`.slice(0, 120);
}

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
    // Check the path the manifest RECORDS, not the name this run would choose. Once the sync
    // became two-way those can differ: a file Ramon dropped in keeps his name ("bank statement
    // 2  .pdf") while the copy the LOS now holds is sanitised ("bank_statement_2.pdf"). Testing
    // only the sanitised name would re-download bytes already sitting in the folder and leave
    // him two of everything he ever added.
    const prev = manifest[d.storage_path];
    const have = prev?.file || dest;
    if (prev && existsSync(have) && statSync(have).size === prev.bytes) { skipped++; continue; }

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

  // ── PUSH ────────────────────────────────────────────────────────────────────────────────────
  let pushed = 0, pushFailed = 0, pushSkipped = 0;
  if (!NO_PUSH) {
    // Everything the download wrote, so what remains is what Ramon added himself.
    const mine = new Set(Object.values(manifest).map((v: any) => v?.file).filter(Boolean) as string[]);
    const byNumber = new Map((files || []).map((f: any) => [String(f.file_number), f]));

    for (const folder of readdirSync(ROOT)) {
      const dir = join(ROOT, folder);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      // The folder name is written by this script as "<Borrower> — <FF-number>", so the number is
      // authoritative. Never infer a loan file from a borrower name — two people share one.
      const num = folder.split("—").pop()?.trim() || "";
      const lf: any = byNumber.get(num);
      if (!lf) continue;

      for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (entry.startsWith(".") || !existsSync(abs) || !statSync(abs).isFile()) continue;
        if (mine.has(abs)) continue;

        const st = statSync(abs);
        if (st.size > PUSH_MAX_BYTES) { console.log(`  push skip  ${entry} — over 25 MB`); pushSkipped++; continue; }
        // Still landing: a mail client or scanner writes in chunks, and half a PDF is worse than
        // no PDF because it looks filed.
        if (Date.now() - st.mtimeMs < 60_000) { pushSkipped++; continue; }

        let name = entry.trim();
        if (!PUSH_ALLOWED.test(name)) {
          if (readFileSync(abs).subarray(0, 5).toString("latin1") === "%PDF-") name = `${name}.pdf`;
          else { pushSkipped++; continue; }
        }
        const storeName = pushSafeName(name);

        const { data: dupe } = await supabaseAdmin.from("loan_documents")
          .select("id").eq("loan_file_id", lf.id).eq("file_name", storeName).limit(1).maybeSingle();
        if (dupe?.id) { mine.add(abs); pushSkipped++; continue; }

        if (DRY) { console.log(`  would push   ${folder}/${storeName}`); pushed++; continue; }

        const path = `${lf.id}/${Date.now()}-${storeName}`;
        const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
          .upload(path, readFileSync(abs), { contentType: "application/pdf", upsert: false });
        if (upErr) { console.error(`  push FAIL  ${storeName}: ${upErr.message}`); pushFailed++; continue; }

        const { error: rowErr } = await supabaseAdmin.from("loan_documents").insert([{
          loan_file_id: lf.id, name: storeName, category: "Additional", required: false,
          status: "received", storage_path: path, file_name: storeName, size_bytes: st.size,
          uploaded_by: "lo",
        }]);
        if (rowErr) {
          // Never strand an object in storage with no row pointing at it.
          await supabaseAdmin.storage.from(BUCKET).remove([path]);
          console.error(`  push FAIL  ${storeName}: ${rowErr.message} — storage rolled back`);
          pushFailed++; continue;
        }
        // Record it so the next pull recognises the file as accounted for and does not
        // re-download the same bytes under a second name.
        manifest[path] = { file: abs, bytes: st.size };
        console.log(`  pushed  ${folder}/${storeName}`);
        pushed++;
      }
    }
    if (!DRY && pushed) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    console.log(`${DRY ? "DRY RUN — " : ""}${pushed} pushed · ${pushSkipped} not eligible · ${pushFailed} failed`);
  }

  console.log(`Folder: ${ROOT.replace(homedir(), "~")}`);
  if (failed || pushFailed) process.exitCode = 1;
})();
