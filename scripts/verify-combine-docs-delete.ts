// A DESTRUCTIVE DELETE MUST BE KEYED ON WHAT SUCCEEDED, NEVER ON WHAT WAS ATTEMPTED.
//
// 2026-10-16, found while Ramon said "fix all of the bugs". app/api/los/files/[id]/combine-docs
// merges selected loan documents into one PDF and, on explicit opt-in, removes the originals.
// The merge loop is careful: anything it cannot read goes onto `skipped` and the response reports it.
// The delete was not careful. It read:
//
//     const paths = ordered.map((d) => d.storage_path)                      // EVERY SELECTED DOC
//     await supabaseAdmin.storage.from(BUCKET).remove(paths)
//     .delete().in("id", ordered.map((d) => d.id))
//
// `ordered` is the INPUT set. So a document that failed to merge — a password-protected or corrupt
// PDF, a .docx or .heic, a storage download that errored — was deleted from the bucket AND had its
// loan_documents row removed, while appearing nowhere in the combined output. The API reported it
// under `skipped` in the same response that destroyed it.
//
// Encrypted bank statements and tax PDFs are the most common documents a lender asks for and the
// most common thing to land in `skipped`. This was unrecoverable loss of a borrower's document on a
// live mortgage file.
//
// `merged` could not have guarded it: `merged` is a string[] of display LABELS, with no id and no
// storage_path, so there was nothing for the delete to key on and it reached for the input set.
// The fix carries the documents themselves in `mergedDocs` and deletes only those.
//
// THE SHAPE WORTH KEEPING: when a loop partitions inputs into succeeded and failed, any destructive
// action afterwards must consume the SUCCEEDED collection. Reaching for the original input is the
// bug, and it reads as reasonable right up until the first failure.
//
//   npx tsx scripts/verify-combine-docs-delete.ts            # 0 clean · 1 defect
//   npx tsx scripts/verify-combine-docs-delete.ts --selftest
import { readFileSync } from "fs";

const ROUTE = "app/api/los/files/[id]/combine-docs/route.ts";

/** The opt-in delete block, comments stripped — the only region that may delete. */
export function deleteBlock(src: string): string {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const i = code.indexOf("if (removeOriginals)");
  if (i < 0) return "";
  return code.slice(i, i + 1200);
}

export type Verdict = { ok: boolean; why: string };

export function auditDelete(src: string): Verdict {
  const blk = deleteBlock(src);
  if (!blk) return { ok: false, why: "could not find the removeOriginals block — the guard cannot see what it protects" };
  if (/\bordered\b/.test(blk))
    return { ok: false, why: "the delete block references `ordered` — the INPUT set. It must consume only documents that actually merged." };
  if (!/\bmergedDocs\b/.test(blk))
    return { ok: false, why: "the delete block does not reference `mergedDocs` — it must key on the succeeded set" };
  return { ok: true, why: "delete is keyed on mergedDocs (the succeeded set)" };
}

/** The success set must be the DOCUMENTS, not their labels — a string[] cannot key a delete. */
export function tracksDocuments(src: string): Verdict {
  if (!/const mergedDocs\s*:/.test(src)) return { ok: false, why: "no mergedDocs collection declared" };
  const pushes = (src.match(/mergedDocs\.push\(/g) || []).length;
  const labels = (src.match(/merged\.push\(label\)/g) || []).length;
  if (pushes < labels)
    return { ok: false, why: `mergedDocs.push appears ${pushes}x but merged.push(label) ${labels}x — a success path that records the label without the document silently drops it from the delete set` };
  return { ok: true, why: `every one of the ${labels} success path(s) records the document` };
}

if (process.argv.includes("--selftest")) {
  let bad = 0;
  const ck = (n: string, c: boolean) => { if (!c) bad++; console.log(`  ${c ? "✅" : "❌"} ${n}`); };
  console.log("\nSELFTEST — verify-combine-docs-delete\n");

  const SHIPPED = `
    const merged: string[] = [];
    merged.push(label);
    if (removeOriginals) {
      const paths = ordered.map((d) => d.storage_path).filter(Boolean);
      await supabaseAdmin.storage.from(BUCKET).remove(paths);
      const { data: del } = await supabaseAdmin.from("loan_documents").delete().in("id", ordered.map((d) => d.id));
    }`;
  const FIXED = `
    const merged: string[] = [];
    const mergedDocs: typeof ordered = [];
    merged.push(label); mergedDocs.push(d);
    if (removeOriginals) {
      const paths = mergedDocs.map((d) => d.storage_path).filter(Boolean);
      await supabaseAdmin.storage.from(BUCKET).remove(paths);
      const ids = mergedDocs.map((d) => d.id);
      const { data: del } = await supabaseAdmin.from("loan_documents").delete().in("id", ids);
    }`;

  ck("the REAL shipped delete is caught", !auditDelete(SHIPPED).ok);
  ck("…and the reason names `ordered` as the input set", /INPUT set/.test(auditDelete(SHIPPED).why));
  ck("the fixed delete passes", auditDelete(FIXED).ok);
  ck("a missing removeOriginals block is a FAILURE, not a pass",
     !auditDelete("const x = 1;").ok);
  ck("a block that mentions neither is caught",
     !auditDelete(`if (removeOriginals) { remove(somethingElse); }`).ok);
  ck("a COMMENT naming `ordered` does not trip it",
     auditDelete(`if (removeOriginals) {\n  // this used to use ordered\n  const p = mergedDocs.map(d=>d.id);\n}`).ok);

  ck("label-only tracking is caught", !tracksDocuments(SHIPPED).ok);
  ck("…and the reason says the collection is absent entirely",
     /no mergedDocs collection declared/.test(tracksDocuments(SHIPPED).why));
  ck("document tracking passes", tracksDocuments(FIXED).ok);
  // The partial case is the nastier one: the collection EXISTS, so it looks wired up, but one
  // success path forgot to record the document — so that document survives the merge and is then
  // never deleted... or worse, a future edit "fixes" the delete back to `ordered` to compensate.
  const PARTIAL = `const mergedDocs: typeof ordered = [];\nmerged.push(label); mergedDocs.push(d);\nmerged.push(label);`;
  ck("a success path that records only the label is caught", !tracksDocuments(PARTIAL).ok);
  ck("…and THAT is the reason that explains the silent drop",
     /silently drops/.test(tracksDocuments(PARTIAL).why));

  const live = readFileSync(ROUTE, "utf8");
  const a = auditDelete(live), t = tracksDocuments(live);
  ck(`the LIVE route's delete is safe — ${a.why}`, a.ok);
  ck(`the LIVE route tracks documents — ${t.why}`, t.ok);

  console.log(bad ? `\n❌ ${bad} failed\n` : "\n✅ ALL PASS\n");
  process.exit(bad ? 1 : 0);
}

const src = readFileSync(ROUTE, "utf8");
const a = auditDelete(src), t = tracksDocuments(src);
console.log(`\nCOMBINE-DOCS DELETE — ${ROUTE}\n`);
for (const [n, v] of [["delete keyed on the succeeded set", a], ["success set carries documents", t]] as const)
  console.log(`  ${v.ok ? "✅" : "❌"} ${n} — ${v.why}`);
if (a.ok && t.ok) { console.log("\n✅ CLEAN — a document that fails to merge is left where it is.\n"); process.exit(0); }
console.log("\n❌ A SKIPPED DOCUMENT CAN BE DELETED. That is unrecoverable loss on a live loan file.\n");
process.exit(1);
