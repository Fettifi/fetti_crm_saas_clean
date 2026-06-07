// Automated drip nurture. After the instant first-touch, follow up on day 1, 3,
// and 7 automatically (SMS/email via the same responder). Runs from a daily cron.
// Skips leads that opted out (Twilio blocks STOP automatically), are paused, are
// already converted/closed, or are too old.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { respondToLead } from "@/lib/notify/leadResponder";

type Lead = {
  id: string; full_name: string | null; first_name: string | null;
  email: string | null; phone: string | null; loan_purpose: string | null;
  stage: string | null; created_at: string; nurture_step: number | null; nurture_paused: boolean | null;
};

const STEPS: { step: number; afterDays: number; msg: (name: string, purpose: string) => string }[] = [
  { step: 1, afterDays: 1, msg: (n, p) => `Hi ${n}, just checking in on ${p} — happy to answer questions or get you a quick quote. When's a good time to connect? Reply STOP to opt out.` },
  { step: 2, afterDays: 3, msg: (n, p) => `Hi ${n}, still here to help with ${p}. Want me to pull your options? Reply YES and a Fetti specialist will reach out. Reply STOP to opt out.` },
  { step: 3, afterDays: 7, msg: (n, p) => `Hi ${n}, last check-in from Fetti on your loan inquiry. If now's not the time, no worries — reply anytime and we'll pick right back up. Reply STOP to opt out.` },
];

const STOP_STAGES = ["closed", "won", "funded", "dead", "lost"];

export async function runNurture(): Promise<{ considered: number; sent: number }> {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, full_name, first_name, email, phone, loan_purpose, stage, created_at, nurture_step, nurture_paused")
    .gte("created_at", cutoff)
    .lt("nurture_step", 3)
    .limit(500);

  let considered = 0, sent = 0;
  for (const l of (leads || []) as Lead[]) {
    considered++;
    if (l.nurture_paused) continue;
    if (!l.phone && !l.email) continue;
    const stage = (l.stage || "").toLowerCase();
    if (STOP_STAGES.some((s) => stage.includes(s))) continue;

    const ageDays = (Date.now() - new Date(l.created_at).getTime()) / 86400000;
    let due: typeof STEPS[number] | null = null;
    for (const s of STEPS) if (s.step > (l.nurture_step || 0) && ageDays >= s.afterDays) due = s;
    if (!due) continue;

    const name = (l.first_name || l.full_name || "there").split(" ")[0];
    const purpose = l.loan_purpose ? `your ${l.loan_purpose} financing` : "your financing";
    try {
      await respondToLead({ name, email: l.email, phone: l.phone, loan_purpose: l.loan_purpose, message: due.msg(name, purpose) });
      await supabaseAdmin.from("leads")
        .update({ nurture_step: due.step, last_nurture_at: new Date().toISOString() })
        .eq("id", l.id);
      sent++;
    } catch (e) {
      console.warn("[nurture] failed for", l.id, e);
    }
  }
  return { considered, sent };
}
