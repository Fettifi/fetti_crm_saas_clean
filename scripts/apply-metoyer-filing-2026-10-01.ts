// One-off: apply the 2026-10-01 document-identification pass to the LOS.
//
// Ramon asked for two things — label documents correctly and put them in the right category, and delete
// TRUE duplicates. Both must happen on `loan_documents`, because the mirror is a projection of it: a local
// delete is re-pulled within 60s and a local rename is re-UPLOADED as a new document.
// [[renaming-the-mirror-pushes-a-duplicate]]
//
// Rows are addressed by (borrower, name, file_name) rather than by uuid so the script is readable and
// reviewable. Every target is matched EXACTLY and uniquely, or the script refuses outright.
//
// Deletions are only ever of bytes that survive elsewhere on the same loan file — asserted per row.
import "./_env";
import { createHash } from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdminClient";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = process.env.FETTI_DOCS_ROOT || join(homedir(), "Fetti Loan Files");
const DRY = !process.argv.includes("--apply");

// `id` is only supplied where (borrower, name, file) is genuinely ambiguous — Corine Lucas holds two
// rows for 11521.jpg with identical name AND filename, so the pair can only be told apart by uuid.
type Key = { borrower: string; name: string; file: string; id?: string };

// ── RELABEL: what the document actually is, read this session or sha-attested ──────────────────
const RELABEL: Array<Key & { newName?: string; newCategory?: string; note: string }> = [
  { borrower: "jazmine wilson", name: "W-2s — last 2 years", file: "Jazmine_Wilson_24_25_W-2.pdf",
    note: "[read 2026-10-01] W-2 set, JAZMINE N WILSON, Santa Monica Community College, EIN 95-2767537. 2025 Box 1 74,061.80 but Boxes 3/5 SS/Medicare wages 80,489.00. 2024 Box 1 70,533.04 but 76,654.00. Box 13 Retirement Plan CHECKED both years — pre-tax deferrals cut taxable wages, not gross. QUALIFY ON GROSS 80,489.00 (6,707.42/mo), not Box 1 (6,171.82/mo): a 535.60/mo difference. Contains an unmasked SSN on the 2025 page." },
  { borrower: "jazmine wilson", name: "2023 Tax return", file: "Fed_TY_2023.pdf.pdf",
    note: "[read 2026-10-01] 2023 Form 1040, MARRIED FILING JOINTLY — Paul L Davis and Jazmine Wilson, 5416 Fair Ave #8107, North Hollywood CA 91601. Line 1a (sum of all W-2 box 1) 77,461. Schedule 1 additional income 8,840. Total income and AGI 86,301. Taxable 58,601. Image-only scan, rendered and read." },
  { borrower: "Asia Dearman", name: "recent paystub", file: "EmployeePayStub__16_.pdf",
    newName: "Pay stubs — last 30 days", newCategory: "Income",
    note: "[read 2026-10-01] LA Metro (LACMTA) Employee Pay Stub, ASIA T DEARMAN, emp ID 050139, rate 30.43/hr, period ending 06-07-2026. NOT a W-2 — it was also filed under 'W-2s — last 2 years — additional', which has been removed." },
  { borrower: "Asia Dearman", name: "Pay stubs — last 30 days — additional", file: "EmployeePayStub__14_.pdf",
    note: "[read 2026-10-01] LA Metro (LACMTA) Employee Pay Stub, ASIA T DEARMAN, emp ID 050139, status H-OF-H, RATE 31.65/hr — a raise from the 30.43 on the 06-07-2026 stub. Period 06/21/2026-07/04/2026, pay date 07/10/2026. Gross current 4,726.95, YTD 53,475.09, net 3,353.75. NOT a W-2." },
  { borrower: "Corine Lucas", name: "Mortgage statement", file: "GetDocumentbyID.pdf",
    note: "[read 2026-10-01] Select Portfolio Servicing mortgage statement, statement date 07-15-2026, P&I 2,582.05, escrow 378.73. Matches the SPS first-mortgagee loan …2318 on the USAA declarations page." },
  { borrower: "Corine Lucas", name: "Homeowners insurance quote — additional", file: "11520.jpg",
    newName: "Homeowners insurance quote", newCategory: "Property",
    note: "[read 2026-10-01] *** THIS IS THE DECLARATIONS PAGE *** USAA General Indemnity HOMEOWNERS POLICY DECLARATIONS, CORINE LUCAS, 19221 Demeter Ave, Cerritos CA 90703-6810. Policy GIC 06179 49 15 90A, period 02/12/26-02/12/27. Coverage A dwelling 946,000; B 94,600; C 709,500; D 189,200; liability 500,000; med pay 5,000. All-perils deductible 9,460 (1%). Premium 2,977.82. FIRST MORTGAGEE Select Portfolio Servicing Inc ISAOA/ATIMA, loan …2318. Every endorsement ratio reconciles against Coverage A, which confirms the column alignment." },
  { borrower: "Corine Lucas", name: "Homeowners insurance quote — additional", file: "11518.jpg",
    note: "[read 2026-10-01] USAA Homeowners Policy Packet cover page — CORINE LUCAS, 19221 Demeter Ave, Cerritos CA 90703-6810, policy GIC 06179 49 15, EFFECTIVE 02-12-26 TO 02-12-27. Identifies the policy and its term; the coverage detail is on 11520 (declarations)." },
  { borrower: "Corine Lucas", name: "Homeowners insurance quote — additional", file: "11521.jpg", id: "0dbd62d7-6b74-470f-a42a-63bfba586df5",
    note: "[read 2026-10-01] NOT a quote and NOT a declarations page — page 6 of the USAA policy BOOKLET (form QR3GIC 07-08), the Quick Reference contents. No insured, no address, no coverage, no premium. Carries no evidentiary weight on its own." },
  { borrower: "Magali Lopez Villafuerte", name: "Tax returns — last 2 years", file: "2024_TaxReturn.pdf",
    note: "[read 2026-10-01] 2024 Form 1040, 21 pages. It was ALSO filed in the required '2024 w2' slot, which has been removed — her real 2024 W-2 is on file as 2024w2.PDF under 'W-2s — last 2 years — additional'." },
  { borrower: "Mario Washington", name: "W-2s — last 2 years — additional", file: "W2_LW_2025.pdf",
    newName: "LaTonya Washington — 2024 Form 1099-R", newCategory: "Income",
    note: "[read 2026-09-25, relabelled 2026-10-01] NOT a W-2. Form 1099-R for LATONYA WASHINGTON, New Orleans Municipal Employees Retirement System, TOTAL distribution 19,931.62. It sat in a W-2 slot for five weeks under a filename the borrower chose." },
  { borrower: "Michelle Jackson Metoyer", name: "Lease agreement or market rent estimate (Form 1007)", file: "Rental_Anthony_2021_.pdf",
    note: "[read 2026-10-01, attested 2026-09-25] Residential lease, 4235 8th Ave, landlord Michelle Jackson, tenant ANTHONY RAY-BRANTLEY MCCONNELL. 6 pages, signed 7/20/2021, commencing 07/22/2021 at 2,750/mo, 6-month term. SUPERSEDED on rent: the Civil Code 827 notice raises it to 2,954.00 effective 01/01/2026. Para 32 references an attachment 'item 4' that we do not hold." },
  { borrower: "Michelle Jackson Metoyer", name: "Lease agreement or market rent estimate (Form 1007) — additional", file: "Rental_4231_Janie_2026.pdf",
    note: "[attested 2026-09-25] Residential lease, 4231 8th Ave, tenant JANIE McQUEEN — 3,100/mo through 02-05-2027. 8 pages, COMPLETE, landlord and tenant both signed 2.5.26. Para 40 additional-terms box CHECKED, attachment not held." },
  { borrower: "Michelle Jackson Metoyer", name: "Lease agreement or market rent estimate (Form 1007) — additional", file: "Rental_4233_Denise_Waller_2026.pdf",
    note: "[attested 2026-09-25] Residential lease, 4233 8th Ave, tenant DENISE WALLER — 2,850/mo through 07-01-2027. 7 pages, INCOMPLETE: stops mid-para 42, signature page (p8) MISSING; para 40 annotated 'items #1 - #11', attachment not held. Still owed by the borrower." },
  { borrower: "Michelle Jackson Metoyer", name: "Lease agreement or market rent estimate (Form 1007) — additional", file: "Rental_Increase_4235_Anthony_.pdf",
    note: "[attested 2026-09-25] Change of Terms of Tenancy (Civil Code 827 notice), Dennis P. Block & Associates form, TO Anthony McConnell, 4235 8th Ave. Monthly rent increases to 2,954.00 EFFECTIVE 01/01/2026 — this is the operative rent, not the 2,750 on the 2021 lease." },
];

// ── DELETE: byte-identical duplicates. `because` records why this row and not its sibling. ──────
const DELETE: Array<Key & { because: string }> = [
  { borrower: "jazmine wilson", name: "W-2s_last_2_years_Jazmine_N_Wilson_Santa_Monica_College_2025_Box_1_74_061.80_but_gross_80_489.00_2024_70_533.04_but_gros", file: "W-2s_last_2_years_Jazmine_N_Wilson_Santa_Monica_College_2025_Box_1_74_061.80_but_gross_80_489.00_2024_70_533.04_but_gros", because: "pushed by my own mirror rename 2026-10-01 16:58; the W-2 set already lives in the required slot" },
  { borrower: "jazmine wilson", name: "Tax returns — last 2 years — additional", file: "Fed_TY_2023.pdf.pdf", because: "same bytes as the required '2023 Tax return' slot, which is the correct home for a 2023 1040" },
  { borrower: "Asia Dearman", name: "Pay stubs — last 30 days — additional", file: "EmployeePayStub__16_.pdf", id: "3287079a-8444-4390-ba5d-c041ff0f3e8d", because: "duplicate of the 06-07-2026 stub kept in the required 'recent paystub' slot (relabelled to Income / Pay stubs — last 30 days in this run)" },
  { borrower: "Asia Dearman", name: "Pay stubs — last 30 days — additional", file: "EmployeePayStub__16_.pdf", id: "08b83804-8f86-4d00-a7cd-7f4b50ab39da", because: "fourth upload of the same 06-07-2026 stub" },
  { borrower: "Asia Dearman", name: "W-2s — last 2 years — additional", file: "EmployeePayStub__16_.pdf", because: "MIS-FILED: a pay stub in a W-2 slot; verified by reading it" },
  { borrower: "Asia Dearman", name: "W-2s — last 2 years — additional", file: "EmployeePayStub__14_.pdf", because: "MIS-FILED: a pay stub in a W-2 slot; verified by reading it" },
  { borrower: "Asia Dearman", name: "recent paystub — additional", file: "EmployeePayStub__14_.pdf", because: "duplicate of the 07-10-2026 stub kept under 'Pay stubs — last 30 days — additional'" },
  { borrower: "Asia Dearman", name: "Pay_stubs_last_30_days_LA_Metro_LACMTA_Asia_T_Dearman_rate_30.43-hr_period_ending_06-07-2026.pdf", file: "Pay_stubs_last_30_days_LA_Metro_LACMTA_Asia_T_Dearman_rate_30.43-hr_period_ending_06-07-2026.pdf", because: "pushed by my own mirror rename 2026-10-01 17:02" },
  { borrower: "Brijanae Aubrey", name: "2024 W2 — additional", file: "2024-W2_2.pdf", because: "same bytes as the required '2024 W2' slot" },
  { borrower: "Brijanae Aubrey", name: "2025 W2 — additional", file: "W2_002355099_0905536_2025_2.pdf", because: "same bytes as the required '2025 W2' slot" },
  { borrower: "Brijanae Aubrey", name: "2024 W2 — additional", file: "W2_002355099_1470414_2024_3.pdf", because: "third identical copy; _2 is kept" },
  { borrower: "Brijanae Aubrey", name: "2024 W2 — additional — additional", file: "W2_002355099_1470414_2024.pdf", because: "third identical copy; _2 is kept" },
  { borrower: "Corine Lucas", name: "Bank statements — last 2 months — additional", file: "2026-06-04_Statement_-_USB_Checking_1510.pdf", because: "same bytes as the required 'Bank statements — last 2 months' slot" },
  { borrower: "Corine Lucas", name: "Homeowners insurance quote — additional", file: "11521.jpg", id: "de86eeaa-03a1-4f81-b61e-02847f012074", because: "DUPLICATE of the other 11521.jpg row (two uploads, same bytes); one copy kept and relabelled", },
  { borrower: "Corine Lucas", name: "Mortgage_statement_Select_Portfolio_Servicing_statement_date_07-15-2026_P_I_2_582.05_escrow_378.73.pdf", file: "Mortgage_statement_Select_Portfolio_Servicing_statement_date_07-15-2026_P_I_2_582.05_escrow_378.73.pdf", because: "pushed by my own mirror rename 2026-10-01 17:01" },
  { borrower: "Corine Lucas", name: "Homeowners insurance quote", file: "GetDocumentbyID.pdf", because: "MIS-FILED: the SPS mortgage statement occupying the REQUIRED insurance slot. The real declarations page (11520) is being moved into that slot in this same run" },
  { borrower: "Helena Kyser Livingston", name: "Mortgage statement (if refinance) — additional", file: "Shellpoint_62nd_June_Statement__17_.pdf", id: "7106e043-f290-4fd8-bd0b-5444a22fd370", because: "double upload one minute apart; the accepted first copy is kept" },
  { borrower: "Magali Lopez Villafuerte", name: "Counter offer", file: "Buyer_Counter_Offer_1.pdf", because: "double upload; the BCO_-prefixed first copy is kept" },
  { borrower: "Magali Lopez Villafuerte", name: "2024 w2", file: "2024_TaxReturn.pdf", because: "MIS-FILED: a 2024 Form 1040 in the required '2024 w2' slot. Her real 2024 W-2 is on file as 2024w2.PDF, so removing this re-opens a checklist item that was only ever filled by the wrong document" },
  { borrower: "Mario Washington", name: "LaTonya_Washington_2024_Form_1099-R_New_Orleans_Municipal_Employees_Retirement_System_TOTAL_distribution_19_931.62_code_", file: "LaTonya_Washington_2024_Form_1099-R_New_Orleans_Municipal_Employees_Retirement_System_TOTAL_distribution_19_931.62_code_", because: "pushed by my own mirror rename 2026-09-25; the surviving row is relabelled in this same run" },
  { borrower: "Mario Washington", name: "2024-25_Tax_Returns_1_of_2.pdf", file: "2024-25_Tax_Returns_1_of_2.pdf", because: "same bytes as the borrower-uploaded 'Tax returns — last 2 years … — additional'" },
  { borrower: "Mario Washington", name: "2024-25_Tax_Returns_2_of_2.pdf", file: "2024-25_Tax_Returns_2_of_2.pdf", because: "same bytes as the borrower-uploaded 'Tax returns — last 2 years … — additional'" },
  { borrower: "Kelly Dorsey", name: "CPL_110100036994_INSingleTransactionCPLLenderPurchaserBorrowerorLessee_36.pdf", file: "CPL_110100036994_INSingleTransactionCPLLenderPurchaserBorrowerorLessee_36.pdf", because: "numeric-suffix re-upload of the same CPL" },
  { borrower: "Kelly Dorsey", name: "CPL_110100036994_INSingleTransactionCPLLenderPurchaserBorrowerorLessee_69.pdf", file: "CPL_110100036994_INSingleTransactionCPLLenderPurchaserBorrowerorLessee_69.pdf", because: "numeric-suffix re-upload of the same CPL" },
  { borrower: "Kelly Dorsey", name: "ClosingStatementBuyer_8-18-2026_12-59_46.pdf", file: "ClosingStatementBuyer_8-18-2026_12-59_46.pdf", because: "numeric-suffix re-upload of the same closing statement" },
  { borrower: "Kelly Dorsey", name: "ClosingStatementBuyer_8-18-2026_12-59_22.pdf", file: "ClosingStatementBuyer_8-18-2026_12-59_22.pdf", because: "numeric-suffix re-upload of the same closing statement" },
  { borrower: "Kelly Dorsey", name: "Invoice_770774_88.PDF", file: "Invoice_770774_88.PDF", because: "numeric-suffix re-upload of the same invoice" },
  { borrower: "Lucki Long", name: "Signed-Lucki-Long-Net-Tangible-Benefit-LOX_1.pdf", file: "Signed-Lucki-Long-Net-Tangible-Benefit-LOX_1.pdf", because: "_1 re-upload of the same signed NTB letter" },
  { borrower: "Invictus Capital LLC", name: "Check_List_and_Authorization_Forms_-_O_Dell.pdf", file: "Check_List_and_Authorization_Forms_-_O_Dell.pdf", because: "same bytes as the required 'Completed: Check List and Authorization Forms' slot" },
  { borrower: "Issac O'Dell", name: "Dominion_Portolio_Tracker_-_Isaac_O_Dell.xlsx", file: "Dominion_Portolio_Tracker_-_Isaac_O_Dell.xlsx", id: "73de9afc-c98d-410b-8eac-999d96635e01", because: "same bytes as 'Dominion Portfolio Tracker — completed 2026-09-11.xlsx', which is the better name" },
  { borrower: "Michelle Jackson Metoyer", name: "Lease agreement or market rent estimate (Form 1007) — additional", file: "Rental_Anthony_2021_.pdf", because: "same bytes as the required Form 1007 slot copy" },
  { borrower: "Michelle Jackson Metoyer", name: "COND_39_-_Lease_-_4235_8th_Ave_-_Anthony_McConnell.pdf", file: "COND_39_-_Lease_-_4235_8th_Ave_-_Anthony_McConnell.pdf", because: "condition-named copy of the same lease; its detail is carried into the surviving row's label in this run" },
  { borrower: "Michelle Jackson Metoyer", name: "COND_39_-_Lease_-_4231_8th_Ave_-_Janie_McQueen_-_3100_mo_thru_02-05-2027.pdf", file: "COND_39_-_Lease_-_4231_8th_Ave_-_Janie_McQueen_-_3100_mo_thru_02-05-2027.pdf", because: "condition-named copy; detail carried into the surviving row's label" },
  { borrower: "Michelle Jackson Metoyer", name: "COND_39_-_Lease_-_4233_8th_Ave_-_Denise_Waller_-_2850_mo_thru_07-01-2027.pdf", file: "COND_39_-_Lease_-_4233_8th_Ave_-_Denise_Waller_-_2850_mo_thru_07-01-2027.pdf", because: "condition-named copy; detail carried into the surviving row's label" },
  { borrower: "Michelle Jackson Metoyer", name: "COND_39_-_Rent_increase_notice_-_4235_8th_Ave_-_Anthony_McConnell_-_2954_eff_01-01-2026.pdf", file: "COND_39_-_Rent_increase_notice_-_4235_8th_Ave_-_Anthony_McConnell_-_2954_eff_01-01-2026.pdf", because: "condition-named copy; detail carried into the surviving row's label" },
  { borrower: "Michelle Jackson Metoyer", name: "COND_15_-_Homeowners_insurance_-_Mercury_CALP0000149397_-_4231_8th_Ave_additional_unit.pdf", file: "COND_15_-_Homeowners_insurance_-_Mercury_CALP0000149397_-_4231_8th_Ave_additional_unit.pdf", because: "same bytes as the COND_15 copy without the '_additional_unit' suffix" },
];

async function main() {
  const { data: lfs } = await supabaseAdmin.from("loan_files").select("id, borrower_name, file_number");
  const byBorrower = new Map<string, any>();
  for (const f of (lfs || []) as any[]) byBorrower.set(f.borrower_name, f);

  const { data: all } = await supabaseAdmin.from("loan_documents")
    .select("id, loan_file_id, name, category, required, status, storage_path, file_name, size_bytes, notes, created_at")
    .not("storage_path", "is", null);
  const docs = (all || []) as any[];

  let manifest: Record<string, { file: string }> = {};
  try { manifest = JSON.parse(readFileSync(join(ROOT, ".fetti-sync.json"), "utf8")); } catch {}
  const shaOf = async (d: any) => {
    const local = manifest[d.storage_path]?.file;
    if (local && existsSync(local)) return createHash("sha256").update(readFileSync(local)).digest("hex");
    const { data } = await supabaseAdmin.storage.from("loan-docs").download(d.storage_path);
    return data ? createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex") : null;
  };

  const resolve = (k: Key) => {
    const lf = byBorrower.get(k.borrower);
    if (!lf) throw new Error(`no loan file for borrower "${k.borrower}"`);
    const hits = docs.filter(d => d.loan_file_id === lf.id && d.name === k.name && d.file_name === k.file
      && (!k.id || d.id === k.id));
    if (hits.length !== 1) throw new Error(`${k.borrower} / "${k.name}" / ${k.file} -> ${hits.length} matches, expected exactly 1`);
    return hits[0];
  };

  // Resolve EVERYTHING before changing anything — a half-applied pass is worse than none.
  const rel = RELABEL.map(r => ({ r, row: resolve(r) }));
  const del = DELETE.map(r => ({ r, row: resolve(r) }));
  if (new Set(del.map(d => d.row.id)).size !== del.length) throw new Error("a row appears twice in DELETE");
  if (del.some(d => rel.some(x => x.row.id === d.row.id))) throw new Error("a row is both relabelled and deleted");

  // Every deletion must leave at least one copy of those bytes on that loan file.
  const counts = new Map<string, number>();
  for (const d of docs) {
    const h = await shaOf(d); if (!h) continue;
    d.__sha = h; const k = `${d.loan_file_id}::${h}`; counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const { r, row } of del) {
    const k = `${row.loan_file_id}::${row.__sha}`;
    if ((counts.get(k) || 0) < 2) throw new Error(`REFUSING: ${r.borrower} / ${r.file} is the ONLY copy of those bytes on that loan file`);
  }

  console.log(`# apply-filing  ${DRY ? "DRY RUN" : "APPLY"}  ${new Date().toISOString()}`);
  console.log(`## relabel (${rel.length})`);
  for (const { r, row } of rel)
    console.log(`  ${r.borrower.padEnd(26)} ${r.newName ? `[${row.name}] -> [${r.newName}]` : `[${row.name}]`}${r.newCategory ? `  ${row.category} -> ${r.newCategory}` : ""}  (+note ${r.note.length}c)`);
  console.log(`\n## delete (${del.length}) — all byte-identical, a copy survives on the same loan file`);
  for (const { r, row } of del)
    console.log(`  ${r.borrower.padEnd(26)} [${String(row.name).slice(0, 52)}] ${String(row.file_name).slice(0, 40)}\n      ${r.because}`);

  if (DRY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }

  const log: any[] = [];
  for (const { r, row } of rel) {
    const patch: any = { notes: ((row.notes || "").trim() + (row.notes ? "\n" : "") + r.note).trim() };
    if (r.newName) patch.name = r.newName;
    if (r.newCategory) patch.category = r.newCategory;
    const { error } = await supabaseAdmin.from("loan_documents").update(patch).eq("id", row.id);
    if (error) { console.error(`  ✖ relabel ${row.id}: ${error.message}`); continue; }
    log.push({ op: "relabel", at: new Date().toISOString(), id: row.id, borrower: r.borrower, was: { name: row.name, category: row.category, notes: row.notes }, patch });
    console.log(`  ✓ relabelled  ${r.borrower}  ${patch.name || row.name}`);
  }
  for (const { r, row } of del) {
    const { error } = await supabaseAdmin.from("loan_documents").delete().eq("id", row.id);
    if (error) { console.error(`  ✖ delete ${row.id}: ${error.message}`); continue; }
    log.push({ op: "delete", at: new Date().toISOString(), borrower: r.borrower, because: r.because, sha256: row.__sha, row });
    console.log(`  ✓ deleted     ${r.borrower}  ${String(row.name).slice(0, 60)}`);
  }
  const out = join(ROOT, `.los-filing-log-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(log, null, 2));
  console.log(`\n${log.filter(l => l.op === "relabel").length} relabelled, ${log.filter(l => l.op === "delete").length} deleted.`);
  console.log(`Full previous values and deleted rows logged for reversal: ${out}`);
}

main().catch(e => { console.error("✖ " + (e?.message || e)); process.exit(1); });
