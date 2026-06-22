import { NextRequest, NextResponse } from "next/server";
import { resolveLocation } from "@/lib/propertyData";

// ZIP -> ZIP-accurate property-tax + homeowner's-insurance estimate for the Quick
// Pricer. Auth-gated by the /api/pricer matcher (internal sales tool). The heavy
// (~1MB) Census dataset lives here on the server, never shipped to the browser.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const zip = req.nextUrl.searchParams.get("zip") || "";
  return NextResponse.json(resolveLocation(zip));
}
