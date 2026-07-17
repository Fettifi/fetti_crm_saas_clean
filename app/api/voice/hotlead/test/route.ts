// DIAGNOSTIC: rings the OWNER's cell (LEAD_NOTIFY_SMS_TO) with a TEST hot-lead page so
// Ramon can hear the whole flow end-to-end and press 1/2. It can ONLY ever call the
// owner number (the synthetic borrower is the owner's own cell too), never a third
// party. CRON_SECRET-gated so it can be fired from an authenticated tool.
import { NextRequest, NextResponse } from "next/server";
import { pageOwnerHotLead, ownerCellE164 } from "@/lib/hotLead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = ownerCellE164();
  if (!owner) return NextResponse.json({ error: "LEAD_NOTIFY_SMS_TO not configured" }, { status: 400 });
  // Synthetic lead — borrower is the owner's OWN cell, so pressing 1 self-dials harmlessly.
  const testLead = { id: "hotlead-test", first_name: "Marcus", full_name: "Marcus (TEST)", phone: owner, email: "test@fetti.demo", raw: {} };
  const r = await pageOwnerHotLead(testLead, "This is a test of your hot lead alert. Tier one lead for a D S C R loan in Tampa", { force: true });
  return NextResponse.json({ ok: r.paged, result: r, note: r.paged ? "Your cell should ring in a few seconds." : "Not paged — see reason." });
}
