// Meta connection status — runs self-heal then reports Facebook + Instagram
// connection state for the UI. No token/secret in the response.
import { NextResponse } from "next/server";
import { healMetaToken, metaConnectionStatus } from "@/lib/metaHeal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const heal = await healMetaToken();
    const conn = await metaConnectionStatus();
    return NextResponse.json({ token: { status: heal.status, daysLeft: heal.daysLeft ?? null }, ...conn });
  } catch (e) {
    return NextResponse.json({ token: { status: "error" }, facebook: { connected: false }, instagram: { linked: false, canPublish: false }, error: e instanceof Error ? e.message : "error" });
  }
}
