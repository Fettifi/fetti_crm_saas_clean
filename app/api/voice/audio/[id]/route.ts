import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

// Serves the ElevenLabs reply audio the receptionist generated, for Twilio <Play>.
// Public (Twilio fetches it). One-time: cleared after playback to keep app_settings lean.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clean = String(id || "").replace(/[^a-f0-9]/g, "");
  const b64 = await getSetting("va:" + clean);
  if (!b64) return new NextResponse("not found", { status: 404 });
  const buf = Buffer.from(b64, "base64");
  setSetting("va:" + clean, "").catch(() => {}); // best-effort one-time cleanup
  return new NextResponse(new Uint8Array(buf), { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
