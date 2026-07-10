import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { cfg } from "@/lib/settings";
import { scoreLead } from "@/lib/leadScore";

// Calendly webhook receiver — when a borrower books (or cancels) a call, record
// it on the matching lead and mark them Engaged so the funnel keeps working them.
// Public endpoint (Calendly calls it). If CALENDLY_WEBHOOK_SIGNING_KEY is set we
// verify the signature; otherwise we accept and log (set the key to harden).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function verify(sigHeader: string | null, raw: string, key: string): boolean {
  if (!sigHeader) return false;
  try {
    const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.trim().split("=")));
    const t = parts["t"]; const v1 = parts["v1"];
    if (!t || !v1) return false;
    const expected = crypto.createHmac("sha256", key).update(`${t}.${raw}`).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    // Signing key comes from env OR app_settings — the admin registration endpoint
    // (/api/admin/calendly-webhook) stores it in app_settings at subscription time.
    const key = await cfg("CALENDLY_WEBHOOK_SIGNING_KEY");
    if (key && !verify(req.headers.get("calendly-webhook-signature"), raw, key)) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
    const body = JSON.parse(raw || "{}");
    const event: string = body?.event || "";
    const p = body?.payload || {};
    const email: string | undefined = p?.email || p?.invitee?.email;
    const startTime: string | undefined = p?.scheduled_event?.start_time || p?.event?.start_time;
    const eventName: string | undefined = p?.scheduled_event?.name || p?.event_type?.name;
    if (!email) return NextResponse.json({ ok: true, note: "no invitee email" });

    // Match to a lead by email (most recent).
    let { data: lead } = await supabaseAdmin
      .from("leads").select("id, stage").ilike("email", email)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    // UNMATCHED invitee — someone booked a call from an email we don't know.
    // That's a high-intent LEAD, not a drop (this used to vanish silently with no
    // log). Create it as Engaged/calendly so the funnel + alerts pick it up.
    if (!lead && event === "invitee.created") {
      const inviteeName: string | null = p?.name || p?.invitee?.name || null;
      const phone: string | null =
        p?.text_reminder_number || p?.invitee?.text_reminder_number ||
        (Array.isArray(p?.questions_and_answers)
          ? p.questions_and_answers.find((q: any) => /phone|number/i.test(q?.question || ""))?.answer || null
          : null);
      const { score, tier } = scoreLead({});
      const { data: created, error } = await supabaseAdmin.from("leads").insert({
        full_name: inviteeName, email, phone,
        stage: "Engaged", source: "calendly", lead_source: "calendly",
        score, tier,
        notes: `Booked "${eventName || "a call"}" via Calendly${startTime ? ` for ${startTime}` : ""} — created from the booking (no prior lead matched this email).`,
        raw: { calendly: { event: eventName || null, start_time: startTime || null, created_from: "webhook_unmatched_invitee" } },
      }).select("id, stage").single();
      if (error || !created) {
        // Never lose the booking silently — leave a trail even when insert fails.
        console.error("[calendly/webhook] unmatched-invitee insert failed", error);
        await logActivity({
          entity_type: "org", entity_id: "calendly", actor: "system",
          action: "calendly.unmatched", detail: { email, event: eventName || null, start_time: startTime || null, error: error?.message || null },
        }).catch(() => {});
        return NextResponse.json({ ok: true, note: "unmatched invitee (logged)" });
      }
      lead = created;
      try {
        const { notifyNewLead } = await import("@/lib/notify/leadAlert");
        await notifyNewLead({ full_name: inviteeName, email, phone, tier, score, source: "calendly", loan_purpose: eventName || null } as any);
      } catch { /* best-effort */ }
    }
    if (!lead) return NextResponse.json({ ok: true, note: "no matching lead" });

    if (event === "invitee.created") {
      // SHIELD: booking a real call is human evidence — release a quarantined
      // lead (no-op unless stage is Review) before the stage bump below.
      try {
        const { autoPromoteIfQuarantined } = await import("@/lib/leadShield");
        await autoPromoteIfQuarantined(lead.id, "calendly_booked");
      } catch { /* best-effort */ }
      const stage = (lead.stage || "").toLowerCase();
      const fresh = !stage || stage === "new lead" || stage === "new" || stage === "contacted" || stage === "review";
      if (fresh) {
        await supabaseAdmin.from("leads").update({ stage: "Engaged", last_nurture_at: new Date().toISOString() }).eq("id", lead.id);
      }
      await logActivity({
        entity_type: "lead", entity_id: lead.id, lead_id: lead.id,
        actor: "borrower", action: "calendly.booked",
        detail: { event: eventName || "call", start_time: startTime || null, email },
      });
    } else if (event === "invitee.canceled") {
      await logActivity({
        entity_type: "lead", entity_id: lead.id, lead_id: lead.id,
        actor: "borrower", action: "calendly.canceled",
        detail: { event: eventName || "call", email },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[calendly/webhook]", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
