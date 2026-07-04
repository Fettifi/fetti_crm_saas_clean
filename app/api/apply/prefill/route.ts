// PREFILL for the magic application link. GET ?lead=<id>&t=<hmac> → the lead's
// contact info + goal so the wizard opens ALREADY FILLED (one tap from an email/text
// to a mid-flight application — nothing re-typed). Public route: possession of the
// signed token is the auth, the same trust model as /file/<share_token> and the
// unsubscribe link. Returns ONLY what the contact step needs — never notes, SSN,
// financials, or scores.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { appLinkToken, goalFor } from "@/lib/magicLink";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const lead = req.nextUrl.searchParams.get("lead") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!lead || !t || t !== appLinkToken(lead)) {
    return NextResponse.json({ error: "invalid link" }, { status: 401 });
  }
  const { data: l } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, email, phone, state, loan_purpose, stage")
    .eq("id", lead)
    .maybeSingle();
  if (!l) return NextResponse.json({ error: "not found" }, { status: 404 });
  // A dead/junk row's link shouldn't resurrect it silently — still let them apply fresh.
  return NextResponse.json({
    ok: true,
    full_name: l.full_name || "",
    first_name: (l.first_name || l.full_name || "").split(" ")[0] || "",
    email: l.email || "",
    phone: l.phone || "",
    state: l.state || "",
    goal: goalFor(l.loan_purpose),
  });
}
