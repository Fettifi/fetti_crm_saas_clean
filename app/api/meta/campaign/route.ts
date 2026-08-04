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

// SPEND IS OFF, AND IT STAYS OFF UNTIL RAMON TURNS IT ON.
//
// Ramon, 2026-08-03: "let's make sure we don't have ads being active anywhere. I don't wanna see
// any more bills or charges from Google, Meta, or anywhere else until we figure out how to get
// all this stuff working correctly."
//
// This route is the only thing in the codebase that can resume Meta spend or raise a budget —
// no cron and no AI tool reaches it, only a deliberate authenticated call. That is one mistaken
// call away from a bill. So activation and budget INCREASES are now refused outright unless
// ADS_SPEND_ENABLED is explicitly set to "true" in the environment, which it is not.
//
// PAUSING is deliberately still allowed with no flag: the kill switch must never need a key.
const spendUnlocked = () => String(process.env.ADS_SPEND_ENABLED || "").toLowerCase() === "true";

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const o = opts(req, true);
  const wantsSpend = o.activate === true || o.dailyBudgetCents != null;
  if (wantsSpend && !spendUnlocked()) {
    return NextResponse.json({
      error: "Ad spend is locked. Ramon paused all paid channels on 2026-08-02 and asked for no further charges. " +
             "Activating a campaign or setting a budget is refused while ADS_SPEND_ENABLED is not \"true\". " +
             "Pausing still works without it — the kill switch never needs a key.",
      locked: true, requested: { activate: o.activate, dailyBudgetCents: o.dailyBudgetCents },
    }, { status: 423 });
  }
  return NextResponse.json(await metaManageCampaign(o));
}
