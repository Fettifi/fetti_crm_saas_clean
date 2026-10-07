// READ-ONLY. How much of the 1003 do borrowers actually complete?
//
// 2026-10-07, Ramon: "make sure that our application system is working properly and we're
// capturing borrowers' authorizations at the time that they're filling out the application...
// when I pull the MISMO files to upload them into the lender portals, we're missing information."
//
// The wizard HAS a full 1003 (arc 2) and it IS deployed — verified in the live production
// bundle. So "missing information" is not a missing feature. This measures the other
// hypothesis: the lead is created at the CONTACT step, and everything after it is optional
// continuation a borrower can simply close the tab on.
//
// Writes nothing. Never prints an SSN, a full account number, or a borrower's contact details.
import "./_env";
import { requireLiveDb, rows } from "./_liveDb";
import { supabaseAdmin } from "../lib/supabaseAdminClient";

const SHIPPED = "2026-09-09"; // the day arc 2 (declarations, authorization, REO) went in

function has(o: any): boolean {
  if (o == null) return false;
  if (typeof o === "string") return o.trim() !== "";
  if (Array.isArray(o)) return o.length > 0;
  if (typeof o === "object") return Object.values(o).some((v) => has(v));
  return true;
}

(async () => {
  await requireLiveDb("measure:1003");

  const leads = await rows<any>("measure:1003", supabaseAdmin.from("leads").select("*"), { minRows: 1 });
  console.log(`\nleads in the database: ${leads.length}`);
  const cols = Object.keys(leads[0] || {});
  console.log(`lead columns: ${cols.join(", ")}\n`);

  // Arc 1 (qualify+contact) vs arc 2 (the 1003 itself). Probe both the column and raw JSON.
  const probe = (l: any, keys: string[]) =>
    keys.some((k) => has(l?.[k]) || has(l?.raw?.[k]) || has(l?.raw?.answers?.[k]));

  const ARC1 = ["name", "email", "phone"];
  const ARC2: Record<string, string[]> = {
    "current home address":      ["current_address", "address", "street"],
    "monthly debt payments":     ["monthly_debt_payments"],
    "declarations (financial)":  ["decl_financial", "declarations"],
    "declarations (property)":   ["decl_property_events"],
    "assets schedule":           ["assets", "asset_rows"],
    "liabilities schedule":      ["liabilities", "liability_rows"],
    "real estate owned":         ["reo", "real_estate_owned"],
    "employment":                ["employer", "employment", "job_title"],
    "demographics (Reg B)":      ["demographics", "ethnicity", "race", "sex"],
    "BORROWER AUTHORIZATION":    ["authorization", "borrower_authorization", "auth_signature", "authorization_signature"],
  };

  const arc1 = leads.filter((l) => probe(l, ARC1)).length;
  console.log(`reached the CONTACT step (lead created): ${arc1} / ${leads.length}`);
  console.log(`\nof those, how many carry each ARC-2 (1003) item:`);
  for (const [label, keys] of Object.entries(ARC2)) {
    const n = leads.filter((l) => probe(l, keys)).length;
    const pct = leads.length ? Math.round((n / leads.length) * 100) : 0;
    const bar = "█".repeat(Math.round(pct / 4)).padEnd(25, "·");
    console.log(`  ${bar} ${String(n).padStart(3)} / ${leads.length}  ${String(pct).padStart(3)}%   ${label}`);
  }

  // Since the ship date — the only window where arc 2 could have been answered at all.
  const since = leads.filter((l) => String(l.created_at || "") >= SHIPPED);
  console.log(`\nleads created since arc 2 shipped (${SHIPPED}): ${since.length}`);
  if (since.length) {
    for (const [label, keys] of Object.entries(ARC2)) {
      const n = since.filter((l) => probe(l, keys)).length;
      console.log(`  ${String(n).padStart(3)} / ${since.length}   ${label}`);
    }
  }

  // The authorization as it actually lands today: a checklist DOCUMENT on the loan file.
  const files = await rows<any>("measure:1003", supabaseAdmin.from("loan_files").select("id, file_number, status, stage"));
  const docs = await rows<any>("measure:1003", supabaseAdmin.from("loan_documents").select("loan_file_id, name, status"));
  const authByFile = new Map<string, string>();
  for (const d of docs) if (/certification and authorization/i.test(d.name || "")) authByFile.set(d.loan_file_id, d.status);
  const withAuth = files.filter((f) => authByFile.has(f.id));
  const received = withAuth.filter((f) => /received|complete|approved/i.test(authByFile.get(f.id) || ""));
  console.log(`\nloan files: ${files.length}`);
  console.log(`  carry the authorization as a checklist item: ${withAuth.length}`);
  console.log(`  where that item is actually RECEIVED:        ${received.length}`);
  console.log(`\n  (a checklist item is a REQUEST. Only "received" is a signed authorization.)`);
})();
