// RENAME THE LOCAL LOAN-FILE MIRROR TO USE CHECKLIST LABELS.
//
// One-time migration for folders written before sync-loan-docs.ts started naming by `d.name`.
// A phone calls every upload `image.jpg`, so one borrower's folder held sixteen distinct
// documents as image.jpg .. image (16).jpg and the converted ID was invisible among them.
//
// The manifest is renamed IN LOCKSTEP with the files. That is the whole risk here: the push
// side treats any local file NOT recorded in the manifest as something Ramon added by hand and
// uploads it. A rename without a manifest update would therefore push 300 duplicate documents
// into live loan files. Files not present in the manifest are never touched — those are genuine
// pending pushes.
//
//   npx tsx scripts/migrate-mirror-names.ts            # dry run
//   npx tsx scripts/migrate-mirror-names.ts --apply
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const MANIFEST = join(ROOT, ".fetti-sync.json");
const UNDO = join(ROOT, ".rename-undo.json");
const safe = (s: string, n: number) => s.replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, n);

(async () => {
  await requireLiveDb("migrate-mirror-names");
  if (!existsSync(MANIFEST)) { console.error(`no manifest at ${MANIFEST} — refusing`); process.exit(1); }
  const manifest: Record<string, { file: string; bytes: number }> = JSON.parse(readFileSync(MANIFEST, "utf8"));

  const docs = await rows<any>("migrate", supabaseAdmin.from("loan_documents")
    .select("id,name,file_name,storage_path,loan_file_id"), { minRows: 1 });
  const files = await rows<any>("migrate", supabaseAdmin.from("loan_files")
    .select("id,borrower_name,file_number"), { minRows: 1 });
  const byFile = new Map(files.map(f => [f.id, f]));

  const used = new Map<string, number>();
  const plan: { from: string; to: string; key: string; bytes: number }[] = [];
  let same = 0, absent = 0, blocked = 0;

  for (const d of docs) {
    const f = byFile.get(d.loan_file_id); if (!f || !d.storage_path) continue;
    const folder = join(ROOT, safe(`${f.borrower_name || "Borrower"} — ${f.file_number || d.loan_file_id.slice(0, 8)}`, 90));
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
    const seen = used.get(key) || 0; used.set(key, seen + 1);
    if (seen > 0) { const dot = name.lastIndexOf("."); name = `${name.slice(0, dot)} (${seen + 1})${name.slice(dot)}`; }
    const dest = join(folder, name);

    const prev = manifest[d.storage_path];
    if (!prev) { absent++; continue; }                         // never mirrored
    if (!existsSync(prev.file)) { absent++; continue; }         // manifest points at nothing
    if (prev.file === dest) { same++; continue; }               // already correct
    if (existsSync(dest)) { blocked++; console.log(`  BLOCKED  ${dest.replace(homedir(), "~")} already exists`); continue; }
    plan.push({ from: prev.file, to: dest, key: d.storage_path, bytes: prev.bytes });
  }

  // Two entries resolving to the same destination would let renameSync silently overwrite a
  // borrower's document with another. Refuse outright rather than trust the dedupe counter.
  const dests = new Set<string>(); const clash: string[] = [];
  for (const p of plan) { if (dests.has(p.to.toLowerCase())) clash.push(p.to); dests.add(p.to.toLowerCase()); }
  if (clash.length) { console.error(`\nREFUSING — ${clash.length} destination collision(s):\n${clash.slice(0,10).join("\n")}`); process.exit(1); }
  const srcs = new Set(plan.map(p => p.from.toLowerCase()));
  if (srcs.size !== plan.length) { console.error("\nREFUSING — the same source file appears twice in the plan"); process.exit(1); }

  console.log(`\n${plan.length} to rename · ${same} already correct · ${absent} not mirrored · ${blocked} blocked`);
  console.log(`${dests.size} distinct destinations, ${srcs.size} distinct sources — no collisions\n`);
  if (!APPLY) {
    for (const p of plan.slice(0, 12)) console.log(`  ${p.from.split("/").pop()}  ->  ${p.to.split("/").pop()}`);
    console.log(`\nDRY RUN — nothing changed. Re-run with --apply.`);
    return;
  }

  const undo: { from: string; to: string }[] = [];
  let done = 0, failed = 0;
  for (const p of plan) {
    try {
      // Size must still match what the manifest recorded, or this is not the file we think.
      if (statSync(p.from).size !== p.bytes) { console.log(`  SKIP  ${p.from.split("/").pop()} — size changed since it was mirrored`); failed++; continue; }
      renameSync(p.from, p.to);
      manifest[p.key] = { file: p.to, bytes: p.bytes };
      undo.push({ from: p.to, to: p.from });
      done++;
    } catch (e: any) { console.log(`  FAILED  ${p.from.split("/").pop()} — ${e.message}`); failed++; }
  }
  // Write the manifest reflecting what ACTUALLY happened, even on partial failure — a manifest
  // that disagrees with disk is what causes duplicate pushes.
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  writeFileSync(UNDO, JSON.stringify(undo, null, 1));
  console.log(`\nrenamed ${done} · failed ${failed}`);
  console.log(`manifest updated in lockstep · reverse map written to ${UNDO.replace(homedir(), "~")}`);
})();
