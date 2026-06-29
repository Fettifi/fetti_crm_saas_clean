// Creator info for the TikTok Direct Post composer (privacy options, interaction
// flags, nickname). TikTok's UX guidelines require this be fetched FRESH each time
// the posting screen is shown. Protected (see proxy.ts).
import { NextResponse } from "next/server";
import { tiktokCreatorInfo } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(await tiktokCreatorInfo());
  } catch (e) {
    return NextResponse.json({ ok: false, privacyOptions: [], commentDisabled: true, duetDisabled: true, stitchDisabled: true, error: e instanceof Error ? e.message : "error" });
  }
}
