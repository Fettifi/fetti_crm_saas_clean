import { NextRequest, NextResponse } from "next/server";
import { metaManageCampaign } from "@/lib/metaHeal";

// Inspect or re-activate a Meta ad campaign (campaign + ad sets + ads). Re-activating
// RESUMES AD SPEND, so it only happens with ?activate=1. Gated by CRON_SECRET.
//   GET  ?campaign=<name|id>&account=<act_...>          -> inspect only (read-only)
//   POST ?campaign=<name|id>&account=<act_...>&activate=1 -> set the whole tree ACTIVE
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authed(req: NextRequest): boolean {
  const sec = process.env.CRON_SECRET;
  if (!sec) return false;
  // Accept the shared secret ONLY via the Authorization header. The prior
  // `?secret=` query-string path leaked CRON_SECRET into access logs, proxy
  // logs, browser history and Referer headers -- and this route MUTATES ad
  // budgets / resumes spend, so a leaked secret is spend-control. Header only.
  const h = req.headers.get("authorization") || "";
  return h === `Bearer ${sec}`;
}

function opts(req: NextRequest, write: boolean) {
  const sp = req.nextUrl.searchParams;
  const pause = write && sp.get("pause") === "1";
  const budgetUsd = parseFloat(sp.get("budget") || "");
  return {
    account: sp.get("account") || undefined,
    nameOrId: sp.get("campaign") || undefined,
    activate: write && !pause && sp.get("activate") === "1",
    status: pause ? ("PAUSED" as const) : undefined,
    dailyBudgetCents: write && budgetUsd > 0 ? Math.round(budgetUsd * 100) : undefined,
  };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaManageCampaign(opts(req, false)));
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await metaManageCampaign(opts(req, true)));
}
