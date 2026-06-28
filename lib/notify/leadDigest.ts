// Daily lead digest — emails/SMSes a morning summary of new leads, their tier
// mix, and which Tier 1/2 leads still need working. Sends through the SAME team
// channels as the per-lead alerts (LEAD_NOTIFY_* via notifyTeam). Triggered by a
// Vercel cron (vercel.json -> /api/cron/lead-digest). Never throws.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyTeam } from "@/lib/notify/leadAlert";

type Lead = {
  id: string; full_name: string | null; tier: string | null;
  loan_purpose: string | null; source: string | null; stage: string | null; created_at: string | null;
};

const isTier = (t: string | null, n: number) => String(t || "").toLowerCase() === `tier ${n}`;
const today = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });

export async function buildAndSendLeadDigest(): Promise<{ sent: string[]; counts: Record<string, number> }> {
  const now = Date.now();
  const d1 = new Date(now - 24 * 3600 * 1000).toISOString();
  const d7 = new Date(now - 7 * 86400000).toISOString();

  let leads: Lead[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, tier, loan_purpose, source, stage, created_at")
      .gte("created_at", d7)
      .order("created_at", { ascending: false })
      .limit(3000);
    leads = (data as any) || [];
  } catch { /* best-effort */ }

  const last24 = leads.filter((l) => (l.created_at || "") >= d1);
  const tier = (arr: Lead[], n: number) => arr.filter((l) => isTier(l.tier, n)).length;

  // "Work these now": Tier 1 & 2 from the last 7d not yet at a complete-application/terminal stage.
  const terminal = ["application", "submitted", "funded", "closed", "dead", "not qualified"];
  const needWork = leads
    .filter((l) => (isTier(l.tier, 1) || isTier(l.tier, 2)) && !terminal.some((t) => String(l.stage || "").toLowerCase().includes(t)))
    .slice(0, 12);

  const byStage: Record<string, number> = {};
  for (const l of leads) { const s = l.stage || "New Lead"; byStage[s] = (byStage[s] || 0) + 1; }

  const line = (l: Lead) => `• ${l.full_name || "(no name)"} — ${l.tier || "untiered"} — ${l.loan_purpose || "loan"} — ${l.source || "?"} — ${l.stage || "New Lead"}`;
  const body = [
    `Last 24h: ${last24.length} new lead${last24.length === 1 ? "" : "s"}`,
    `  🔥 Tier 1: ${tier(last24, 1)}  ·  Tier 2: ${tier(last24, 2)}  ·  Tier 3: ${tier(last24, 3)}`,
    ``,
    needWork.length
      ? `WORK THESE NOW (${needWork.length}):\n${needWork.map(line).join("\n")}`
      : `No Tier 1/2 leads waiting to be worked. ✅`,
    ``,
    `Last 7 days: ${leads.length} leads  (🔥 ${tier(leads, 1)} Tier 1 · ${tier(leads, 2)} Tier 2)`,
    `Pipeline: ${Object.entries(byStage).map(([s, c]) => `${s} ${c}`).join(" · ") || "—"}`,
    ``,
    `Tier-1 ad optimization: ${tier(leads, 1) + tier(leads, 2)}/50 qualified signals this week.` +
      ` ${tier(leads, 1) + tier(leads, 2) >= 50 ? "✅ Enough fuel — ready to switch Meta to hunt Tier 1." : "Meta can auto-target Tier 1 once this hits ~50/week."}`,
    ``,
    `Board: https://app.fettifi.com/leads`,
  ].join("\n");

  const subject = `☀️ Fetti Lead Digest — ${today()} · ${last24.length} new (🔥 ${tier(last24, 1)} Tier 1)`;
  const res = await notifyTeam(subject, body);
  return {
    sent: res.sent,
    counts: { last24: last24.length, t1_24: tier(last24, 1), t2_24: tier(last24, 2), needWork: needWork.length, last7: leads.length },
  };
}
