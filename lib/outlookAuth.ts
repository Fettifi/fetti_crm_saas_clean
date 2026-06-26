import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

// Shared bearer-token gate for the Outlook add-in's public endpoints
// (/api/outlook/*). These routes are intentionally NOT behind the CRM login
// gate in proxy.ts (the task pane runs inside Outlook, with no Supabase
// session), so they protect themselves here.
//
// The token rides in the add-in MANIFEST (passed to the task pane as a ?k=
// query param) and is sent to these endpoints as `Authorization: Bearer <token>`.
// It never appears in any HTML shipped to the public web.
//
// Fail-CLOSED: if the server has no OUTLOOK_ADDIN_KEY configured, every request
// is rejected with 503 rather than left wide open.
export function requireAddinAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.OUTLOOK_ADDIN_KEY;
  if (!expected) {
    return NextResponse.json({ error: "Add-in not configured." }, { status: 503 });
  }
  const hdr = req.headers.get("authorization") || "";
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const token = (m ? m[1] : "").trim();
  if (!token || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

// Constant-time comparison. Hashing both sides to a fixed 32-byte digest first
// means the compare is constant-time AND leaks nothing about the token's length
// (timingSafeEqual otherwise requires equal-length inputs).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
