import { NextRequest, NextResponse } from "next/server";

// Referral link target: fettifi.com/r/<code> → sends the visitor to the homepage
// with ?ref=<code> so their lead gets attributed to the referrer. Public.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = String(code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
  const url = new URL("/", `https://${req.headers.get("host") || "fettifi.com"}`);
  if (clean) {
    url.searchParams.set("ref", clean);
    url.searchParams.set("utm_source", "referral");
    url.searchParams.set("utm_medium", "referral");
    url.searchParams.set("utm_campaign", "member_referral");
  }
  return NextResponse.redirect(url, 307);
}
