// Staff resolve endpoint for the CRM UI (leads screen banner buttons):
//   POST { leadId, action: "promote" | "dismiss" }
// Session-gated by proxy.ts (/api/shield/resolve is in apiProtected).
import { NextRequest, NextResponse } from "next/server";
import { promoteQuarantined, dismissQuarantined } from "@/lib/leadShield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const leadId = String(b.leadId || "");
  const action = String(b.action || "");
  if (!leadId || !["promote", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "leadId + action (promote|dismiss) required" }, { status: 400 });
  }
  const ok = action === "promote"
    ? await promoteQuarantined(leadId, "owner:crm", "owner_promote")
    : await dismissQuarantined(leadId, "owner:crm");
  if (!ok) return NextResponse.json({ error: "lead is not in Review (already resolved?)" }, { status: 409 });
  return NextResponse.json({ ok: true, action });
}
