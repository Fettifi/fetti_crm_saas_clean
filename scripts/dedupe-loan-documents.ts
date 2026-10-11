// dedupe-loan-documents.ts — TRUE duplicate loan documents, in the LOS, which is the only place
// deleting one STICKS.
//
// WHY THIS EXISTS, and it is a correction of my own work (2026-10-01). Ramon: "delete duplicate
// copies of the same document so they don't fumble up our system. If you find that, in a person's
// loan file. Make sure it is a true duplicate though. Before you delete it."
//
// I did that — on the MIRROR. I hashed ~/Fetti Loan Files, found 24 groups, deleted 30 byte-identical
// files, and logged them. **25 of the 30 were back on disk within five minutes, byte-identical.**
// `com.fetti.docsync` runs every 60 SECONDS and re-pulls any live LOS document whose local copy is
// gone, by design — "it still NEVER DELETES, in either direction." So a mirror deletion is not a
// deletion at all; it is a file that reappears while the report says it is gone. The five that did
// stay deleted stayed only because they were never in the LOS.
//
// THE AUTHORITY IS `loan_documents`. The mirror is a projection of it. Delete the row, and the local
// copy stops coming back on the next cycle — no local deletion needed at all.
//
// IDENTITY IS sha256 OF THE STORED BYTES. Never `size_bytes` (documented unreliable — Dominic
// Glover's VOE records 86,596 against an 87,448-byte object), never `file_name`, and never the byte
// COUNT: this run found two of jazmine wilson's pay-stub PDFs at 4,188,297 and 4,188,298 bytes —
// one byte apart, different documents — and two more at an identical 4,126,225 bytes with DIFFERENT
// hashes. Same size is not same file.
//
// TWO KINDS OF GROUP, AND THEY ARE NOT THE SAME PROBLEM:
//   SAME checklist item  -> a plain double-upload. Keep the oldest row, drop the rest. Mechanical.
//   DIFFERENT items      -> the same bytes filed under two categories, i.e. a MIS-FILING. Which row
//                           survives is a question about what the document IS, and that can only be
//                           answered by rendering it and looking. This script REFUSES to pick, and
//                           prints it for a human read. My first keep-rule for these was "longest
//                           name wins", which chose the junk copy seven times — ` (2)`, `_1`, `[88]`
//                           all make a name longer while meaning "accidental".
//
//   npx tsx scripts/dedupe-loan-documents.ts                 # report only, touches nothing
//   npx tsx scripts/dedupe-loan-documents.ts --delete        # delete the SAME-ITEM duplicates only
//   npx tsx scripts/dedupe-loan-documents.ts --delete --id=<uuid> [--id=<uuid> ...]
//                                                            # delete specific reviewed rows
import "./_env";
import { createHash } from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const BUCKET = "loan-docs";
const DO_DELETE = process.argv.includes("--delete");
const ONLY_IDS = process.argv.filter(a => a.startsWith("--id=")).map(a => a.slice(5));

type Doc = {
  id: string; loan_file_id: string; name: string | null; file_name: string | null;
  storage_path: string; size_bytes: number | null; created_at: string;
};

async function main() {
  // ---- the live set, paged, and REFUSE to act on a truncated view (same rule as the sync) ----
  const docs: Doc[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabaseAdmin
      .from("loan_documents")
      .select("id, loan_file_id, name, file_name, storage_path, size_bytes, created_at")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error("loan_documents: " + error.message);
    docs.push(...((page || []) as Doc[]));
    if (!page || page.length < 1000) break;
  }
  const { count, error: cErr } = await supabaseAdmin
    .from("loan_documents").select("id", { count: "exact", head: true }).not("storage_path", "is", null);
  if (cErr) throw new Error("count: " + cErr.message);
  if (count == null || docs.length !== count || docs.length === 0) {
    console.error(`✖ LIVE SET INCOMPLETE — read ${docs.length}, the LOS holds ${count}. A truncated view of the LOS is not a view. Refusing.`);
    process.exit(1);
  }

  const { data: files, error: fErr } = await supabaseAdmin
    .from("loan_files").select("id, file_number, borrower_name");
  if (fErr) throw new Error("loan_files: " + fErr.message);
  const fileLabel = new Map<string, string>();
  for (const f of (files || []) as any[]) fileLabel.set(f.id, `${f.borrower_name || "?"} — ${f.file_number || f.id}`);

  // ---- hash the BYTES. Prefer the local mirror copy (byte-verified by the sync's own manifest);
  //      fall back to downloading the object. A document we cannot hash is never a duplicate. ----
  let manifest: Record<string, { file: string; bytes: number }> = {};
  try { manifest = JSON.parse(readFileSync(join(ROOT, ".fetti-sync.json"), "utf8")); } catch {}

  const sha = new Map<string, string>();
  let local = 0, pulled = 0, unhashable = 0;
  for (const d of docs) {
    const m = manifest[d.storage_path];
    if (m && existsSync(m.file)) {
      sha.set(d.id, createHash("sha256").update(readFileSync(m.file)).digest("hex")); local++; continue;
    }
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(d.storage_path);
    if (error || !data) { unhashable++; continue; }
    sha.set(d.id, createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex")); pulled++;
  }
  console.log(`# dedupe-loan-documents — read at ${new Date().toISOString()}`);
  console.log(`${docs.length} live document(s) across ${fileLabel.size} loan file(s)`);
  console.log(`hashed: ${local} from the mirror, ${pulled} downloaded, ${unhashable} UNHASHABLE (never treated as duplicates)\n`);

  // ---- group by (loan file, sha256). A duplicate only means anything WITHIN one borrower's file. ----
  const groups = new Map<string, Doc[]>();
  for (const d of docs) {
    const h = sha.get(d.id); if (!h) continue;
    const k = `${d.loan_file_id}::${h}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(d);
  }

  const sameItem: Doc[][] = [], crossItem: Doc[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const items = new Set(g.map(d => (d.name || "").trim()));
    (items.size === 1 ? sameItem : crossItem).push(g);
  }

  const show = (g: Doc[]) => {
    console.log(`  ${fileLabel.get(g[0].loan_file_id) || g[0].loan_file_id}   sha ${sha.get(g[0].id)!.slice(0, 12)}  ${g[0].size_bytes ?? "?"} b`);
    g.forEach((d, i) => console.log(`     ${i === 0 ? "KEEP  " : "drop  "} [${d.name || "(no item)"}]  ${d.file_name}   ${d.created_at.slice(0, 16)}  ${d.id}`));
  };

  if (sameItem.length) {
    console.log(`## SAME CHECKLIST ITEM, identical bytes (${sameItem.length} group(s)) — a plain double-upload, oldest row kept`);
    sameItem.forEach(show); console.log();
  }
  if (crossItem.length) {
    console.log(`## !! SAME BYTES, DIFFERENT CHECKLIST ITEMS (${crossItem.length} group(s)) — a MIS-FILING, not a duplicate`);
    console.log(`   This script will NOT choose. Render the document, decide what it IS, then re-run with --id=<the row to delete>.`);
    crossItem.forEach(g => {
      console.log(`  ${fileLabel.get(g[0].loan_file_id) || g[0].loan_file_id}   sha ${sha.get(g[0].id)!.slice(0, 12)}  ${g[0].size_bytes ?? "?"} b`);
      g.forEach(d => console.log(`     ?     [${d.name || "(no item)"}]  ${d.file_name}   ${d.created_at.slice(0, 16)}  ${d.id}`));
      const m = manifest[g[0].storage_path];
      if (m) console.log(`     read: ${m.file}`);
    });
    console.log();
  }
  if (!sameItem.length && !crossItem.length) console.log("No byte-identical documents within any single loan file.\n");

  if (!DO_DELETE) {
    console.log("REPORT ONLY — nothing was deleted. Re-run with --delete to remove the SAME-ITEM duplicates,");
    console.log("or --delete --id=<uuid> to remove specific rows you have reviewed.");
    process.exit(sameItem.length || crossItem.length ? 2 : 0);
  }

  // ---- deletion. Log the FULL row first so it can be re-inserted; never remove the last copy;
  //      never touch the storage object (a sibling row may point at the same path). ----
  const victims: Doc[] = ONLY_IDS.length
    ? docs.filter(d => ONLY_IDS.includes(d.id))
    : sameItem.flatMap(g => g.slice(1));

  if (ONLY_IDS.length) {
    const missing = ONLY_IDS.filter(i => !victims.some(v => v.id === i));
    if (missing.length) { console.error(`✖ not live documents: ${missing.join(", ")}. Refusing.`); process.exit(1); }
  }

  const byHash = new Map<string, number>();
  for (const d of docs) { const h = sha.get(d.id); if (h) byHash.set(`${d.loan_file_id}::${h}`, (byHash.get(`${d.loan_file_id}::${h}`) || 0) + 1); }
  for (const v of victims) {
    const k = `${v.loan_file_id}::${sha.get(v.id)}`;
    if ((byHash.get(k) || 0) < 2) { console.error(`✖ ${v.id} is the ONLY copy of those bytes on that loan file. Refusing to delete anything.`); process.exit(1); }
  }

  const log: any[] = [];
  for (const v of victims) {
    const { data: full } = await supabaseAdmin.from("loan_documents").select("*").eq("id", v.id).single();
    const { error } = await supabaseAdmin.from("loan_documents").delete().eq("id", v.id);
    if (error) { console.error(`  ✖ ${v.id}: ${error.message}`); continue; }
    const k = `${v.loan_file_id}::${sha.get(v.id)}`; byHash.set(k, (byHash.get(k) || 1) - 1);
    log.push({ deletedAt: new Date().toISOString(), sha256: sha.get(v.id), row: full });
    console.log(`  ✓ deleted  ${fileLabel.get(v.loan_file_id)}  [${v.name}]  ${v.file_name}`);
  }
  const out = join(ROOT, `.los-dedupe-log-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(log, null, 2));
  console.log(`\n${log.length} row(s) deleted. FULL rows logged for re-insertion: ${out}`);
  console.log("The storage objects were NOT touched — a sibling row can share a storage_path, and an orphaned object is harmless.");
  console.log("The mirror stops re-pulling these on its next 60s cycle; local copies can then be removed, or just left.");
}

main().catch(e => { console.error("✖ " + (e?.message || e)); process.exit(1); });
