// Server-signed form-timing token. Forms fetch this on mount and echo it back
// as `fst` on submit — the server (leadShield.verifyFormToken) then knows the
// TRUE fill time; a client can't forge it. Fail-soft everywhere: a form that
// never fetched a token just carries a weak +15 signal, never a block.
import { NextRequest, NextResponse } from "next/server";
import { mintFormToken } from "@/lib/leadShield";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`apply-token:${clientIp(req)}`, 60, 600))) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  return NextResponse.json({ fst: mintFormToken() });
}
