// OVERRIDE EXEMPLARS — turn Ramon's own reversals into few-shot guidance for the QC pass.
//
// Ramon, 2026-08-01: "wire the 25 overrides into the prompts."
//
// The 25 income.flag_omitted events are the highest-signal supervision the business produces:
// each one is a licensed broker looking at a flag the engine raised and saying "no, count that
// income." Too few to fine-tune on (see scripts/dataset/train.sh check), but exactly the right
// size for few-shot exemplars in the QC prompt that raises those flags in the first place.
//
//   npx tsx scripts/dataset/exemplars.ts          preview
//   npx tsx scripts/dataset/exemplars.ts --write  emit lib/income/overrideExemplars.ts
//
// GENERATED TO A COMMITTED FILE, NEVER READ AT RUNTIME. A prompt that silently changes as data
// accumulates would make income non-reproducible — the exact complaint that created the
// stability cache ("income I verified last week is different this week on the same file").
// Regenerating is a deliberate, reviewable, version-bumped act.
//
// Redaction is the same standard as the dataset miner: these strings end up in a prompt sent to
// a third-party API on every verification, so no borrower identity may survive.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");
const e = Object.fromEntries(readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g, EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// Capitalised tokens that are NOT identities — program, agency and document vocabulary. Anything
// capitalised and absent from this list is treated as a proper noun and removed.
const SAFE = new Set(["VA","FHA","DSCR","USDA","HELOC","IRS","W","YTD","OT","QC","LOE","VOE","SSA",
  "SSI","VACP","TREAS","BAH","BAS","LES","COE","DD","MTA","IHSS","LLC","INC","CO","PITIA","DTI",
  "LTV","ARV","STR","MFJ","Fannie","Freddie","Overtime","Rising","Prior","Base","Reasonableness",
  "Omit","Qualified","Verify","Confirm","Needs","Monthly","Annual","January","February","March",
  "April","May","June","July","August","September","October","November","December"]);

/** GENERALISE, don't just redact. "Rasja" leaked because she is an IHSS recipient — a third
 *  party in no roster, so no allowlist could have caught her. The only safe rule when the
 *  identity space is unbounded is to strip every proper noun. It also makes the exemplar BETTER:
 *  "unfiled current-year W-2/1099 corroborate only" transfers to any file, while
 *  "Extreme Reach $9k" teaches nothing about the next borrower. */
function generalise(t: string): string {
  return t
    // multi-word Proper Noun runs -> a role placeholder
    .replace(/\b([A-Z][a-zA-Z'`-]{2,}(?:\s+(?:of|the|and|de|la)\s+)?(?:\s+[A-Z][a-zA-Z'`-]{1,}){0,4})\b/g,
      (m) => m.split(/\s+/).every((w) => SAFE.has(w.replace(/[^A-Za-z]/g, ""))) ? m : "[REDACTED]")
    .replace(/\[REDACTED\](\s+\[REDACTED\])+/g, "[REDACTED]")
    // dollar figures carry no lesson and can fingerprint a file
    .replace(/\$\s?[\d,]+(?:\.\d+)?(?:k|K)?/g, "$X")
    // dates likewise
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[DATE]")
    .replace(/\s{2,}/g, " ").trim();
}

function scrub(text: string, names: string[]): string {
  let t = String(text || "");
  for (const n of [...new Set(names.filter((x) => x && x.trim().length > 2))].sort((a, b) => b.length - a.length)) {
    for (const part of [n, ...n.split(/\s+/)].filter((p) => p.length >= 3)) {
      t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "the borrower");
    }
  }
  t = t.replace(SSN, "[SSN]").replace(EMAIL, "[EMAIL]").replace(PHONE, "[PHONE]");
  return generalise(t);
}

async function main() {
  const { data: leads } = await sb.from("leads").select("id, full_name, raw");
  const { data: files } = await sb.from("loan_files").select("id, lead_id, borrower_name, product");
  const nameOf = new Map((leads || []).map((l: any) => [l.id, l.full_name || ""]));
  const fileOf = new Map((files || []).map((f: any) => [f.id, f]));

  // SCRUB AGAINST EVERY NAME IN THE BUSINESS, not just this file's primary borrower.
  // The first version leaked "Paul" and "Rasja" — CO-borrowers, who are not in
  // loan_files.borrower_name. That is the same blind spot that put Paul's VA compensation on
  // Jazmine's line this morning: the roster the code knows about is not the roster on the loan.
  // These strings are sent to a third-party API on every verification, so over-redacting a
  // common word is the acceptable failure and leaking a borrower's name is not.
  const everyName: string[] = [];
  for (const l of (leads || []) as any[]) {
    if (l.full_name) everyName.push(String(l.full_name));
    const co = l.raw?.co_full_name; if (co) everyName.push(String(co));
  }
  for (const f of (files || []) as any[]) if (f.borrower_name) everyName.push(String(f.borrower_name));
  const NAME_POOL = [...new Set(everyName.flatMap((n) => [n, ...n.split(/\s+/)])
    .map((x) => x.trim()).filter((x) => x.length >= 3))];

  const { data: omits } = await sb.from("activity_log")
    .select("created_at, detail, loan_file_id, lead_id").eq("action", "income.flag_omitted").order("created_at");

  const seen = new Set<string>();
  const out: { product: string; flag: string }[] = [];
  for (const r of (omits || []) as any[]) {
    const f: any = fileOf.get(r.loan_file_id);
    const flag = scrub(String(r.detail?.flag || ""), NAME_POOL);
    if (flag.length < 50) continue;
    if (SSN.test(flag) || EMAIL.test(flag)) continue;          // never ship an identifying row
    // Dedupe on the first 10 words: the same flag recurs across files and 25 near-identical
    // exemplars would teach the model one lesson while costing 25 lessons' worth of tokens.
    const key = flag.toLowerCase().replace(/\[redacted\]|\$x|\[date\]/g, "").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ product: f?.product || "unknown", flag: flag.slice(0, 320) });
  }

  console.log(`${(omits || []).length} overrides on record -> ${out.length} distinct exemplars after redaction + dedupe\n`);
  out.forEach((o, i) => console.log(`  ${i + 1}. [${o.product}] ${o.flag.slice(0, 150)}${o.flag.length > 150 ? "…" : ""}`));

  if (!WRITE) { console.log(`\n(preview — re-run with --write to emit lib/income/overrideExemplars.ts)`); return; }

  const body = `// GENERATED by scripts/dataset/exemplars.ts — do not hand-edit.
//
// Real flags this engine raised that Ramon, a licensed broker, then OVERRULED — he counted the
// income anyway. They are injected into the QC prompt so the reviewer learns which cautions are
// noise on THIS book of business, instead of raising the same objection he has already rejected
// ${out.length} times.
//
// Regenerate deliberately (npx tsx scripts/dataset/exemplars.ts --write) and bump LOGIC_VERSION:
// this text changes QC output, and a silently drifting prompt is how income stops being
// reproducible.
//
// Redacted at generation: names -> "the borrower", SSN/email/phone stripped, and any row still
// identifying is dropped rather than shipped.
export const OVERRIDE_EXEMPLARS: { product: string; flag: string }[] = ${JSON.stringify(out, null, 2)};

/** The block appended to VERIFY_SYSTEM. Empty string when there are no exemplars. */
export function overrideGuidance(): string {
  if (!OVERRIDE_EXEMPLARS.length) return "";
  const lines = OVERRIDE_EXEMPLARS.map((o) => \`  - [\${o.product}] \${o.flag}\`).join("\\n");
  return \`

FLAGS THIS LENDER HAS ALREADY REJECTED. The following are real flags this engine raised and the
licensed broker then OVERRULED, counting the income anyway. They are not rules, and they do not
license you to skip a check — but if your finding is materially the same objection as one below,
it has been judged noise on this book of business before. Raise it only if THIS file gives you a
specific reason the earlier judgement does not apply, and say what that reason is.

\${lines}\`;
}
`;
  writeFileSync(path.join(ROOT, "lib/income/overrideExemplars.ts"), body);
  console.log(`\nwrote lib/income/overrideExemplars.ts (${out.length} exemplars)`);
}

main().catch((err) => { console.error("exemplars failed:", err.message); process.exit(1); });
