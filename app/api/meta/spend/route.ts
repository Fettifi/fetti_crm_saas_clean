import { NextRequest, NextResponse } from "next/server";
import { metaSpendTrace } from "@/lib/metaHeal";

// Read-only: where is the Facebook money going? Per ad account: spend today/yesterday/
// 7d/30d, the funding card, and per-campaign last-7d spend + what it bought (leads vs
// link clicks). Gated by CRON_SECRET.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authed(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  const h = req.headers.get("authorization") || "";
  const q = req.nextUrl.searchParams.get("secret") || "";
  return h === `Bearer ${sec}` || q === sec;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaSpendTrace());
}
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaSpendTrace());
}
