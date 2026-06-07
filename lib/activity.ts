// The nervous system of the enterprise brain. Every meaningful action anywhere
// in the CRM logs here; the org-learn agent reads this stream to learn what's
// working and what to do next. Logging is best-effort and never blocks a request.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export type Activity = {
  entity_type?: string;            // lead | loan_file | document | agent | sms | email | wizard | org
  entity_id?: string | null;
  loan_file_id?: string | null;
  lead_id?: string | null;
  actor?: string;                  // system | cron | borrower | lo | agent:<stage>
  action: string;                  // e.g. lead.created, doc.uploaded, stage.changed
  detail?: Record<string, unknown> | null;
};

export async function logActivity(a: Activity): Promise<void> {
  try {
    await supabaseAdmin.from("activity_log").insert([{
      entity_type: a.entity_type ?? null,
      entity_id: a.entity_id ? String(a.entity_id) : null,
      loan_file_id: a.loan_file_id ?? null,
      lead_id: a.lead_id ?? null,
      actor: a.actor ?? "system",
      action: a.action,
      detail: a.detail ?? null,
    }]);
  } catch (e) {
    console.warn("[activity] log failed:", e);
  }
}
