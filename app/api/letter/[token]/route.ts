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
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ letter: data });
}
