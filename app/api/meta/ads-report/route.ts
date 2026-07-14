import { NextRequest, NextResponse } from "next/server";
import { metaAdsReport } from "@/lib/metaHeal";

// Read-only diagnostic: WHY are/aren't Facebook leads coming in? Reports ad accounts,
// campaigns + objectives + delivery, spend, and lead-form counts with a verdict.
// Never changes a campaign or spends money. Gated by CRON_SECRET.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authed(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  const h = req.headers.get("authorization") || "";
  return h === `Bearer ${sec}`;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaAdsReport());
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaAdsReport());
}
