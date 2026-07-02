import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { cfg } from "@/lib/settings";
import crypto from "crypto";

// Caller identification for the realtime "Penny" voice agent. The bridge POSTs the
// inbound caller's phone number here on call start; we match it to a lead and return
// ONLY greeting-safe context (first name, what they're inquiring about, pipeline stage)
// so Penny can open personally — never sensitive PII (a phone number isn't proof of
// identity). Token-authed (same Bearer VOICE_INGEST_TOKEN as the ingest sink). Fails safe
// (returns { known:false } on any miss/error so the call always proceeds).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = await cfg("VOICE_INGEST_TOKEN");
  if (!expected) return NextResponse.json({ known: false });
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !tokenOk(token, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = await req.json().catch(() => ({}));
    const digits = String(b.phone || "").replace(/\D/g, "");
    if (digits.length < 7) return NextResponse.json({ known: false });
    const last10 = digits.slice(-10);

    // Most-recent lead whose stored phone contains the caller's last 10 digits
    // (form leads store phone as digits). Only greeting-safe columns are selected.
    const { data } = await supabaseAdmin
      .from("leads")
      .select("first_name, full_name, loan_purpose, stage, created_at")
      .ilike("phone", `%${last10}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return NextResponse.json({ known: false });
    const first = data.first_name || (data.full_name ? String(data.full_name).split(" ")[0] : null);
    return NextResponse.json({
      known: true,
      first_name: first,
      loan_purpose: data.loan_purpose || null,
      stage: data.stage || null,
    });
  } catch {
    return NextResponse.json({ known: false });
  }
}
