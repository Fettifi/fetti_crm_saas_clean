import { NextRequest, NextResponse } from "next/server";
import { twilioSignatureValid, webhookCandidateUrls } from "@/lib/twilioVerify";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// Twilio Status Callback — receives delivery status for outbound SMS
// (queued, sent, delivered, undelivered, failed). We just acknowledge + log;
// extend later to persist per-message status if needed.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (token) {
      const sig = req.headers.get("x-twilio-signature") || "";
      if (!twilioSignatureValid(token, sig, webhookCandidateUrls(req, "/api/sms/status"), params)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
    const sid = params["MessageSid"];
    const status = params["MessageStatus"];
    console.log("[sms/status]", sid, "->", status, "to", params["To"]);
    // Persist the delivery state onto the conversation thread. Find the original
    // outbound message we logged with this SID to scope the status to its lead,
    // then append a comms.status row the timeline maps back onto that bubble.
    if (sid && status) {
      try {
        const { data: orig } = await supabaseAdmin
          .from("activity_log").select("lead_id").eq("action", "comms.message")
          .filter("detail->>providerId", "eq", sid).limit(1).maybeSingle();
        const leadId = (orig as any)?.lead_id || null;
        await logActivity({
          entity_type: "sms", entity_id: sid, lead_id: leadId,
          actor: "system", action: "comms.status",
          detail: { sid, status, to: params["To"] || null },
        });

        // DELIVERABILITY GUARD: a `failed`/`undelivered` receipt means the text never
        // landed — a queued 201 alone is NOT proof of contact. Stamp the lead so the
        // drip prefers email over re-texting a dead number, and page the team for
        // high-value leads (their auto-text won't reach them, a human must follow up).
        const failed = status === "failed" || status === "undelivered";
        if (failed && leadId) {
          try {
            const { data: lead } = await supabaseAdmin
              .from("leads").select("id, full_name, phone, tier, raw").eq("id", leadId).maybeSingle();
            if (lead) {
              const raw = ((lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {}) as Record<string, any>;
              raw.sms_undeliverable = true;
              raw.sms_undeliverable_at = new Date().toISOString();
              raw.sms_undeliverable_status = status;
              await supabaseAdmin.from("leads").update({ raw }).eq("id", leadId);
              await logActivity({
                entity_type: "lead", entity_id: leadId, lead_id: leadId,
                actor: "system", action: "sms.undeliverable",
                detail: { sid, status, to: params["To"] || null },
              });
              // Tier 1 = high value: bounced text means the auto-drip can't reach them,
              // so open a de-duped task for a human to try phone/email today.
              if (/tier\s*1/i.test(String((lead as any).tier || ""))) {
                const dedup_key = `sms_undeliverable:${leadId}`;
                const who = (lead as any).full_name || (lead as any).phone || "Lead";
                const title = `SMS undeliverable — ${who}`.slice(0, 120);
                const detail = `Text to ${(lead as any).phone || params["To"] || "their number"} came back ${status}. High-value lead — reach out by phone/email today.`;
                const nowIso = new Date().toISOString();
                const { data: existing } = await supabaseAdmin
                  .from("org_tasks").select("id").eq("dedup_key", dedup_key).limit(1).maybeSingle();
                if (existing?.id) {
                  await supabaseAdmin.from("org_tasks")
                    .update({ status: "open", title, detail, due_at: nowIso, completed_at: null, completed_by: null })
                    .eq("id", (existing as any).id);
                } else {
                  await supabaseAdmin.from("org_tasks").insert([
                    { title, detail, source: "sms_undeliverable", status: "open", priority: 9, dedup_key, cadence: "once", due_at: nowIso },
                  ]);
                }
              }
            }
          } catch (e) { console.warn("[sms/status] undeliverable handling failed", e); }
        }
      } catch (e) { console.warn("[sms/status] persist failed", e); }
    }
  } catch (e) {
    console.warn("[sms/status] parse error", e);
  }
  return new NextResponse(null, { status: 204 });
}
