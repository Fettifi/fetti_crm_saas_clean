// Deal Scout API — list / import / update FSBO acquisition targets.
// Session-gated by proxy.ts (apiProtected + matcher). No lead-table writes ever.
import { NextRequest, NextResponse } from "next/server";
import { listDeals, importDeals, getDeal, saveDeal, recordEvent, type ScoutStatus } from "@/lib/scoutStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deals = await listDeals();
  return NextResponse.json({ deals });
}

// Import scored listings (paste of the deal-scout screener's JSON export).
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const rows = Array.isArray(body) ? body : Array.isArray(body?.deals) ? body.deals : null;
  if (!rows) return NextResponse.json({ error: "expected a JSON array of listings" }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ error: "max 500 listings per import" }, { status: 400 });
  const res = await importDeals(rows);
  return NextResponse.json(res);
}

// Update workflow state: verify / pass / notes / contact / optout / manual status.
const ALLOWED_STATUS: ScoutStatus[] = ["new", "verified", "invited", "replied", "meeting_booked", "loi_sent", "under_contract", "passed"];

export async function PATCH(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = String(body?.id || "");
  const deal = id ? await getDeal(id) : null;
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  if (typeof body.notes === "string") deal.notes = body.notes.slice(0, 4000);
  if (typeof body.seller_name === "string") deal.seller_name = body.seller_name.slice(0, 120) || null;
  if (typeof body.seller_phone === "string") deal.seller_phone = body.seller_phone.slice(0, 40) || null;
  if (typeof body.seller_email === "string") deal.seller_email = body.seller_email.slice(0, 160) || null;
  if (typeof body.optout === "boolean") {
    deal.optout = body.optout;
    deal.events = [...(deal.events || []), { at: new Date().toISOString(), kind: body.optout ? "optout_set" : "optout_cleared" }];
  }
  if (body.status && ALLOWED_STATUS.includes(body.status)) {
    const prev = deal.status;
    deal.status = body.status;
    deal.events = [...(deal.events || []), { at: new Date().toISOString(), kind: "status", detail: `${prev} -> ${body.status}` }];
  }
  const saved = await saveDeal(deal);
  return NextResponse.json({ deal: saved });
}

// Convenience: mark replied/booked from other systems later (kept internal for now).
export async function PUT(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const id = String(body?.id || "");
  const kind = String(body?.event || "");
  if (!id || !kind) return NextResponse.json({ error: "id and event required" }, { status: 400 });
  const deal = await recordEvent(id, kind, body?.detail ? String(body.detail).slice(0, 500) : undefined,
    ALLOWED_STATUS.includes(body?.status) ? body.status : undefined);
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });
  return NextResponse.json({ deal });
}
