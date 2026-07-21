// Daily competitor tracker — the piece that turns Competitor Watch from a
// manual snapshot page into an actual TRACKER (Ramon 2026-07-21: "looking at
// their posts, followers, engagement to improve our system — or did that get
// lost?"). It had: no cron (stale since 7/10), no history (no quantification
// over time), no consumer (nothing fed our system). This closes all three:
//   1. refreshes COMPETITOR_WATCH_CACHE daily (the /competitors page stays live)
//   2. appends a dated snapshot to COMPETITOR_HISTORY (rolling ~6 months)
//   3. Mondays: computes movers + top posts, has the AI write a 5-line
//      "what's working for them → what we do about it" brief, emails the team,
//      and stores it (COMPETITOR_WEEKLY_BRIEF) for the content engine.
import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, cfg } from "@/lib/settings";
import { claudeChat } from "@/lib/aiFallback";
import {
  DEFAULT_COMPETITORS, discover, type Competitor, type Snapshot,
  CACHE_KEY, LIST_KEY, HISTORY_KEY, WEEKLY_BRIEF_KEY,
} from "@/lib/competitorWatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const listRaw = await getSetting(LIST_KEY);
  let competitors: Competitor[] = DEFAULT_COMPETITORS;
  try { if (listRaw) competitors = JSON.parse(listRaw); } catch { /* defaults */ }

  const token = await cfg("META_USER_TOKEN");
  if (!token) return NextResponse.json({ ok: false, reason: "META_USER_TOKEN missing" });

  const results: any[] = [];
  const snapComps: Snapshot["comps"] = [];
  let igBlocked: string | null = null;
  for (const c of competitors) {
    const adLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(c.fbAdLibraryQuery)}&media_type=all`;
    const igUrl = `https://www.instagram.com/${c.ig}/`;
    if (igBlocked) { results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: null }); continue; }
    const d = await discover(token, c.ig);
    if (!d.ok) {
      if (d.code === 10) igBlocked = "Token lacks instagram_manage_insights — re-mint META_USER_TOKEN with that permission added and IG metrics light up.";
      results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: null, ig_error: d.error });
      continue;
    }
    results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: { followers: d.followers, mediaCount: d.mediaCount, topPosts: d.topPosts } });
    snapComps.push({
      ig: c.ig, name: c.name, followers: d.followers, mediaCount: d.mediaCount,
      avgEngagement: d.avgEngagement,
      engagementRate: d.followers ? Number((d.avgEngagement / d.followers).toFixed(4)) : null,
      topPost: d.topPosts[0] ? { url: d.topPosts[0].url, engagement: d.topPosts[0].engagement, caption: d.topPosts[0].caption } : null,
    });
  }

  // Keep the dashboard cache fresh (same shape the /competitors page reads).
  await setSetting(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), igBlocked, results }));

  // Append today's snapshot (one per day — a same-day rerun overwrites).
  const today = new Date().toISOString().slice(0, 10);
  let history: Snapshot[] = [];
  try { history = JSON.parse((await getSetting(HISTORY_KEY)) || "[]"); } catch { /* fresh */ }
  history = history.filter((h) => h.date !== today);
  history.push({ date: today, comps: snapComps });
  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > 190) history = history.slice(-190); // ~6 months daily
  await setSetting(HISTORY_KEY, JSON.stringify(history));

  // Monday: weekly movers brief → email + stored for the content engine.
  let brief: string | null = null;
  if (new Date().getUTCDay() === 1 && snapComps.length) {
    try {
      const weekAgo = history.filter((h) => h.date <= new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)).pop();
      const movers = snapComps.map((c) => {
        const prev = weekAgo?.comps.find((p) => p.ig === c.ig);
        const dF = prev?.followers != null && c.followers != null ? c.followers - prev.followers : null;
        return `${c.name}: ${c.followers ?? "?"} followers${dF != null ? ` (${dF >= 0 ? "+" : ""}${dF}/wk)` : ""}, avg engagement ${c.avgEngagement}${c.engagementRate != null ? ` (${(c.engagementRate * 100).toFixed(2)}%)` : ""}`;
      }).join("\n");
      const tops = snapComps
        .filter((c) => c.topPost)
        .sort((a, b) => (b.topPost!.engagement) - (a.topPost!.engagement))
        .slice(0, 3)
        .map((c) => `${c.name} (${c.topPost!.engagement} eng): "${c.topPost!.caption.slice(0, 120)}" ${c.topPost!.url || ""}`)
        .join("\n");
      brief = await claudeChat({
        system: "You are Fetti's growth analyst. From competitor Instagram metrics, write a tight 5-line brief: (1) who's growing and why it matters, (2-3) the two content themes winning engagement this week, (4) ONE concrete content move Fetti should copy-but-better this week (Fetti = cool insightful owl mascot Mark, teach-don't-brochure), (5) one thing to ignore. Plain text, no headers, no hype.",
        messages: [{ role: "user", content: `Weekly numbers:\n${movers}\n\nTop competitor posts:\n${tops}` }],
        maxTokens: 400, timeoutMs: 30000,
      });
      if (brief) {
        await setSetting(WEEKLY_BRIEF_KEY, JSON.stringify({ at: new Date().toISOString(), brief, movers, tops }));
        const { notifyTeam } = await import("@/lib/notify/leadAlert");
        await notifyTeam("📊 Competitor Watch — weekly brief", `${brief}\n\n--- numbers ---\n${movers}\n\n--- top posts ---\n${tops}\n\nDashboard: ${process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com"}/competitors`);
      }
    } catch (e) { console.warn("[competitor-watch] weekly brief failed:", e); }
  }

  return NextResponse.json({
    ok: true, tracked: competitors.length, snapshotted: snapComps.length,
    igBlocked, historyDays: history.length, weeklyBrief: !!brief,
  });
}
