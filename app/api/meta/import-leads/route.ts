import { NextRequest, NextResponse } from "next/server";
import { importHistoricalLeads } from "@/lib/metaHeal";

// Recover historical Facebook/Instagram Lead Ads leads stranded in Meta's Lead Center
// into the CRM. Inserts DIRECTLY (no auto email/SMS to these older contacts), deduped
// by Meta leadgen_id, flagged for manual review. Gated by CRON_SECRET. Idempotent.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  const h = req.headers.get("authorization") || "";
  return h === `Bearer ${sec}`;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await importHistoricalLeads());
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await importHistoricalLeads());
}
