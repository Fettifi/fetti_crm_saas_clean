// Public fetch of a pre-approval letter by its share token (for the borrower /
// real-estate agent letter link). Read-only, token-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting } from "@/lib/settings";
import { letterSections } from "@/lib/preapprovalTerms";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data } = await supabaseAdmin
    .from("preapprovals")
    // `id` was missing, so the page had no key to load the extra terms with — which is why the
    // web letter Ramon sends to listing agents showed 8 rows while the PDF showed everything.
    .select("id, letter_number, borrower_name, co_borrower, loan_type, purchase_price, loan_amount, down_payment, interest_rate, term, property_address, occupancy, conditions, officer_name, officer_nmls, status, expires_on, created_at")
    .eq("share_token", token).maybeSingle();
  // Treat void or expired letters as gone (410) — a shared link must not keep
  // serving a revoked/stale pre-approval that a borrower could present as current.
  // A bare "YYYY-MM-DD" parses as UTC MIDNIGHT, so the link died at 5pm the day BEFORE the date
  // the PDF printed as "valid through". Expire at end of day, Pacific.
  if (!data || data.status === "void" || (data.expires_on && new Date(`${data.expires_on}T23:59:59-07:00`) < new Date())) {
    return NextResponse.json({ error: "not found" }, { status: data ? 410 : 404 });
  }
  // The SAME rows the PDF renders, from the same list — so one letter cannot be two documents.
  let extra: any = {};
  try { const raw = await getSetting(`PA_TERMS:${(data as any).id}`); if (raw) extra = JSON.parse(raw); } catch { /* terms optional */ }
  const { id: _id, ...letter } = data as any;
  return NextResponse.json({ letter, sections: letterSections(data, extra) });
}
