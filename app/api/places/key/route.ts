// Returns the (referrer-restricted) Google Maps browser key at RUNTIME. The key is a
// Vercel "Sensitive" env var, so it is NOT inlined into the client bundle at build — the
// browser fetches it here instead, then loads the Maps JS SDK with it. Exposing a
// referrer-restricted key client-side is safe + intended (it only works from our origin's
// referrer); this is equivalent to what NEXT_PUBLIC inlining would have done.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

export async function GET() {
  return NextResponse.json({ key: KEY }, { headers: { "Cache-Control": "public, max-age=600" } });
}
