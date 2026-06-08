// Public address verification endpoint (used by the application wizard, the
// pre-approval form, and anywhere addresses are entered). Lightweight geocode
// lookup — no secrets, safe to be public.
import { NextRequest, NextResponse } from "next/server";
import { verifyAddress } from "@/lib/address";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const result = await verifyAddress(q);
  return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=600" } });
}
