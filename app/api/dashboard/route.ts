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
        .select("id, full_name, loan_purpose, loan_amount_requested, property_value, tier, stage, created_at, app_completed:raw->app_completed, app_completed_at:raw->>app_completed_at")
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

    // Completed 1003s that haven't sent a document yet. The doc-upload LOS gate
    // (473293d) rightly stopped phantom loan files, but it left finished
    // applications with NO surface on the dashboard — a Tier-1 who completes the
    // wizard at 9 PM Sunday was invisible until someone dug through /leads
    // (the Magali gap, 2026-07-21). These are the hottest follow-ups in the
    // building, so they get their own list: stage still pre-Application (the
    // upload route advances them out of here automatically on the first doc).
    // Recency gate: app_completed_at is stamped at completion (backfilled for the
    // 7/20-21 pair). ~28 historical Engaged leads carry app_completed=true from
    // months back — without the stamp+window they'd bury the fresh completion
    // this band exists to surface.
    const appsAwaitingDocs = L.filter((l) =>
      (l as any).app_completed === true &&
      (l as any).app_completed_at &&
      now - new Date((l as any).app_completed_at).getTime() < 30 * DAY &&
      ["new lead", "contacted", "engaged", "review"].includes(stageL(l.stage))
    ).sort((a, b) => new Date((b as any).app_completed_at).getTime() - new Date((a as any).app_completed_at).getTime())
    .slice(0, 12).map((l) => ({
      id: l.id, name: l.full_name || "Lead", purpose: l.loan_purpose || "—",
      tier: l.tier || null, stage: l.stage || "New Lead", amount: loanOfLead(l),
      // Age on WHEN the 1003 was finished, not lead creation (a returning lead's
      // created_at can be weeks old — Timothy completed 10 days after creation).
      created_at: (l as any).app_completed_at || l.created_at,
    }));

    // High-value leads going cold — the Enterprise Brain's standing #1 bottleneck:
    // Tier-1/Tier-2 leads that were contacted but never advanced to Application sit
    // invisible until someone digs through /leads, and 0 loans fund. This band
    // surfaces them straight on the dashboard so the LO chases the best deals first.
    // Guardrails: only Tier 1/2, still pre-Application (no docs / not app-completed),
    // aged 3+ days so a fresh lead isn't nagged, capped at 45 days so ancient dead
    // weight doesn't crowd out live ones. Coldest first (oldest at top), T1 above T2.
    const STALLED_STAGES = ["new lead", "contacted", "engaged"];
    const tierRank = (t: any) => (t === "Tier 1" ? 0 : t === "Tier 2" ? 1 : 2);
    const stalledHighValue = L.filter((l) => {
      if (!["Tier 1", "Tier 2"].includes(l.tier)) return false;
      if ((l as any).app_completed === true) return false;   // already in appsAwaitingDocs
      if (!STALLED_STAGES.includes(stageL(l.stage))) return false;
      if (DEAD.includes(stageL(l.stage))) return false;
      if (!l.created_at) return false;
      const age = now - new Date(l.created_at).getTime();
      return age >= 3 * DAY && age <= 45 * DAY;
    }).sort((a, b) => {
      const tr = tierRank(a.tier) - tierRank(b.tier);
      if (tr !== 0) return tr;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); // coldest first
    }).slice(0, 10).map((l) => ({
      id: l.id, name: l.full_name || "Lead", purpose: l.loan_purpose || "—",
      tier: l.tier || null, stage: l.stage || "New Lead", amount: loanOfLead(l), created_at: l.created_at,
    }));

    const recentLeads = L.slice(0, 8).map((l) => ({
      id: l.id, name: l.full_name || "Lead", purpose: l.loan_purpose || "—",
      tier: l.tier || null, stage: l.stage || "New Lead", amount: loanOfLead(l), created_at: l.created_at,
    }));
    const recentFiles = F.filter((f) => stageL(f.status) === "active").slice(0, 8).map((f) => ({
      id: f.id, borrower: f.borrower_name || "Borrower", stage: f.stage || "Application", amount: loanOfFile(f), created_at: f.created_at,
    }));

    return NextResponse.json({ marginPct, leads: leadStats, files: fileStats, volume, earnings, appsAwaitingDocs, stalledHighValue, recentLeads, recentFiles });
  } catch (e: any) {
    console.error("[api/dashboard]", e);
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
