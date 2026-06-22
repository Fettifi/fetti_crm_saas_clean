import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";

// Calendly webhook receiver — when a borrower books (or cancels) a call, record
// it on the matching lead and mark them Engaged so the funnel keeps working them.
// Public endpoint (Calendly calls it). If CALENDLY_WEBHOOK_SIGNING_KEY is set we
// verify the signature; otherwise we accept and log (set the key to harden).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
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
    const { data: lead } = await supabaseAdmin
      .from("leads").select("id, stage").ilike("email", email)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!lead) return NextResponse.json({ ok: true, note: "no matching lead" });

    if (event === "invitee.created") {
      const stage = (lead.stage || "").toLowerCase();
      const fresh = !stage || stage === "new lead" || stage === "new" || stage === "contacted";
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
