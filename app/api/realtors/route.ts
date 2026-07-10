// Real-estate-agent referral pipeline. Agents are the highest-ROI B2B channel for a
// mortgage broker — one active agent sends a stream of real, pre-qualified buyers.
// This is a CRM + compliant-outreach engine layered on the existing referral_partners
// tracking (each active agent gets a tracked code so their buyers auto-attribute).
//
// RESPA §8 (anti-kickback) is the hard wall: a lender may NOT pay an agent for
// referrals. Everything here is relationship + co-marketing + preferred-lender +
// education — legal footprint growth, never a per-lead payment. Templates enforce it.
//
// Storage: app_settings "AGENTS" JSON (no DDL reachable headlessly). Tracked codes +
// leaderboard live in referral_partners; buyer attribution flows through leads.referrer.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { sendEmail, logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const KEY = "AGENTS";

type Agent = {
  id: string; name: string; company?: string; email?: string; phone?: string;
  market?: string; license?: string; status: "prospect" | "contacted" | "active" | "dormant";
  code?: string; notes?: string; outreach: { at: string; channel: string; summary: string }[];
  created_at: string; last_contact_at?: string;
};

async function load(): Promise<Agent[]> {
  try { const raw = await getSetting(KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function save(a: Agent[]) { await setSetting(KEY, JSON.stringify(a)); }
function rid() { return "ag_" + Math.random().toString(36).slice(2, 10); }
function codeFor(name: string) { return (name || "agent").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) + Math.random().toString(36).slice(2, 5); }

// RESPA-safe intro: relationship + co-marketing + preferred-lender, NEVER pay-for-leads.
function introEmail(a: Agent): { subject: string; body: string } {
  const first = (a.name || "there").split(" ")[0];
  return {
    subject: `A lending partner for your ${a.market || "buyers"} — Fetti Financial`,
    body:
`Hi ${first},

I'm Ramon Dent with Fetti Financial Services — a licensed mortgage lender & broker (NMLS #2267023). I work with agents in ${a.market || "your area"} and wanted to introduce myself.

What your buyers get with us: fast pre-approvals (often same day), straight answers on tricky files — DSCR/investor, self-employed, jumbo, first-time buyers with down-payment assistance — and a specialist who actually picks up the phone. When your deal needs to close, we don't fumble the financing.

For you: I'm happy to co-host a first-time-buyer workshop, co-brand a market update for your sphere, or just be the lender you can hand a tough scenario to and trust it gets done. No cost, no strings — I'd rather earn a spot on your preferred-lender list by being useful.

Open to a 15-minute call this week? I'll come with a one-pager on how we make your closings smoother.

— Ramon Dent
Fetti Financial Services LLC · NMLS #2267023
Apply/scenarios: fettifi.com`,
  };
}

export async function GET() {
  const agents = await load();
  // buyer-referral counts per agent code (from the leads leaderboard)
  const codes = agents.map((a) => a.code).filter(Boolean) as string[];
  const stat: Record<string, { leads: number; t1: number }> = {};
  if (codes.length) {
    const { data: leads } = await supabaseAdmin.from("leads").select("referrer,tier").in("referrer", codes);
    for (const l of (leads || []) as any[]) { const s = stat[l.referrer] = stat[l.referrer] || { leads: 0, t1: 0 }; s.leads++; if (l.tier === "Tier 1") s.t1++; }
  }
  const out = agents.map((a) => ({ ...a, referred: a.code ? (stat[a.code]?.leads || 0) : 0, referred_t1: a.code ? (stat[a.code]?.t1 || 0) : 0, link: a.code ? `https://fettifi.com/r/${a.code}` : null }))
    .sort((x, y) => (y.referred_t1 - x.referred_t1) || (y.referred - x.referred) || x.name.localeCompare(y.name));
  return NextResponse.json({ agents: out });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action || "create";
  const agents = await load();

  if (action === "create") {
    if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const a: Agent = { id: rid(), name: body.name, company: body.company, email: body.email, phone: body.phone, market: body.market, license: body.license, status: "prospect", notes: body.notes, outreach: [], created_at: new Date().toISOString() };
    agents.push(a); await save(agents);
    return NextResponse.json({ ok: true, agent: a });
  }

  if (action === "update") {
    const a = agents.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
    for (const f of ["name", "company", "email", "phone", "market", "license", "notes", "status"] as const) if (body[f] != null) (a as any)[f] = body[f];
    await save(agents);
    return NextResponse.json({ ok: true, agent: a });
  }

  // Activate: mint a tracked referral code (referral_partners row) so this agent's
  // buyers auto-attribute + they appear on the partner leaderboard.
  if (action === "activate") {
    const a = agents.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!a.code) {
      let code = codeFor(a.name);
      for (let i = 0; i < 5; i++) { const { data } = await supabaseAdmin.from("referral_partners").select("id").eq("code", code).maybeSingle(); if (!data) break; code = codeFor(a.name); }
      await supabaseAdmin.from("referral_partners").insert({ code, name: a.name, company: a.company || null });
      a.code = code;
    }
    a.status = "active"; await save(agents);
    return NextResponse.json({ ok: true, agent: a, link: `https://fettifi.com/r/${a.code}` });
  }

  // Send the RESPA-safe intro email + advance to "contacted" + log the touch.
  if (action === "outreach") {
    const a = agents.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!a.email) return NextResponse.json({ error: "agent has no email" }, { status: 400 });
    const { subject, body: text } = introEmail(a);
    const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a">${text.replace(/\n/g, "<br>")}</div>`;
    const r = await sendEmail(a.email, subject, { html, text });
    if (!r.ok) return NextResponse.json({ error: `email failed: ${r.detail}` }, { status: 502 });
    a.status = a.status === "prospect" ? "contacted" : a.status;
    a.last_contact_at = new Date().toISOString();
    a.outreach.push({ at: a.last_contact_at, channel: "email", summary: "Sent RESPA-safe intro" });
    await save(agents);
    await logComms({ channel: "email", direction: "outbound", type: "agent_outreach", subject, body: text, to: a.email, status: "sent", providerId: r.id, actor: "system" }).catch(() => {});
    await logActivity({ entity_type: "org", entity_id: a.id, actor: "system", action: "agent.outreach", detail: { name: a.name, channel: "email" } }).catch(() => {});
    return NextResponse.json({ ok: true, agent: a });
  }

  if (action === "delete") {
    const next = agents.filter((x) => x.id !== body.id);
    await save(next);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
