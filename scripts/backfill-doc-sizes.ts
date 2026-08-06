// RECONCILE loan_documents.size_bytes AGAINST THE BYTES ACTUALLY IN STORAGE.
//
// Ramon, 2026-08-06: "fix the size_bytes column."
//
// Two causes, both fixed at the source in the same commit:
//   · both upload routes read `Number(b?.size_bytes) || obj[0].metadata.size` — the BROWSER's
//     claim first, the object's real metadata only as a fallback, while that metadata had already
//     been fetched two lines above. One document ended up recorded as 86,596 against an 87,448-byte
//     object, which makes any size-based comparison permanently unsatisfiable.
//   · the MISMO import archived its XML and never wrote size_bytes at all.
//
// This repairs the rows already written. It reads sizes from storage's own listing (no downloads)
// and RECURSES — documents live at `<loanFileId>/<file>` but MISMO imports live at
// `<loanFileId>/imports/<file>`, and a non-recursive listing reports those as missing, which is
// exactly the false alarm my first audit produced.
//
//   npx tsx scripts/backfill-doc-sizes.ts            # report only, changes nothing
//   npx tsx scripts/backfill-doc-sizes.ts --apply    # write the corrections
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { writeFileSync } from "fs";

const BUCKET = "loan-docs";
const APPLY = process.argv.includes("--apply");

// Storage has no recursive list; walk the folders we care about.
async function sizesUnder(prefix: string, out: Map<string, number>, depth = 0): Promise<void> {
  if (depth > 3) return;
  const { data: objs, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) { console.warn(`  ! list ${prefix}: ${error.message}`); return; }
  for (const o of objs || []) {
    const full = prefix ? `${prefix}/${o.name}` : o.name;
    const size = (o as any)?.metadata?.size;
    // A folder comes back with no metadata — recurse into it.
    if (typeof size === "number") out.set(full, size);
    else await sizesUnder(full, out, depth + 1);
  }
}

(async () => {
  const { data: docs, error } = await supabaseAdmin
    .from("loan_documents").select("id, loan_file_id, file_name, storage_path, size_bytes")
    .not("storage_path", "is", null);
  if (error) throw new Error("loan_documents: " + error.message);

  const roots: string[] = [...new Set(((docs || []) as any[]).map((d) => String(d.storage_path).split("/")[0] as string))];
  const real = new Map<string, number>();
  for (const r of roots) await sizesUnder(r, real);
  console.log(`Indexed ${real.size} object(s) in storage across ${roots.length} folder(s).\n`);

  const fixes: { id: string; from: any; to: number; name: string }[] = [];
  let correct = 0, absent = 0;
  for (const d of (docs || []) as any[]) {
    const actual = real.get(d.storage_path);
    if (actual === undefined) { absent++; console.warn(`  ! not in storage: ${d.storage_path}`); continue; }
    if (Number(d.size_bytes) === actual) { correct++; continue; }
    fixes.push({ id: d.id, from: d.size_bytes, to: actual, name: d.file_name || d.storage_path });
  }

  console.log(`  already correct : ${correct}`);
  console.log(`  to correct      : ${fixes.length}`);
  console.log(`  not in storage  : ${absent}`);
  for (const f of fixes) console.log(`     ${String(f.from ?? "NULL").padStart(9)} → ${String(f.to).padStart(9)}   ${f.name}`);

  if (!fixes.length) { console.log("\nNothing to do."); return; }
  if (!APPLY) { console.log("\nReport only. Re-run with --apply to write these.\n"); return; }

  // Snapshot before writing — this is a live table and the old values are otherwise unrecoverable.
  const backup = `/tmp/size_bytes-backup-${roots.length}-${fixes.length}.json`;
  writeFileSync(backup, JSON.stringify(fixes, null, 1));
  console.log(`\n  previous values saved to ${backup}`);

  let done = 0, failed = 0;
  for (const f of fixes) {
    const { error: uErr } = await supabaseAdmin.from("loan_documents").update({ size_bytes: f.to }).eq("id", f.id);
    if (uErr) { console.error(`  FAILED ${f.name}: ${uErr.message}`); failed++; } else done++;
  }
  console.log(`\n  ${done} corrected · ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
