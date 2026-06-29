// Poll the status of a TikTok Direct Post (PROCESSING_UPLOAD → PUBLISH_COMPLETE /
// FAILED). The composer calls this after publish to confirm the post landed.
// Protected (see proxy.ts).
import { NextRequest, NextResponse } from "next/server";
import { tiktokPublishStatus } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const publishId = req.nextUrl.searchParams.get("publish_id");
  if (!publishId) return NextResponse.json({ status: "ERROR", detail: "publish_id required" }, { status: 400 });
  try {
    return NextResponse.json(await tiktokPublishStatus(publishId));
  } catch (e) {
    return NextResponse.json({ status: "ERROR", detail: e instanceof Error ? e.message : "error" });
  }
}
