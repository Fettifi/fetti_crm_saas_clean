// verify-push-content-dedupe.ts — the mirror's push must dedupe on BYTES, not on the filename.
//
// 2026-10-01. Ramon asked for duplicate documents to be deleted. While doing that I renamed three
// mirror files to say what they actually were — jazmine wilson's W-2 set, Asia Dearman's pay stub,
// Corine Lucas's mortgage statement — and `com.fetti.docsync` uploaded all three into the live LOS
// as NEW documents within four minutes. Each loan file then held the same document twice,
// byte-identical, under two different checklist items. The sync was manufacturing duplicates faster
// than I was removing them.
//
// The defect was a vacuous check: the push looked the candidate up by `file_name` and compared
// sha256 only INSIDE the branch where that name matched. Content could therefore only be compared
// when the name had already matched — so a renamed copy of an existing document could never be
// caught. The comment beside it said "A NAME MATCH IS NOT A CONTENT MATCH", which is the opposite
// error (same name, different bytes) and reads as though both directions were covered.
//
// This guard pins the shape, because the failure is invisible in output: a wrongly pushed duplicate
// looks exactly like a correctly pushed new document.
//
//   npx tsx scripts/verify-push-content-dedupe.ts
//
// MUTATION-TESTED: with the content pre-check deleted, assertions 1, 2 and 3 all fail.
import { readFileSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "sync-loan-docs.ts");
const src = readFileSync(SRC, "utf8");
const fail: string[] = [];

// 1. A content index keyed on sha256, per loan file, must exist.
if (!/shaIndexFor\s*=\s*async/.test(src) || !/createHash\("sha256"\)/.test(src))
  fail.push("no per-loan-file sha256 index (`shaIndexFor`) — the push can only compare names");

// 2. The content check must run BEFORE the file_name lookup, at the top level of the candidate
//    loop. Order is the whole point: after the name lookup it would be unreachable for a rename.
const iContent = src.indexOf("const already = (await shaIndexFor(");
const iName = src.indexOf('.eq("file_name", storeName)');
if (iContent < 0) fail.push("the push never consults the content index for a candidate file");
else if (iName >= 0 && iContent > iName)
  fail.push("the content check sits AFTER the file_name lookup — a renamed duplicate reaches the upload first");

// 3. It must actually stop the push — `continue`, not merely warn. A duplicate that is reported and
//    then uploaded anyway is the bug with extra logging.
const block = iContent >= 0 ? src.slice(iContent, iContent + 700) : "";
if (iContent >= 0 && !/if\s*\(already\)[\s\S]{0,400}?continue;/.test(block))
  fail.push("a content match does not `continue` — it is detected and pushed anyway");

// 4. The sha256 comparison inside the name-match branch must SURVIVE. It catches the other
//    direction (same name, different bytes = a document Ramon revised) and must not be traded away.
if (!/DIFFERS/.test(src))
  fail.push("the same-name/different-bytes report (DIFFERS) is gone — a revised document would be silently skipped");

// 5. The push must still never delete or overwrite a live document.
if (/\.from\("loan_documents"\)[\s\S]{0,80}\.delete\(/.test(src))
  fail.push("the sync deletes loan_documents rows — it must never delete in either direction");

if (fail.length) {
  console.error("✖ verify:push-content-dedupe FAILED");
  for (const f of fail) console.error("   - " + f);
  console.error("\n   A rename in ~/Fetti Loan Files would create a duplicate document in a live loan file.");
  process.exit(1);
}
console.log("✓ verify:push-content-dedupe — push dedupes on bytes before name, and stops on a match");
