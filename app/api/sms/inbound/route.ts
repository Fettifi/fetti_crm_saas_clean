import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";

export const dynamic = "force-dynamic";

// Twilio inbound SMS webhook ("A message comes in"). When a lead replies:
//  - pause their automated nurture (they're engaged — a human takes over)
//  - ping the team in Discord with the reply so they respond fast
// Returns empty TwiML so Twilio doesn't auto-reply.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const from = String(form.get("From") || "");
    const body = String(form.get("Body") || "").trim();
    const digits = from.replace(/\D/g, "").slice(-10);

    if (digits) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, full_name, phone")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lead) {
        await supabaseAdmin.from("leads").update({ nurture_paused: true }).eq("id", (lead as any).id);
      }

      const hook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (hook) {
        const who = (lead as any)?.full_name || from;
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `💬 **Lead replied** — ${who} (${from})\n"${body}"\n${lead ? "⏸️ Auto-nurture paused. Reply to them now!" : "(no matching lead found)"}`,
          }),
        });
      }
    }
  } catch (e) {
    console.warn("[sms/inbound] error", e);
  }
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
