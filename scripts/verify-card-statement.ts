// A CREDIT-CARD STATEMENT MUST NEVER BE READ AS A BANK STATEMENT.
//
// 2026-09-03, autopilot sweep. verify:income went red on Tylor Stone (FF-202609-7039): four
// documents had appeared in the income candidate set. All four were Chase CREDIT CARD statements
// — "Payment Due Date", "Minimum Payment Due", "Available Credit", chase.com/cardhelp — uploaded
// into the checklist slot named "Bank statements — last 2 months". INCOME_RE matched the SLOT,
// so all four were queued to be read as deposit statements on the next income verification.
//
// On the bank-statement method that counts the borrower's own card PAYMENTS as deposits, i.e. as
// income ($4,262.63 on one statement alone). The file had no cached income yet, so no number had
// shipped — this is the defect caught while it was still loaded rather than after it fired.
//
// The content classifier that should have caught it already existed and could not: it runs only
// over documents the FILENAME pass did NOT pick up, and it can only ADD. Nothing could reject a
// document the filename let in.
//
// THIS GUARD CHECKS BOTH HALVES, because either one alone is decoration:
//   1. the CLASSIFIER still separates card statements from deposit statements, measured over the
//      REAL documents in the live database — never over invented text; and
//   2. the ROUTE actually CALLS it on the name-matched path. A classifier nothing calls is the
//      house failure mode (a mechanism that exists and does nothing), and it is the exact way
//      this defect got in.
//
// To see it fail, break either half: raise the threshold in looksLikeCreditCardStatement, or
// delete the looksLikeCreditCardStatement call from the route's download loop.
import "./_env";
import { requireLiveDb } from "./_liveDb";
import { supabaseAdmin as sb } from "../lib/supabaseAdminClient";
import { pdfText, looksLikeCreditCardStatement, isScan } from "../lib/docContent";
import { readFileSync } from "fs";
import path from "path";

const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";
const BUCKET = "loan-docs";

/** The documents this guard is anchored on, by storage path suffix — the real Chase cards. */
const KNOWN_CARDS = ["saph_res.pdf", "saph_res_2.pdf", "ink_statement.pdf", "ink_2.pdf"];

function routeSource(): string {
  return readFileSync(path.join(process.cwd(), ROUTE), "utf8");
}

/** HALF 2 — the wiring. Read the route, not a memory of it. */
function checkRouteCallsIt(): string[] {
  const src = routeSource();
  const problems: string[] = [];
  if (!/import\s*\{[^}]*\blooksLikeCreditCardStatement\b[^}]*\}\s*from\s*"@\/lib\/docContent"/.test(src)) {
    problems.push("the route does not IMPORT looksLikeCreditCardStatement from @/lib/docContent.");
  }
  // The call must sit inside the loop that builds docBufs — the name-matched read path. An
  // import alone proved nothing on 2026-08-04, when an assertion matched an `import` rather than
  // the call site and passed while the code did nothing.
  const loopStart = src.indexOf("for (const d of candidates)");
  const loopEnd = src.indexOf("docBufs.push(");
  if (loopStart < 0 || loopEnd < 0 || loopEnd < loopStart) {
    problems.push("could not locate the candidate download loop (`for (const d of candidates)` … `docBufs.push(`) — did the route get restructured?");
  } else {
    const loop = src.slice(loopStart, loopEnd);
    if (!/looksLikeCreditCardStatement\s*\(/.test(loop)) {
      problems.push("looksLikeCreditCardStatement is never CALLED inside the candidate download loop — a name-matched card statement would still be read as income.");
    }
    if (!/\bcontinue\b/.test(loop.slice(loop.indexOf("looksLikeCreditCardStatement")))) {
      problems.push("the card-statement branch does not `continue` — the document would be classified and then read anyway.");
    }
  }
  // Excluding a document without telling anyone is the 2026-08-01 failure in the other
  // direction: an income that quietly drops and looks like the borrower's.
  if (!/cardStatements\.push\(/.test(src)) problems.push("rejected card statements are not recorded (no cardStatements.push) — the exclusion would be silent.");
  if (!/cardFlags/.test(src)) problems.push("no cardFlags — the LO would never be told which documents were excluded or why.");
  if (!/flags:\s*\[[^\]]*cardFlags/.test(src.replace(/\n/g, " "))) problems.push("cardFlags is built but never added to the report's `flags` — a finding that does nothing.");
  return problems;
}

async function main() {
  await requireLiveDb("verify:card-statement");
  const problems: string[] = [];

  for (const p of checkRouteCallsIt()) problems.push(`WIRING: ${p}`);

  // HALF 1 — the classifier, over the real corpus.
  const src = routeSource();
  const m = src.match(/const INCOME_RE = (\/.*\/i);/);
  if (!m) { console.error("verify:card-statement: could not read INCOME_RE from the route."); process.exit(1); }
  // eslint-disable-next-line no-eval
  const INCOME_RE = eval(m[1]) as RegExp;

  const { data: docs, error: de } = await sb
    .from("loan_documents").select("id, loan_file_id, name, category, file_name, storage_path");
  if (de) { console.error(`verify:card-statement: loan_documents — ${de.message}`); process.exit(1); }

  const candidates = (docs || []).filter(
    (d: any) => d.storage_path &&
      (String(d.category || "").toLowerCase() === "income" || INCOME_RE.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`)) &&
      /\.pdf$/i.test(d.file_name || d.storage_path || ""),
  ) as any[];

  if (!candidates.length) {
    console.error("verify:card-statement: ZERO income-candidate PDFs in the database. This guard measures real documents; with none it asserts nothing. Refusing to pass.");
    process.exit(1);
  }

  const rejected: string[] = [];
  const keptCards: string[] = [];
  let scans = 0, read = 0;
  const seenKnown = new Set<string>();

  for (const d of candidates) {
    const { data: blob, error: se } = await sb.storage.from(BUCKET).download(d.storage_path);
    if (se || !blob) { problems.push(`could not download ${d.file_name} — ${se?.message || "no blob"}`); continue; }
    let text = "";
    try { text = await pdfText(Buffer.from(await blob.arrayBuffer()), 30); } catch { text = ""; }
    if (isScan(text)) { scans++; continue; }
    read++;
    const v = looksLikeCreditCardStatement(text);
    const label = `${d.file_name} (slot "${d.name}")`;
    const known = KNOWN_CARDS.find((k) => String(d.file_name || "").endsWith(k));
    if (known) seenKnown.add(known);
    if (v.ok) {
      rejected.push(`${label} card=${v.cardScore} deposit=${v.depositScore}`);
      if (!known) problems.push(`FALSE POSITIVE: ${label} was rejected as a credit-card statement (card=${v.cardScore}, deposit=${v.depositScore}, hits: ${v.hits.join(", ")}). Excluding a real income document understates a borrower's income — the 2026-08-01 Wilson failure. Widen the deposit test or raise the threshold.`);
    } else if (known) {
      keptCards.push(`${label} card=${v.cardScore} deposit=${v.depositScore}`);
      problems.push(`FALSE NEGATIVE: ${label} is a Chase CREDIT-CARD statement and was NOT rejected (card=${v.cardScore}, deposit=${v.depositScore}). It would be read as a deposit statement and its payments counted as income.`);
    }
  }

  // The anchors must still be present. If the documents were deleted, this guard silently stops
  // testing the thing it was built for — absence of data reading as absence of a problem.
  const missing = KNOWN_CARDS.filter((k) => !seenKnown.has(k));
  if (missing.length === KNOWN_CARDS.length) {
    problems.push(`none of the anchor card statements (${KNOWN_CARDS.join(", ")}) are in the corpus any more. This guard is no longer measuring the defect it was built for — re-anchor it on a current card statement rather than leaving it green over nothing.`);
  } else if (missing.length) {
    console.log(`note: ${missing.length} anchor doc(s) no longer present: ${missing.join(", ")} (${KNOWN_CARDS.length - missing.length} still measured)`);
  }

  console.log(`income-candidate PDFs: ${candidates.length} | text read: ${read} | scans (never judged): ${scans}`);
  console.log(`rejected as credit-card statements: ${rejected.length}`);
  for (const r of rejected) console.log(`  • ${r}`);

  if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  console.log(`\nPASS — card statements are excluded from income by CONTENT, the route calls the check on the name-matched path, and ${read - rejected.length} real income documents were kept.`);
}

main().catch((e) => { console.error("verify:card-statement:", e.message); process.exit(1); });
