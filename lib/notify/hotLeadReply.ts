import { supabaseAdmin } from "@/lib/supabaseAdminClient";

// A lead replying to outreach is the hottest, most fundable signal in the funnel.
// Until now that moment only fired an ephemeral Discord webhook — if the hook was
// unset or the ping got buried, the reply vanished and the lead sat at "New Lead".
// This persists the reply as a TOP-priority CRM task so it lands in the task list
// and the calendar feed (org_tasks, ordered priority DESC) and never gets lost.
//
// Dedup is per-lead: a follow-up reply REFRESHES the same task (re-opens it and
// bumps the note + due date) instead of piling up duplicates. Best-effort —
// never throws, so it can't break the inbound webhook's 200 response to Twilio.
export async function logHotLeadReply(opts: {
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  body: string;
}): Promise<void> {
  try {
    const who = (opts.name || "Lead").trim() || "Lead";
    const snippet = (opts.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const title = `🔥 Call back ${who} — replied to follow-up`.slice(0, 200);
    const detail =
      `${who}${opts.phone ? ` (${opts.phone})` : ""} replied: "${snippet}". ` +
      `Hot engagement signal — respond today to convert.`;
    const dedup_key = `hotreply:${opts.leadId || opts.phone || who}`
      .toLowerCase()
      .replace(/[^a-z0-9:]+/g, "")
      .slice(0, 80);
    const nowIso = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("org_tasks")
      .select("id")
      .eq("dedup_key", dedup_key)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Same lead replied again — re-open and freshen rather than duplicate.
      await supabaseAdmin
        .from("org_tasks")
        .update({ status: "open", title, detail, due_at: nowIso, completed_at: null, completed_by: null })
        .eq("id", (existing as any).id);
    } else {
      await supabaseAdmin.from("org_tasks").insert([
        {
          title,
          detail,
          source: "lead_reply",
          status: "open",
          priority: 10, // above brain priorities — a live human reply outranks everything
          dedup_key,
          cadence: "once",
          due_at: nowIso,
        },
      ]);
    }
  } catch (e) {
    console.warn("[hotLeadReply] task log failed", e);
  }
}
