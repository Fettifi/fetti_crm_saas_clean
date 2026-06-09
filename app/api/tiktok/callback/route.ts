// TikTok OAuth redirect target. Verifies the CSRF state, exchanges the code for
// tokens, then bounces back to the Content Studio with a status flag.
import { NextRequest, NextResponse } from "next/server";
import { tiktokExchangeCode } from "@/lib/tiktok";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const base = req.nextUrl.origin;
  const code = sp.get("code");
  const state = sp.get("state");
  const err = sp.get("error");
  if (err) return NextResponse.redirect(`${base}/content?tiktok=error`);

  const saved = await getSetting("TIKTOK_OAUTH_STATE");
  if (!code || !state || !saved || state !== saved) {
    return NextResponse.redirect(`${base}/content?tiktok=badstate`);
  }
  try {
    await tiktokExchangeCode(code);
    return NextResponse.redirect(`${base}/content?tiktok=connected`);
  } catch {
    return NextResponse.redirect(`${base}/content?tiktok=fail`);
  }
}
