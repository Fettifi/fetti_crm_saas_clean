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
import { createHash } from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync, renameSync } from "fs";
import { join, dirname, basename, extname } from "path";
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
    // NAME BY THE CHECKLIST ITEM, not by the name the file arrived under.
    //
    // The first version preferred the uploaded filename "because that is what he recognises".
    // That assumption dies on a phone: iOS names every share `image.jpg`, so ONE borrower's
    // folder held sixteen documents — a driver's licence, W-2s, four tax-return pages, pay stubs
    // and an insurance quote — as `image.jpg` through `image (16).jpg`. Nothing on disk said
    // which was which. Ramon converted his ID to PDF, went looking for it, and could not find it
    // in his own loan folder; it was sitting there as `image.pdf`.
    //
    // `d.name` is the checklist label ("Government-issued photo ID"), which is exactly what a
    // lender portal needs to see. For documents added directly rather than against a checklist
    // item the label IS the filename, so those keep the name he gave them.
    // A camera name carries nothing; a human name usually does. Strip only the meaningless ones
    // (`image.jpg`, `IMG_1752.jpeg`, `scan`, `unnamed`) and keep the rest as a suffix, so
    // `W-2_2025.pdf` becomes "W-2s — last 2 years — W-2_2025.pdf" and does not lose its YEAR.
    // Replacing an informative name with the checklist label is how two different tax returns
    // collapse into "Tax returns" and "Tax returns — additional".
    const GENERIC = /^(image|img|photo|pic|scan|document|doc|untitled|unnamed|file|attachment)[\s_\-.()0-9]*$/i;
    const ext = String(d.file_name || d.storage_path).split(".").pop()?.toLowerCase() || "pdf";
    const stem = String(d.file_name || "").replace(/\.[^.]+$/, "");
    const label = safe(String(d.name || d.file_name || "document").replace(new RegExp(`\\.${ext}$`, "i"), ""), 70);
    const keepStem = stem && !GENERIC.test(stem) && stem.toLowerCase() !== label.toLowerCase();
    let name = `${safe(keepStem ? `${label} — ${stem}` : label, 110)}.${ext}`;
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

  // ── LABEL WHAT THE CRM HAS REPLACED ─────────────────────────────────────────────────────
  // Converting or shrinking a document gives it a NEW storage_path, so the sync pulls the new
  // file and the OLD local copy stays (this sync never deletes). The folder then holds
  // "Government-issued photo ID — 20260722_110053.jpg" at 2.87 MB beside the .pdf at 0.58 MB,
  // and the wrong one gets uploaded. Rename the superseded copy rather than delete it.
  //
  // "This storage_path is no longer live" is NOT enough on its own: a dead entry's `file` is
  // usually the very path the download above just overwrote with the NEW version (same
  // checklist-derived name, new bytes). Selecting on the dead key alone would rename the
  // CURRENT file as superseded — it tried to, on a live Wells Fargo statement and a live tax
  // return. A file is superseded only when NO live document maps onto it.
  const liveFiles = new Set(
    (docs || []).map((d: any) => manifest[d.storage_path]?.file).filter(Boolean) as string[],
  );
  const livePaths = new Set((docs || []).map((d: any) => d.storage_path));
  let labelled = 0;
  for (const [key, v] of Object.entries(manifest) as [string, any][]) {
    if (livePaths.has(key) || !v?.file || !existsSync(v.file) || liveFiles.has(v.file)) continue;
    const ext = extname(v.file), stem = basename(v.file, ext);
    if (/ — original( \(\d+\))?$/.test(stem)) continue;      // already labelled
    let dest = join(dirname(v.file), `${stem} — original${ext}`);
    for (let i = 2; existsSync(dest); i++) dest = join(dirname(v.file), `${stem} — original (${i})${ext}`);
    if (DRY) { console.log(`  would label  ${basename(v.file)} -> ${basename(dest)}`); labelled++; continue; }
    try {
      renameSync(v.file, dest);
      manifest[key] = { file: dest, bytes: v.bytes };   // lockstep, or the push side re-uploads it
      labelled++;
      console.log(`  labelled  ${basename(dest)}`);
    } catch { /* a file we cannot rename is left exactly as it is */ }
  }

  if (!DRY) { mkdirSync(ROOT, { recursive: true }); writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1)); }
  console.log(`\n${DRY ? "DRY RUN — " : ""}${wrote} written · ${skipped} already current · ${failed} failed · ${orphaned} with no loan file${labelled ? ` · ${labelled} superseded copy(ies) labelled` : ""}`);

  // ── PUSH ────────────────────────────────────────────────────────────────────────────────────
  let pushed = 0, pushFailed = 0, pushSkipped = 0, conflicts = 0;
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

        // A NAME MATCH IS NOT A CONTENT MATCH. The first version skipped on file_name alone, so a
        // file Ramon revised locally — signed, flattened, re-scanned — kept the same name, looked
        // like a duplicate, and NEVER reached the LOS. Found in the wild: Kelly Dorsey's
        // "NONI Doc Order" was 89,752 bytes on disk against 173,309 in the LOS, different sha256,
        // silently skipped on every run. Compare the BYTES and say so when they disagree; which
        // version is authoritative is Ramon's call, not this script's, so it reports and moves on
        // rather than overwriting a live loan document.
        const { data: dupe } = await supabaseAdmin.from("loan_documents")
          .select("id,storage_path,size_bytes").eq("loan_file_id", lf.id).eq("file_name", storeName).limit(1).maybeSingle();
        if (dupe?.id) {
          let differs = false;
          if (dupe.storage_path) {
            const { data: remote } = await supabaseAdmin.storage.from(BUCKET).download(dupe.storage_path);
            if (remote) {
              const rb = Buffer.from(await remote.arrayBuffer());
              differs = createHash("sha256").update(rb).digest("hex") !== createHash("sha256").update(readFileSync(abs)).digest("hex");
              if (differs) console.warn(`  DIFFERS  ${folder}/${entry} — the LOS holds a different file under this name ` +
                `(${st.size}b on disk vs ${rb.length}b in the LOS). Not pushed: rename the local copy to file it as a new document.`);
            }
          }
          mine.add(abs); pushSkipped++; conflicts += differs ? 1 : 0; continue;
        }

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
    console.log(`${DRY ? "DRY RUN — " : ""}${pushed} pushed · ${pushSkipped} not eligible · ${pushFailed} failed` +
      (conflicts ? ` · ${conflicts} NAME-MATCH CONTENT CONFLICT(S) — see DIFFERS above` : ""));
  }

  console.log(`Folder: ${ROOT.replace(homedir(), "~")}`);
  if (failed || pushFailed) process.exitCode = 1;
})();
