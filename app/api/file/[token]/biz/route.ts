// POST /api/file/<token>/biz — the borrower fills in their BUSINESS profile.
//
// Business-purpose applicants who came through the old mortgage-shaped intake have a file
// with no entity name, no revenue and no debt schedule (Javier Buenas, FF-202607-1321). Rather
// than make them redo the whole application — the magic apply link only restores contact
// details, so "finish your application" would mean starting over — they get these ~9 fields
// on the secure link they ALREADY have.
//
// Token-gated exactly like the upload route: same resolvePortalToken, no session, no PII
// returned. The values land in lead.raw under the keys lib/bizApp.ts reads, so the Business
// Credit Application prints filled in the moment they hit save.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { resolvePortalToken } from "@/lib/los";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// Whitelist. A borrower-facing endpoint must never write arbitrary keys into lead.raw —
// that blob feeds scoring, the AI context and the printed application.
const TEXT_FIELDS = ["business_name", "entity_type", "ein", "industry", "use_of_proceeds", "date_established"] as const;
const NUM_FIELDS = ["months_in_business", "annual_revenue", "avg_monthly_deposits", "ownership_pct", "employees"] as const;

const clean = (v: unknown, max = 120) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const numOf = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token || token.length < 12) return NextResponse.json({ error: "invalid" }, { status: 400 });

    const { file, lead } = await resolvePortalToken(token);
    const leadId = (lead as any)?.id || (file as any)?.lead_id;
    if (!leadId) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));

    const { data: row } = await supabaseAdmin.from("leads").select("raw").eq("id", leadId).maybeSingle();
    const raw: Record<string, unknown> = (row as any)?.raw && typeof (row as any).raw === "object" ? { ...(row as any).raw } : {};

    const changed: string[] = [];
    for (const k of TEXT_FIELDS) {
      const v = clean(body[k]);
      if (v !== null) { raw[k] = v; changed.push(k); }
    }
    for (const k of NUM_FIELDS) {
      const v = numOf(body[k]);
      if (v !== null) { raw[k] = v; changed.push(k); }
    }
    // "No existing financing" is an ANSWER we must preserve, not an empty field — the
    // printed application says so explicitly rather than showing a blank schedule.
    if (body.existing_biz_debt === "no" || body.existing_biz_debt === "yes") {
      raw.existing_biz_debt = body.existing_biz_debt;
      changed.push("existing_biz_debt");
    }
    if (!changed.length) return NextResponse.json({ ok: true, saved: 0 });

    raw.biz_profile_completed_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);
    if (error) return NextResponse.json({ error: "could not save" }, { status: 500 });

    await logActivity({
      entity_type: "lead", entity_id: leadId, lead_id: leadId,
      loan_file_id: (file as any)?.id || null,
      actor: "borrower", action: "bizprofile.submitted",
      detail: { fields: changed.length, keys: changed },
    }).catch(() => {});

    return NextResponse.json({ ok: true, saved: changed.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
