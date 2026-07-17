// Public fetch of a pre-approval letter by its share token (for the borrower /
// real-estate agent letter link). Read-only, token-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data } = await supabaseAdmin
    .from("preapprovals")
    .select("letter_number, borrower_name, co_borrower, loan_type, purchase_price, loan_amount, down_payment, interest_rate, term, property_address, occupancy, conditions, officer_name, officer_nmls, status, expires_on, created_at")
    .eq("share_token", token).maybeSingle();
  // Treat void or expired letters as gone (410) — a shared link must not keep
  // serving a revoked/stale pre-approval that a borrower could present as current.
  if (!data || data.status === "void" || (data.expires_on && new Date(data.expires_on) < new Date())) {
    return NextResponse.json({ error: "not found" }, { status: data ? 410 : 404 });
  }
  return NextResponse.json({ letter: data });
}
