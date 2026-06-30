import { NextRequest, NextResponse } from "next/server";

// Clean, say-it-out-loud vanity link for the Kendrick Perkins referral campaign:
// fettifi.com/kp → the DSCR INVESTOR capture page (all 50 states). It lands on the
// INVESTMENT/business-purpose funnel on purpose: under RESPA §8 a referral partner
// can be compensated on investor loans but NOT on consumer/owner-occupied mortgages,
// so the whole funnel is scoped to investment. His referral code (partner "PERK") +
// campaign UTMs are baked in so every lead attributes to him and is measurable.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const url = new URL("/lp/dscr", req.url);
  url.searchParams.set("ref", "PERK");
  url.searchParams.set("utm_source", "kendrick-perkins");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", "kendrick-perkins");
  return NextResponse.redirect(url, 307);
}
