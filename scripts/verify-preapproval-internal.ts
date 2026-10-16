// AN internalOnly FIELD MUST NEVER REACH THE PUBLIC LETTER BLOB.
//
// 2026-10-16. app/api/preapprovals/route.ts built the letter payload as:
//
//     const letterKeys = [...EXTRA_KEYS, ...PA_INTERNAL_KEYS, "other_terms"].filter((k) => !hide.has(k));
//
// so every field flagged `internalOnly` was published to the PUBLIC letter unless Ramon had
// separately ticked it off on that one letter. That is the opposite of the flag's name, of the
// registry's intent, and of what the UI states in app/preapprovals/page.tsx: "Captured off the
// sheet for Ramon, deliberately NOT printed and NOT stored in the blob the public letter routes
// read."
//
// What a share link could therefore carry — and a pre-approval letter exists to be forwarded to the
// listing agent on the other side of the deal:
//   broker_comp           "Lender-paid 2.000% ($6,375)"   our compensation
//   lender_rebate_ysp     "0.375% at 10.25%"              our rebate
//   base_price            par rate
//   pricing_adjustments   LLPAs
//   credit_score          the borrower's representative FICO
//   cash_to_close         what the borrower is bringing
//   arv / ltarv           after-repair value and LTARV
//
// A per-letter opt-out is not a control when the default is "publish". The fix inverts it: internal
// keys are never candidates for the letter, and `hidden` can only remove MORE from what was already
// publishable.
//
//   npx tsx scripts/verify-preapproval-internal.ts            # 0 clean · 1 defect
//   npx tsx scripts/verify-preapproval-internal.ts --selftest
import { readFileSync } from "fs";
import { PA_FIELDS, PA_INTERNAL_KEYS } from "../lib/preapprovalFields";

const ROUTE = "app/api/preapprovals/route.ts";
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

/** The line that decides what the public letter carries. */
export function letterKeysLine(src: string): string {
  const m = strip(src).match(/^.*const\s+letterKeys\s*=.*$/m);
  return m ? m[0] : "";
}

export type Check = { name: string; ok: boolean; why: string };

export function audit(src: string): Check[] {
  const line = letterKeysLine(src);
  const internalLine = (strip(src).match(/^.*const\s+internal\s*=.*$/m) || [""])[0];
  return [
    { name: "the letterKeys line exists at all", ok: !!line, why: line ? "" : "cannot find it — the guard cannot see what it protects" },
    { name: "PA_INTERNAL_KEYS is NOT spread into the public letter payload",
      ok: !!line && !/PA_INTERNAL_KEYS/.test(line),
      why: /PA_INTERNAL_KEYS/.test(line) ? "letterKeys spreads PA_INTERNAL_KEYS — internal fields publish by default" : "absent, as it must be" },
    { name: "the internal bucket still receives EVERY internal key, not just hidden ones",
      ok: /PA_INTERNAL_KEYS/.test(internalLine) && !/\[\.\.\.PA_INTERNAL_KEYS,\s*\.\.\.EXTRA_KEYS\]\.filter/.test(internalLine),
      why: "internal must be [...PA_INTERNAL_KEYS, ...EXTRA_KEYS.filter(hidden)] — not a filter applied across both" },
    { name: "`hidden` is still honoured for publishable fields",
      ok: !!line && /hide\.has/.test(line),
      why: "removing the opt-out would be a different regression" },
  ];
}

if (process.argv.includes("--selftest")) {
  let bad = 0;
  const ck = (n: string, c: boolean, d = "") => { if (!c) bad++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
  console.log("\nSELFTEST — verify-preapproval-internal\n");

  const SHIPPED = `const letterKeys = [...EXTRA_KEYS, ...PA_INTERNAL_KEYS, "other_terms"].filter((k) => !hide.has(k));
    const internal = take([...PA_INTERNAL_KEYS, ...EXTRA_KEYS].filter((k) => hide.has(k)));`;
  const FIXED = `const letterKeys = [...EXTRA_KEYS, "other_terms"].filter((k) => !hide.has(k));
    const internal = take([...PA_INTERNAL_KEYS, ...EXTRA_KEYS.filter((k) => hide.has(k))]);`;

  ck("the REAL shipped line is caught", !audit(SHIPPED).find((c) => c.name.startsWith("PA_INTERNAL_KEYS is NOT"))!.ok);
  ck("…and the reason says it publishes by default",
     /publish by default/.test(audit(SHIPPED).find((c) => c.name.startsWith("PA_INTERNAL_KEYS is NOT"))!.why));
  ck("the shipped internal bucket is ALSO caught (hidden-only)",
     !audit(SHIPPED).find((c) => c.name.startsWith("the internal bucket"))!.ok);
  ck("the fixed version passes every check", audit(FIXED).every((c) => c.ok));
  ck("a COMMENT mentioning PA_INTERNAL_KEYS does not trip it",
     audit(`// letterKeys used to spread PA_INTERNAL_KEYS\n${FIXED}`).every((c) => c.ok));
  ck("dropping the hide opt-out is caught as its own regression",
     !audit(`const letterKeys = [...EXTRA_KEYS, "other_terms"];\nconst internal = take([...PA_INTERNAL_KEYS, ...EXTRA_KEYS.filter((k) => hide.has(k))]);`)
        .find((c) => c.name.startsWith("`hidden` is still"))!.ok);

  // The registry itself must still flag the fields this protects — if internalOnly disappeared,
  // the guard above would pass vacuously on an empty set.
  ck(`the registry still flags internal fields (${PA_INTERNAL_KEYS.length})`, PA_INTERNAL_KEYS.length > 0);
  for (const k of ["broker_comp", "lender_rebate_ysp", "credit_score"])
    ck(`…including ${k}`, PA_INTERNAL_KEYS.includes(k));
  ck("every PA_INTERNAL_KEYS entry really is flagged internalOnly",
     PA_INTERNAL_KEYS.every((k) => PA_FIELDS.find((f) => f.key === k)?.internalOnly === true));

  const live = audit(readFileSync(ROUTE, "utf8"));
  for (const c of live) ck(`LIVE: ${c.name}`, c.ok, c.why);

  console.log(bad ? `\n❌ ${bad} failed\n` : "\n✅ ALL PASS\n");
  process.exit(bad ? 1 : 0);
}

const checks = audit(readFileSync(ROUTE, "utf8"));
console.log(`\nPRE-APPROVAL INTERNAL FIELDS — ${ROUTE}\n`);
let bad = 0;
for (const c of checks) { if (!c.ok) bad++; console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.why ? ` — ${c.why}` : ""}`); }
if (!bad) {
  console.log(`\n✅ CLEAN — ${PA_INTERNAL_KEYS.length} internalOnly field(s) stay off the public letter.\n`);
  process.exit(0);
}
console.log(`\n❌ Broker compensation, YSP and borrower FICO can reach a public share link.\n`);
process.exit(1);
