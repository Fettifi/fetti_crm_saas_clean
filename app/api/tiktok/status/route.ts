// TikTok connection status for the Content Studio UI. No secrets in the response.
import { NextResponse } from "next/server";
import { tiktokStatus } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(await tiktokStatus());
  } catch (e) {
    return NextResponse.json({ configured: false, connected: false, canPublish: false, detail: e instanceof Error ? e.message : "error" });
  }
}
