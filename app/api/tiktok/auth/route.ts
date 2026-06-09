// Start the TikTok OAuth flow: generate a CSRF state, store it, redirect to TikTok.
import { NextResponse } from "next/server";
import { tiktokAuthUrl } from "@/lib/tiktok";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = crypto.randomUUID();
  await setSetting("TIKTOK_OAUTH_STATE", state);
  const url = await tiktokAuthUrl(state);
  if (!url) {
    return NextResponse.json({ error: "TikTok app not configured — set TIKTOK_CLIENT_KEY." }, { status: 400 });
  }
  return NextResponse.redirect(url);
}
