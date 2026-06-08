// Lightweight Meta connection status — runs the self-heal (validate/refresh) and
// returns only coarse health (no token, no secrets). Used by the Doctor view and
// for verification.
import { NextResponse } from "next/server";
import { healMetaToken } from "@/lib/metaHeal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const r = await healMetaToken();
    return NextResponse.json({ status: r.status, detail: r.detail, daysLeft: r.daysLeft ?? null });
  } catch (e) {
    return NextResponse.json({ status: "error", detail: e instanceof Error ? e.message : "error" }, { status: 200 });
  }
}
