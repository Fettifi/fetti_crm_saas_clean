// Scheduled CRM Doctor run (Vercel Cron). Monitors + auto-repairs every few hours.
import { NextRequest, NextResponse } from "next/server";
import { runDoctor } from "@/lib/doctor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try { return NextResponse.json(await runDoctor()); }
  catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 }); }
}
