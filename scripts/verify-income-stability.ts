// INCOME STABILITY GUARD — run this BEFORE shipping anything that touches income.
//
//   npm run verify:income            check every live file against the baseline
//   npm run verify:income -- --save  re-baseline (only after a change is APPROVED)
//
// WHY THIS EXISTS. On 2026-08-01 I changed INCOME_RE to pick up a DD-214 and a COE, believing
// a constant named MAX_DOCS capped the read at 8 documents. It does not — it only orders the
// list. Both documents were read, the doc-set fingerprint moved, the stability cache missed,
// and the Wilson file re-rolled from a settled $11,701/mo to $3,129/mo with the co-borrower
// gone. Zero documents had been uploaded in between; the whole delta was mine. I had "tested"
// the change — but only that the documents entered the CANDIDATE list, never what was read or
// what happened to the income.
//
// Ramon: "There's not supposed to be a document cap. We've gone over this time and time again.
// Every time you fix something, you go back and break shit, which cost me extra money."
//
// So this is not another promise to be careful. It is the check that makes carefulness
// unnecessary: it compares, for EVERY live loan file, the exact inputs that decide whether a
// borrower's settled income number survives — and fails loudly if any of them moved.
//
// WHAT IT COMPARES, and why each one matters:
//   • The income-document CANDIDATE SET per file. This is what feeds the reader AND what the
//     cache fingerprints. One extra document silently re-rolls a settled file.
//   • LOGIC_VERSION. It is global: bumping it invalidates the cache for EVERY file at once,
//     so every borrower's number re-rolls on the next verify.
//   • The CACHED income numbers themselves, so a number that changed without a document
//     changing is impossible to miss.
//
// A failure here is not necessarily a bug — adding a real income document SHOULD change a
// file. The point is that it can never happen WITHOUT SOMEONE SEEING IT FIRST.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const ROUTE = "app/api/los/files/[id]/verify-income/route.ts";
const BASELINE = path.join(process.cwd(), "scripts", "income-baseline.json");

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    out[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  }
  return out;
}

/** Read the LIVE regex and version out of the route, so this can never test a stale copy. */
function routeConstants(): { incomeRe: RegExp; logicVersion: string } {
  const src = readFileSync(path.join(process.cwd(), ROUTE), "utf8");
  const re = src.match(/const INCOME_RE = (\/.*\/i);/);
  const lv = src.match(/const LOGIC_VERSION = "([^"]+)";/);
  if (!re || !lv) throw new Error("could not read INCOME_RE / LOGIC_VERSION from the route — did it get renamed?");
  // eslint-disable-next-line no-eval
  return { incomeRe: eval(re[1]) as RegExp, logicVersion: lv[1] };
}

type Snapshot = {
  logicVersion: string;
  incomeRe: string;
  files: Record<string, { file: string; borrower: string; candidates: string[]; cachedIncome: number | null }>;
};

async function snapshot(): Promise<Snapshot> {
  const e = env();
  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);
  const { incomeRe, logicVersion } = routeConstants();

  const { data: files, error: fe } = await sb.from("loan_files").select("id, file_number, borrower_name");
  if (fe) throw new Error(`loan_files: ${fe.message}`);
  const { data: docs, error: de } = await sb
    .from("loan_documents").select("id, loan_file_id, name, category, file_name, storage_path");
  if (de) throw new Error(`loan_documents: ${de.message}`);
  const { data: cached, error: ce } = await sb
    .from("app_settings").select("key, value").like("key", "los_income_verify:%");
  if (ce) throw new Error(`app_settings: ${ce.message}`);

  const cacheByFile = new Map<string, number | null>();
  for (const row of (cached || []) as any[]) {
    let income: number | null = null;
    try { income = JSON.parse(row.value)?.payload?.qualifyingMonthlyIncome ?? null; } catch { /* corrupt */ }
    cacheByFile.set(String(row.key).split(":")[1], income);
  }

  // EXACTLY the route's own predicate. If the route changes how it selects, this must change
  // with it — and the diff will show up as every file moving at once, which is the signal.
  const isIncomeDoc = (d: any) =>
    !!d.storage_path &&
    (String(d.category || "").toLowerCase() === "income" ||
      incomeRe.test(`${d.name || ""} ${d.file_name || ""} ${d.category || ""}`));

  const out: Snapshot = { logicVersion, incomeRe: incomeRe.source, files: {} };
  for (const f of (files || []) as any[]) {
    const candidates = (docs || [])
      .filter((d: any) => d.loan_file_id === f.id && isIncomeDoc(d))
      .map((d: any) => `${d.id}|${d.name || d.file_name || ""}`)
      .sort();
    out.files[f.id] = {
      file: f.file_number || f.id,
      borrower: f.borrower_name || "?",
      candidates,
      cachedIncome: cacheByFile.get(f.id) ?? null,
    };
  }
  return out;
}

const money = (n: number | null) => (n == null ? "—" : "$" + n.toLocaleString());

async function main() {
  const save = process.argv.includes("--save");
  const now = await snapshot();

  if (save || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2));
    console.log(`${existsSync(BASELINE) && !save ? "No baseline existed — created" : "Baseline saved"}: ${Object.keys(now.files).length} files, LOGIC_VERSION=${now.logicVersion}`);
    if (!save) console.log("Re-run without --save to check against it.");
    return;
  }

  const base: Snapshot = JSON.parse(readFileSync(BASELINE, "utf8"));
  const problems: string[] = [];
  const notes: string[] = [];

  if (base.logicVersion !== now.logicVersion) {
    problems.push(
      `LOGIC_VERSION changed ${base.logicVersion} -> ${now.logicVersion}. This is GLOBAL: every ` +
      `cached file re-reads on its next verify, and the AI read is non-deterministic, so every ` +
      `borrower's settled number can move. Only bump this when the MATH genuinely changed, and ` +
      `expect to re-verify each open file afterwards.`
    );
  }
  if (base.incomeRe !== now.incomeRe) {
    notes.push("INCOME_RE changed — per-file candidate diffs below show the real blast radius.");
  }

  for (const [id, b] of Object.entries(base.files)) {
    const n = now.files[id];
    if (!n) { notes.push(`file removed: ${b.file} (${b.borrower})`); continue; }
    const added = n.candidates.filter((c) => !b.candidates.includes(c));
    const removed = b.candidates.filter((c) => !n.candidates.includes(c));
    if (added.length || removed.length) {
      problems.push(
        `${b.borrower} (${b.file}): income document set changed ` +
        `${b.candidates.length} -> ${n.candidates.length}. Its cached income ${money(b.cachedIncome)} ` +
        `WILL be invalidated and re-read.` +
        added.map((a) => `\n      + ${a.split("|")[1]}`).join("") +
        removed.map((r) => `\n      - ${r.split("|")[1]}`).join("")
      );
    } else if (b.cachedIncome != null && n.cachedIncome != null && b.cachedIncome !== n.cachedIncome) {
      problems.push(
        `${b.borrower} (${b.file}): qualifying income moved ${money(b.cachedIncome)} -> ${money(n.cachedIncome)} ` +
        `with NO change to the documents. That is the 2026-07-22 complaint ("different this week on the ` +
        `same file") and it should never happen on its own.`
      );
    }
  }
  for (const [id, n] of Object.entries(now.files)) {
    if (!base.files[id]) notes.push(`new file: ${n.borrower} (${n.file}) — ${n.candidates.length} income docs`);
  }

  for (const n of notes) console.log(`note: ${n}`);
  if (!problems.length) {
    console.log(`PASS — ${Object.keys(now.files).length} files, no income document set or settled number moved.`);
    return;
  }
  console.error(`\nFAIL — ${problems.length} file(s) would change:\n`);
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error("If every one of these is intended, re-baseline with:  npm run verify:income -- --save");
  process.exit(1);
}

main().catch((e) => { console.error("verify-income-stability:", e.message); process.exit(1); });
