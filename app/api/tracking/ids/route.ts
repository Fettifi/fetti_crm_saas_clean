// Advertising pixel IDs, resolved at RUNTIME.
//
// NEXT_PUBLIC_* values are inlined at BUILD time, so adding a pixel meant editing a Vercel
// env var and redeploying. This endpoint lets a pixel be switched on by pasting its id into
// app_settings instead — the same runtime pattern /api/places/key already uses for the Maps
// browser key. Pixel ids are public by design (they ship to every visitor's browser), so
// there is nothing to protect here.
//
// PRECEDENCE IS DELIBERATE: the build-time env var WINS, and app_settings only fills a gap.
// Reversing it would be dangerous — app_settings currently holds META_PIXEL_ID
// 950312781395864 while the pixel actually firing in production is 1589486079414223, so a
// settings-first lookup would silently repoint live Meta conversions at a stale pixel and
// corrupt ad attribution. Env is the source of truth for anything already working.
import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const clean = (v?: string | null) => {
  const s = String(v || "").trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined" ? s : null;
};

export async function GET() {
  // env first, settings as the fallback (see the note above).
  const [metaDb, tiktokDb, gadsDb] = await Promise.all([
    getSetting("NEXT_PUBLIC_META_PIXEL_ID").catch(() => null),
    getSetting("NEXT_PUBLIC_TIKTOK_PIXEL_ID").catch(() => null),
    getSetting("NEXT_PUBLIC_GOOGLE_ADS_ID").catch(() => null),
  ]);
  const meta = clean(process.env.NEXT_PUBLIC_META_PIXEL_ID) ?? clean(metaDb);
  const tiktok = clean(process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID) ?? clean(tiktokDb);
  const gads = clean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID) ?? clean(gadsDb);

  return NextResponse.json(
    { meta, tiktok, gads },
    // Short cache: a newly pasted id goes live within a minute, without a redeploy.
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
