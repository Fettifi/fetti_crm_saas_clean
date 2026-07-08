// Daily lead digest — emails/SMSes a morning summary of new leads, their tier
// mix, and which Tier 1/2 leads still need working. Sends through the SAME team
// channels as the per-lead alerts (LEAD_NOTIFY_* via notifyTeam). Triggered by a
// Vercel cron (vercel.json -> /api/cron/lead-digest). Never throws.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { notifyTeam } from "@/lib/notify/leadAlert";

type Lead = {
  id: string; full_name: string | null; tier: string | null;
  loan_purpose: string | null; source: string | null; stage: string | null; created_at: string | null;
  email?: string | null; phone?: string | null; raw?: any;
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
      .select("id, full_name, tier, loan_purpose, source, stage, created_at, email, phone, raw")
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

  // SHIELD section: what the bot filter did + every quarantined lead awaiting a call.
  let shieldBlock = "";
  try {
    const { shieldActionToken } = await import("@/lib/leadShield");
    const app = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
    const inReview = leads.filter((l) => String(l.stage || "").toLowerCase() === "review");
    const gray = inReview.filter((l) => (l.raw?.shield?.band || "gray") === "gray");
    const junk = inReview.filter((l) => (l.raw?.shield?.band || "gray") !== "gray");
    const { data: acts } = await supabaseAdmin
      .from("activity_log").select("action, actor, detail").like("action", "shield.%").gte("created_at", d1).limit(2000);
    const count = (a: string) => (acts || []).filter((x: any) => x.action === a).length;
    const promotedOwner = (acts || []).filter((x: any) => x.action === "shield.promote" && String(x.actor || "").startsWith("owner")).length;
    const promotedAuto = (acts || []).filter((x: any) => x.action === "shield.promote" && !String(x.actor || "").startsWith("owner")).length;
    const reviewLine = (l: Lead) => {
      const top = (l.raw?.shield?.signals || []).filter((x: any) => x.pts > 0).sort((a: any, b: any) => b.pts - a.pts)[0];
      return `• ${l.full_name || l.email || l.phone || "(no contact)"} — ${l.loan_purpose || "loan"} — ${top ? top.key : "?"}\n   ✓ release: ${app}/api/shield/act?lead=${l.id}&action=promote&t=${shieldActionToken(l.id, "promote")}\n   ✕ dismiss: ${app}/api/shield/act?lead=${l.id}&action=dismiss&t=${shieldActionToken(l.id, "dismiss")}`;
    };
    if (inReview.length || (acts || []).length) {
      const parts = [
        `🛡️ SHIELD (24h): ${count("shield.quarantine")} quarantined · ${promotedAuto} auto-released (proved human) · ${promotedOwner} released by you · ${count("shield.dismiss")} dismissed · ${count("shield.lookup")} phone lookups`,
      ];
      if (gray.length) parts.push(`NEEDS YOUR CALL (${gray.length}):\n${gray.slice(0, 8).map(reviewLine).join("\n")}`);
      if (junk.length) parts.push(`(+ ${junk.length} hard-junk in Review — worth a weekly glance, auto-nothing was sent)`);
      // Calibration tripwire: if the owner keeps releasing quarantines, the shield is too tight.
      const resolved = promotedOwner + count("shield.dismiss");
      if (resolved >= 5 && promotedOwner / resolved > 0.3) parts.push(`⚠️ You released ${promotedOwner}/${resolved} quarantines — the shield may be too tight. Say the word and I'll raise the threshold.`);
      shieldBlock = parts.join("\n\n");
    }
  } catch { /* best-effort */ }

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
    ...(shieldBlock ? [shieldBlock, ``] : []),
    `Board: https://app.fettifi.com/leads`,
  ].join("\n");

  const subject = `☀️ Fetti Lead Digest — ${today()} · ${last24.length} new (🔥 ${tier(last24, 1)} Tier 1)`;
  const res = await notifyTeam(subject, body);
  return {
    sent: res.sent,
    counts: { last24: last24.length, t1_24: tier(last24, 1), t2_24: tier(last24, 2), needWork: needWork.length, last7: leads.length },
  };
}
