import { NextRequest, NextResponse } from "next/server";

// Clean, say-it-out-loud vanity link for the YouTube sponsorship: fettifi.com/tv
// → the "The Lot" capture landing page, with attribution UTMs baked in so every
// lead from the show is tagged and measurable.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const url = new URL("/lp/tv", req.url);
  url.searchParams.set("utm_source", "youtube");
  url.searchParams.set("utm_medium", "sponsor");
  url.searchParams.set("utm_campaign", "thelot");
  return NextResponse.redirect(url, 307);
}
