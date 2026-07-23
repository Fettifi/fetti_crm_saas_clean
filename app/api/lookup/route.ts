// Reverse phone lookup API.
//   GET /api/lookup?phone=2135551234          -> CRM matches + Twilio caller ID (fast)
//   GET /api/lookup?phone=2135551234&deep=1   -> + web sweep with AI "who is this" summary
// Auth-gated by the /api/lookup matcher in proxy.ts (staff only).
import { NextRequest, NextResponse } from "next/server";
import { lookupNumber } from "@/lib/phoneLookup";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // deep sweep = search + flagship AI synthesis

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") || "";
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  const result = await lookupNumber(phone, { deep });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
