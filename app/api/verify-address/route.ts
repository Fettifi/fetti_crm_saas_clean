// Public address verification endpoint (used by the application wizard, the
// pre-approval form, and anywhere addresses are entered). Lightweight geocode
// lookup — no secrets, safe to be public.
import { NextRequest, NextResponse } from "next/server";
import { verifyAddress } from "@/lib/address";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public + unauthenticated + calls a paid geocoder → throttle per IP to prevent
  // abuse / bill run-up. 60 requests / 10 min is generous for real form typing.
  if (!(await rateLimit(`verify-address:${clientIp(req)}`, 60, 600))) {
    return NextResponse.json({ verified: false, error: "rate_limited" }, { status: 429 });
  }
  const q = req.nextUrl.searchParams.get("q") || "";
  const result = await verifyAddress(q);
  return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=600" } });
}
