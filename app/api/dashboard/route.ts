import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg } from "@/lib/settings";

// Real dashboard KPIs: leads, loan files, loan volume in dollars, and potential
// earnings at an ADJUSTABLE margin (saved company default, editable on the
// dashboard). Auth-gated via the /api/dashboard matcher.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FUNDED_STAGES = ["funded", "closed"];
const DEAD = ["dead", "lost", "not_qualified", "declined"];

export async function GET() {
  try {
    // Adjustable margin (% Fetti makes per dollar lent). Saved default 2.75%.
    const marginPct = Number(await cfg("LOAN_MARGIN_PCT")) || 2.75;
    const MARGIN = marginPct / 100;
    const [{ data: leads }, { data: files }] = await Promise.all([
      supabaseAdmin.from("leads")
        .select("id, full_name, loan_purpose, loan_amount_requested, property_value, tier, stage, status, created_at")
        .order("created_at", { ascending: false }).limit(5000),
      supabaseAdmin.from("loan_files")
        .select("id, borrower_name, loan_amount, property_value, stage, status, created_at")
        .order("created_at", { ascending: false }).limit(5000),
    ]);

    const L: any[] = leads || [];
    const F: any[] = files || [];
    const now = Date.now();
    const DAY = 86400000;
    const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const stageL = (s: any) => String(s || "").toLowerCase();

    // ---- Leads ----
    const liveLeads = L.filter((l) => !DEAD.includes(stageL(l.status)) && !DEAD.includes(stageL(l.stage)));
    const leadStats = {
      total: L.length,
      new7d: L.filter((l) => l.created_at && now - new Date(l.created_at).getTime() < 7 * DAY).length,
      today: L.filter((l) => l.created_at && now - new Date(l.created_at).getTime() < DAY).length,
      tier1: L.filter((l) => l.tier === "Tier 1").length,
      tier2: L.filter((l) => l.tier === "Tier 2").length,
      tier3: L.filter((l) => l.tier === "Tier 3").length,
    };

    // ---- Loan files by stage ----
    const byStage: Record<string, number> = {};
    for (const f of F) { const s = f.stage || "Application"; byStage[s] = (byStage[s] || 0) + 1; }
    const active = F.filter((f) => stageL(f.status) === "active" && !FUNDED_STAGES.includes(stageL(f.stage)));
    const funded = F.filter((f) => FUNDED_STAGES.includes(stageL(f.stage)));
    const fileStats = { total: F.length, active: active.length, funded: funded.length, byStage };

    // ---- Loan volume in $ ----
    // The loan figure is usually blank at intake (the wizard captures property VALUE,
    // not the loan amount), which made volume read ~$0. Fall back to an LTV estimate off
    // the property value so the dashboard reflects REAL deal size.
    const LTV = 0.8;
    const loanOfFile = (f: any) => num(f.loan_amount) || Math.round(num(f.property_value) * LTV);
    const loanOfLead = (l: any) => num(l.loan_amount_requested) || Math.round(num(l.property_value) * LTV);
    const pipelineVolume = active.reduce((s, f) => s + loanOfFile(f), 0);
    const fundedVolume = funded.reduce((s, f) => s + loanOfFile(f), 0);
    // Top-of-funnel potential: estimated loan size across live leads.
    const leadRequested = liveLeads.reduce((s, l) => s + loanOfLead(l), 0);
    const volume = { pipeline: pipelineVolume, funded: fundedVolume, leadRequested, total: pipelineVolume + fundedVolume };

    // ---- Earnings at 2.75% ----
    const earnings = {
      rate: MARGIN,
      pipeline: pipelineVolume * MARGIN,
      funded: fundedVolume * MARGIN,
      leadRequested: leadRequested * MARGIN,
    };

    const recentLeads = L.slice(0, 8).map((l) => ({
      id: l.id, name: l.full_name || "Lead", purpose: l.loan_purpose || "—",
      tier: l.tier || null, stage: l.stage || "New Lead", amount: loanOfLead(l), created_at: l.created_at,
    }));
    const recentFiles = F.filter((f) => stageL(f.status) === "active").slice(0, 8).map((f) => ({
      id: f.id, borrower: f.borrower_name || "Borrower", stage: f.stage || "Application", amount: loanOfFile(f), created_at: f.created_at,
    }));

    return NextResponse.json({ marginPct, leads: leadStats, files: fileStats, volume, earnings, recentLeads, recentFiles });
  } catch (e: any) {
    console.error("[api/dashboard]", e);
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
