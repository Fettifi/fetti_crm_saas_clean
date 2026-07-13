// "Talk right now" from the borrower connect page → fires the live-call BRIDGE
// (rings the owner first with a whisper; press 1 connects him to the borrower).
// Borrower-facing, gated by the HMAC connect token (not a session). Degrades
// gracefully: if the bridge isn't configured (no OWNER_CELL) it tells the page to
// fall back to booking.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { connectTokenValid, bookingLinks } from "@/lib/connect";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const APP = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const leadId = String(b.lead || "");
    const t = String(b.t || "");
    if (!leadId || !connectTokenValid(leadId, t)) return NextResponse.json({ ok: false, error: "invalid link" }, { status: 403 });

    const { data: lead } = await supabaseAdmin.from("leads")
      .select("id, first_name, full_name, phone, raw, nurture_paused").eq("id", leadId).maybeSingle();
    if (!lead?.phone) return NextResponse.json({ ok: true, calling: false, fallback: "no_phone" });
    if (lead.nurture_paused || (lead as any).raw?.sms_optout_at) return NextResponse.json({ ok: true, calling: false, fallback: "opted_out" });

    const { ownerCell } = await bookingLinks();
    if (!ownerCell) {
      // No owner cell configured → can't bridge; page shows "we'll call you shortly"
      // + booking, and the team gets a top task to reach out.
      await supabaseAdmin.from("org_tasks").insert([{
        title: `🔴 CALL NOW REQUEST — ${lead.full_name || lead.first_name || "borrower"}`.slice(0, 200),
        detail: `${lead.full_name || "A borrower"} tapped "Talk right now" on the connect page. Call them ASAP: ${lead.phone}. (Set OWNER_CELL to enable instant auto-bridge.)`,
        source: "connect_call_now", status: "open", priority: 10,
        dedup_key: `callnow:${leadId}`.slice(0, 80), cadence: "once", due_at: new Date().toISOString(),
      }]).select("id").then(() => {}, () => {});
      return NextResponse.json({ ok: true, calling: false, fallback: "team_will_call" });
    }

    // Fire the live bridge (rings owner → press 1 → connects to the borrower).
    const r = await fetch(`${APP}/api/voice/bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET || "" },
      body: JSON.stringify({ lead_id: leadId, reason: "tapped Talk right now on the connect page" }),
    }).then((x) => x.json()).catch(() => ({ bridged: false }));

    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "borrower", action: "connect.call_now", detail: { bridged: !!r?.bridged, throttled: r?.error === "throttled" } }).catch(() => {});

    // Throttled just means we recently tried — still tell the borrower it's coming.
    return NextResponse.json({ ok: true, calling: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
