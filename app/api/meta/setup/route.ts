import { NextRequest, NextResponse } from "next/server";
import { subscribeAppToLeadgen, subscribePageToLeadgen, selfTestWebhook, metaLeadgenReadiness, healMetaToken, ingestUserToken } from "@/lib/metaHeal";
import { ensurePixel, sendMetaLeadEvent } from "@/lib/metaCapi";

// One-shot Meta wiring + diagnostics. Subscribes the APP to the `leadgen` webhook
// (the manual App-dashboard step), self-heals the token, and reports EXACTLY how
// ready the pipeline is to receive real Facebook Lead Ads. Idempotent — safe to
// call repeatedly. Gated by CRON_SECRET (this route is public/unsession-gated like
// the rest of /api/meta, so it authenticates by secret instead).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  const h = req.headers.get("authorization") || "";
  return h === `Bearer ${sec}`;
}

async function run(test: boolean, userToken?: string, capitest?: boolean) {
  // If a fresh user token is supplied, ingest it first: exchange → mint+store the
  // Page token → subscribe the Page (and app) to leadgen. This is what flips on the
  // pages_manage_metadata-gated Page subscription.
  const connect = userToken ? await ingestUserToken(userToken) : undefined;
  const heal = await healMetaToken();
  const appSubscribe = await subscribeAppToLeadgen();
  const pageSubscribe = await subscribePageToLeadgen();
  const pixel = await ensurePixel();
  const capiTest = capitest
    ? await sendMetaLeadEvent({ id: "capi-selftest-" + Date.now(), email: "capitest@fetti.test", phone: "5555550123", full_name: "CAPI Selftest", state: "CA", source: "capitest", loan_purpose: "Mortgage inquiry", raw: {} })
    : undefined;
  const selfTest = test ? await selfTestWebhook() : undefined;
  const readiness = await metaLeadgenReadiness();
  return { connect, heal, appSubscribe, pageSubscribe, pixel, capiTest, selfTest, readiness };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const userToken = typeof body?.userToken === "string" && body.userToken.trim() ? body.userToken.trim() : undefined;
  return NextResponse.json(await run(req.nextUrl.searchParams.get("test") === "1", userToken, req.nextUrl.searchParams.get("capitest") === "1"));
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run(req.nextUrl.searchParams.get("test") === "1", undefined, req.nextUrl.searchParams.get("capitest") === "1"));
}
