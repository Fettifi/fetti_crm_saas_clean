// INBOUND-EMAIL capture (webhook path) — for a dedicated inbound provider
// (Cloudflare Email Routing / Postmark / Mailgun / a forwarding rule pointed at a
// reply subdomain). Parses the provider payload and hands it to the shared
// ingestion (lib/inbound/ingestEmail) — the SAME logic the frank@ Graph poll uses.
//
// This is the dedicated-address path, so alertUnmatched is true: an unmatched
// sender here is worth a team alert. Secured by a shared token
// (EMAIL_INBOUND_SECRET) in the URL or an x-inbound-token header.
import { NextRequest, NextResponse } from "next/server";
import { cfg } from "@/lib/settings";
import { parseInbound, ingestInboundEmail } from "@/lib/inbound/ingestEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Auth: shared secret via ?token= or x-inbound-token header. If a secret is set,
    // enforce it (fail-closed); if not yet configured, accept + log (so the pipe can
    // be tested) — set EMAIL_INBOUND_SECRET to harden.
    const secret = await cfg("EMAIL_INBOUND_SECRET");
    if (secret) {
      const got = req.nextUrl.searchParams.get("token") || req.headers.get("x-inbound-token");
      if (got !== secret) return NextResponse.json({ error: "bad token" }, { status: 401 });
    }

    const ct = req.headers.get("content-type") || "";
    let body: any = {};
    if (ct.includes("application/json")) body = await req.json().catch(() => ({}));
    else { const fd = await req.formData().catch(() => null); if (fd) body = Object.fromEntries([...fd.entries()]); }

    const parsed = parseInbound(body);
    const result = await ingestInboundEmail(parsed, { alertUnmatched: true, source: "webhook" });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[email-inbound]", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
