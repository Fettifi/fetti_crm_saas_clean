// WHICH ISSUED LETTERS CARRY THE COMPANY ID IN THE INDIVIDUAL ORIGINATOR'S FIELD.
//
// `preapprovals.officer_nmls` renders into ONE line, on both surfaces of the letter:
//
//     Mortgage Loan Originator · NMLS #<officer_nmls> · Fetti Financial Services LLC
//
// That line is the individual originator's unique identifier. Fetti's COMPANY id (2267023) is
// already printed twice on the same page — the letterhead and the licensing footer — so a
// company id in this field is not a duplicate disclosure, it is the wrong licence in a field
// labelled as somebody's personal one, on a document that goes to the listing agent.
//
// READ-ONLY. It reports; it changes nothing. Ramon decides whether an already-delivered letter
// gets reissued.
//
//   npx tsx scripts/audit-preapproval-nmls.ts
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { BRAND } from "../lib/brand";

// A mock admin client answers every query with `{ data: null }` and no throw. An audit that
// counted rows against it would print "0 letters affected" and be believed.
if (typeof (supabaseAdmin as any)?.from !== "function") {
  console.error("FAIL — no admin client at all.");
  process.exit(1);
}

(async () => {
  const probe = await supabaseAdmin.from("preapprovals").select("id").limit(1);
  if (probe.error) {
    console.error(`FAIL — cannot read preapprovals: ${probe.error.message}`);
    console.error("       (a missing SUPABASE_SERVICE_ROLE_KEY yields the mock client, whose");
    console.error("        every answer is null — that would read as 'nothing is wrong')");
    process.exit(1);
  }

  const { data, error } = await supabaseAdmin
    .from("preapprovals")
    .select("id, letter_number, borrower_name, officer_name, officer_nmls, status, created_at, expires_on")
    .order("created_at", { ascending: true });
  if (error) { console.error(`FAIL — ${error.message}`); process.exit(1); }

  const rows = data || [];
  const norm = (s: any) => String(s ?? "").replace(/[^0-9]/g, "");
  const company = rows.filter((r: any) => norm(r.officer_nmls) === BRAND.nmls);
  const correct = rows.filter((r: any) => norm(r.officer_nmls) === BRAND.mlo.nmls);
  const blank = rows.filter((r: any) => !norm(r.officer_nmls));
  const other = rows.filter((r: any) => {
    const n = norm(r.officer_nmls);
    return n && n !== BRAND.nmls && n !== BRAND.mlo.nmls;
  });

  // "LIVE" MEANS WHAT THE SHIPPING ROUTES MEAN BY IT, not what reads plausibly. Both
  // app/api/letter/[token]/route.ts and .../pdf/route.ts refuse a letter on exactly this test,
  // and the stored status is "void" — an earlier version of this audit tested `!== "voided"`,
  // which is never true of any row, and so reported all 14 as live including the 3 voided ones.
  const live = (r: any) => r.status !== "void" && !(r.expires_on && new Date(r.expires_on) < new Date());

  console.log(`\nPRE-APPROVAL LETTERS — officer_nmls audit\n`);
  console.log(`  total issued letters ................ ${rows.length}`);
  console.log(`  company id (#${BRAND.nmls}) in the officer field ... ${company.length}   <-- wrong`);
  console.log(`      of those, still live (not voided/expired) .. ${company.filter(live).length}`);
  console.log(`  individual MLO id (#${BRAND.mlo.nmls}) ............. ${correct.length}`);
  console.log(`  blank ............................... ${blank.length}`);
  console.log(`  some other id ....................... ${other.length}`);

  if (company.length) {
    console.log(`\n  letters carrying the company id:`);
    for (const r of company) {
      console.log(`    ${String(r.letter_number || r.id).padEnd(18)} ${String(r.borrower_name || "").padEnd(30)} ` +
        `${String(r.created_at || "").slice(0, 10)}  ${r.status}${live(r) ? "" : "  (not live)"}`);
    }
  }
  if (other.length) {
    console.log(`\n  letters carrying an unrecognised id:`);
    for (const r of other) console.log(`    ${r.letter_number}  officer_nmls=${JSON.stringify(r.officer_nmls)}  (${r.officer_name})`);
  }
  console.log(`\n  READ-ONLY — nothing was changed.\n`);
})();
