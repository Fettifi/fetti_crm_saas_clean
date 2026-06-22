import { NextRequest, NextResponse } from "next/server";
import { getAdapter, listChannels } from "@/lib/pricing/adapters";

// Connection status + live connection test for a pricing channel.
// Auth-gated via the /api/pricing matcher in proxy.ts.
//   GET ?channel=optimalblue            -> cheap config status (which keys are set; NO external call, NO secrets)
//   GET ?channel=optimalblue&run=1      -> live test: mint token + 1 pricing call + dry-run normalize (no DB write)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") || "optimalblue";
  const run = req.nextUrl.searchParams.get("run") === "1";
  const adapter = getAdapter(channel);
  if (!adapter) return NextResponse.json({ error: `unknown channel "${channel}"`, channels: listChannels() }, { status: 400 });

  try {
    if (!run) {
      const status = await adapter.configStatus();
      return NextResponse.json({ channel: adapter.channel, displayName: adapter.displayName, ...status });
    }
    const res = await adapter.testConnection();
    // res.keys are booleans only; res.raw is OB pricing data (no secrets) kept to
    // help fill the field maps. Secrets are never part of any adapter result.
    return NextResponse.json({ channel: adapter.channel, displayName: adapter.displayName, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "test failed", channel }, { status: 500 });
  }
}
