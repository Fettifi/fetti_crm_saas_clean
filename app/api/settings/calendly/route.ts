import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

// Calendly scheduling link config. Auth-gated via the /api/settings matcher.
//   GET  -> { url }
//   POST { url } -> save (validates it's a calendly.com link or empty to clear)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = (await getSetting("CALENDLY_URL")) || process.env.CALENDLY_URL || "";
  return NextResponse.json({ url });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.url || "").trim();
    if (raw && !/^https:\/\/(www\.)?calendly\.com\//i.test(raw)) {
      return NextResponse.json({ error: "Enter a full Calendly link, e.g. https://calendly.com/your-name/30min" }, { status: 422 });
    }
    await setSetting("CALENDLY_URL", raw);
    return NextResponse.json({ ok: true, url: raw });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed." }, { status: 500 });
  }
}
