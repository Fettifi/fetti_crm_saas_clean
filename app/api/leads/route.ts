// app/api/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { deleteLeadCascade } from "@/lib/los";

const INTERNAL_TOKEN = process.env.INTERNAL_LEAD_API_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

// This route's POST is token-authed (machine intake), so /api/leads is NOT in the
// proxy session-gate. The DELETE therefore verifies the staff session itself.
async function isStaff(req: NextRequest): Promise<boolean> {
  try {
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => req.cookies.get(name)?.value, set() {}, remove() {} } },
    );
    const { data } = await supa.auth.getUser();
    return !!data.user;
  } catch { return false; }
}

// GET -> lightweight lead list for internal pickers (Scenario Desk prefill, etc.).
// This route sits OUTSIDE the proxy gate (its POST is token-authed machine intake),
// so the GET self-checks the staff session — lead PII is never exposed publicly.
export async function GET(req: NextRequest) {
  if (!(await isStaff(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, last_name, email, phone, loan_purpose, property_value, state, stage, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data || [] });
}

// DELETE ?id=<leadId>&purge=1 -> permanently delete a lead and EVERYTHING tied to
// it (loan files, documents, agent runs, activity, preapprovals) and, when purge=1,
// the uploaded files in storage too. Irreversible. Staff session required.
export async function DELETE(req: NextRequest) {
  if (!(await isStaff(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  try {
    const totals = await deleteLeadCascade(id, { purgeStorage: purge });
    return NextResponse.json({ ok: true, purged: purge, ...totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1) Simple auth using a shared Bearer token (public-facing machine-intake gate).
    const authHeader = req.headers.get("authorization") || "";
    const expected = `Bearer ${INTERNAL_TOKEN}`;
    if (!INTERNAL_TOKEN || authHeader !== expected) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2) Parse + minimal validation
    const body = await req.json();
    const { email, phone } = body || {};
    if (!email && !phone) {
      return NextResponse.json(
        { error: "At least email or phone is required" },
        { status: 400 }
      );
    }

    // 3) Delegate to the SINGLE lead front door (/api/apply) instead of scoring and
    // inserting here. This token intake used to run its OWN divergent scoring formula
    // and write UNSHIELDED rows straight into `leads` — a dead-end that bypassed
    // Lead Shield (bot/fake quarantine → Review lane), the canonical scoreLead tiering,
    // and the entire new-lead pipeline (first touch, owner alert, agents, Meta CAPI).
    // Forwarding server-to-server gives it the IDENTICAL treatment as the website and
    // the Meta webhook. We carry the internal secret so /api/apply skips the per-IP
    // limiter (this self-call has no real client IP), exactly like the Meta webhook.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.CRON_SECRET) headers["x-fetti-internal"] = process.env.CRON_SECRET;
    const forwardBody = { ...body, source: body?.source || "api" };
    const ar = await fetch(`${APP_URL}/api/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify(forwardBody),
    });
    const result = await ar.json().catch(() => ({} as any));
    if (!ar.ok) {
      console.error("[/api/leads] /api/apply rejected:", ar.status, result?.error);
      return NextResponse.json(
        { error: result?.error || "intake failed" },
        { status: ar.status }
      );
    }

    // Preserve a response compatible with the prior contract (success + tier + lead
    // id), now sourced from the canonical intake so external callers see the REAL tier.
    return NextResponse.json(
      {
        success: true,
        lead_id: result?.lead_id ?? null,
        tier: result?.tier,
        score: result?.score,
        deduped: !!result?.deduped,
      },
      { status: ar.status }
    );
  } catch (err: any) {
    console.error("Lead API error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
