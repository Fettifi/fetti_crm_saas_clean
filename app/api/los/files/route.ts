// LOS loan files: list (with document progress) and create-from-lead.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { createLoanFileFromLead, ensureLoanFileForLead } from "@/lib/los";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: files } = await supabaseAdmin
    .from("loan_files").select("*").order("created_at", { ascending: false }).limit(2000);
  const ids = (files || []).map((f: any) => f.id);
  const progress: Record<string, { total: number; received: number; required: number; requiredReceived: number }> = {};
  if (ids.length) {
    const { data: docs } = await supabaseAdmin
      .from("loan_documents").select("loan_file_id, status, required").in("loan_file_id", ids);
    for (const d of (docs || []) as any[]) {
      const p = progress[d.loan_file_id] || { total: 0, received: 0, required: 0, requiredReceived: 0 };
      p.total++;
      // Rejected docs are NOT "received" — they stay outstanding (re-upload needed),
      // so the queue keeps counting them as missing and the Remind button shows.
      const got = d.status === "received" || d.status === "accepted";
      if (got) p.received++;
      if (d.required) { p.required++; if (got) p.requiredReceived++; }
      progress[d.loan_file_id] = p;
    }
  }
  const withProgress = (files || []).map((f: any) => ({ ...f, docs: progress[f.id] || { total: 0, received: 0, required: 0, requiredReceived: 0 } }));
  return NextResponse.json({ files: withProgress });
}

// POST { lead_id }                       -> create (or return existing) file from that lead.
//      { borrower, email?, phone?, product? } -> start a BRAND-NEW file: creates the lead
//                                            first (an LO opening a file for a walk-in /
//                                            new borrower who isn't a lead yet), then the file.
const s = (v: any, n = 120) => String(v ?? "").trim().slice(0, n);
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let lead: any = null;
    if (body?.lead_id) {
      const { data } = await supabaseAdmin.from("leads").select("*").eq("id", body.lead_id).maybeSingle();
      if (!data) return NextResponse.json({ error: "lead not found" }, { status: 404 });
      lead = data;
    } else {
      const borrower = s(body?.borrower, 120);
      if (!borrower) return NextResponse.json({ error: "A lead_id or a borrower name is required." }, { status: 400 });
      const parts = borrower.split(/\s+/);
      const email = s(body?.email, 160).toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email doesn't look valid." }, { status: 400 });
      const { data: newLead, error: le } = await supabaseAdmin.from("leads").insert({
        full_name: borrower, first_name: parts[0] || borrower, last_name: parts.slice(1).join(" ") || null,
        email, phone: s(body?.phone, 40) || null, loan_purpose: s(body?.product, 80) || null,
        stage: "Application", source: "los_manual", raw: { created_by: "los_new_file" },
      }).select("*").single();
      if (le || !newLead) return NextResponse.json({ error: le?.message || "Could not create the borrower record." }, { status: 500 });
      lead = newLead;
    }
    const file = await ensureLoanFileForLead(lead) || (await createLoanFileFromLead(lead));
    if (!file) return NextResponse.json({ error: "could not create loan file" }, { status: 500 });
    // Keep file ⇔ Application consistent: a teammate opening a real LOS file moves the
    // lead into Application too, so the Leads pipeline and the Applications area agree.
    try {
      const { advanceLeadStage } = await import("@/lib/leadStage");
      await advanceLeadStage(lead.id, "Application", { actor: "teammate", reason: "converted to loan file" });
    } catch { /* forward-only; best-effort */ }
    return NextResponse.json({ file }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
