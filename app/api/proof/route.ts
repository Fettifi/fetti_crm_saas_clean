// PUBLIC read endpoint for the social-proof wall. Returns only real Google
// reviews + approved, consented borrower wins (or an empty set). Safe to call
// from any public surface. NOT listed in proxy.ts apiProtected, so it stays open.
import { NextRequest, NextResponse } from "next/server";
import { getProofData } from "@/lib/proof";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loanType = req.nextUrl.searchParams.get("loanType") || undefined;
  const data = await getProofData(loanType);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
  });
}
