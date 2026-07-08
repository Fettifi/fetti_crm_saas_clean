// PREFILL for the magic application link. GET ?lead=<id>&t=<hmac> → the lead's
// contact info + goal so the wizard opens ALREADY FILLED (one tap from an email/text
// to a mid-flight application — nothing re-typed). Public route: possession of the
// signed token is the auth, the same trust model as /file/<share_token> and the
// unsubscribe link. Returns ONLY what the contact step needs — never notes, SSN,
// financials, or scores.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { appLinkToken, goalFor } from "@/lib/magicLink";
import { autoPromoteIfQuarantined } from "@/lib/leadShield";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import crypto from "crypto";

export const runtime = "nodejs";

// Constant-time token compare — a timing oracle must not help brute-forcing.
function tokenMatches(a: string, b: string): boolean {
  try { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`prefill:${clientIp(req)}`, 30, 600))) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  const lead = req.nextUrl.searchParams.get("lead") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  if (!lead || !t || !tokenMatches(t, appLinkToken(lead))) {
    return NextResponse.json({ error: "invalid link" }, { status: 401 });
  }
  // Opening one's own magic link runs JS the email-scanner prefetchers don't —
  // real-human evidence. A quarantined lead is released by it (no-op otherwise).
  autoPromoteIfQuarantined(lead, "link_click").catch(() => {});
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
