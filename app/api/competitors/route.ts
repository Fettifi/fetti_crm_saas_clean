// Competitor Watch — LEGAL competitor social monitoring only.
//
// What this does: for each tracked lender, pull PUBLIC aggregate metrics via
// Instagram's SANCTIONED business_discovery API (follower count + recent posts
// with like/comment COUNTS) so Fetti can see what content is working for the
// competition and out-engage it (comment as Fetti, make better content, outbid
// on the same topics).
//
// What this deliberately does NOT do (and never will): enumerate followers or
// commenter identities (no sanctioned API exposes them — scraping violates Meta
// ToS and contacting scraped people violates TCPA), read competitor FB Page
// feeds (needs Page Public Content Access we don't hold), or scrape any web UI.
//
// GET  ?refresh=1 → live pull (else 12h cache from app_settings)
// POST { competitors: [{name, ig, fbAdLibraryQuery}] } → update tracked list
import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, cfg } from "@/lib/settings";
import { claudeChat } from "@/lib/aiFallback";
import { markReplyViolates } from "@/lib/markCompliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IG_USER_ID = process.env.META_IG_USER_ID || "17841453773767353"; // Fetti's IG business account
const CACHE_KEY = "COMPETITOR_WATCH_CACHE";
const LIST_KEY = "COMPETITOR_WATCH";

// Default tracked set: national retail lenders + the DSCR/investor lenders Fetti
// actually competes with. Editable via POST (stored in app_settings).
const DEFAULTS = [
  { name: "Rocket Mortgage", ig: "rocketmortgage", fbAdLibraryQuery: "Rocket Mortgage" },
  { name: "UWM", ig: "uwmlending", fbAdLibraryQuery: "United Wholesale Mortgage" },
  { name: "loanDepot", ig: "loandepot", fbAdLibraryQuery: "loanDepot" },
  { name: "New American Funding", ig: "newamericanfunding", fbAdLibraryQuery: "New American Funding" },
  { name: "Rate (Guaranteed Rate)", ig: "rate", fbAdLibraryQuery: "Guaranteed Rate" },
  { name: "Better", ig: "betterdotcom", fbAdLibraryQuery: "Better Mortgage" },
  { name: "CrossCountry Mortgage", ig: "crosscountrymtg", fbAdLibraryQuery: "CrossCountry Mortgage" },
  { name: "Movement Mortgage", ig: "movementmortgage", fbAdLibraryQuery: "Movement Mortgage" },
  { name: "Kiavi (DSCR)", ig: "kiavifunding", fbAdLibraryQuery: "Kiavi" },
  { name: "Visio Lending (DSCR)", ig: "visiolending", fbAdLibraryQuery: "Visio Lending" },
  { name: "Lima One (investor)", ig: "limaonecapital", fbAdLibraryQuery: "Lima One Capital" },
];

type Competitor = { name: string; ig: string; fbAdLibraryQuery: string };

async function discover(token: string, handle: string) {
  const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(9){caption,like_count,comments_count,timestamp,permalink,media_url}}`;
  const r = await fetch(`https://graph.facebook.com/v23.0/${IG_USER_ID}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j?.error) {
    const code = j?.error?.code;
    return { ok: false as const, error: j?.error?.message || `HTTP ${r.status}`, code };
  }
  const bd = j?.business_discovery || {};
  const media = (bd?.media?.data || []).map((m: any) => ({
    caption: (m?.caption || "").slice(0, 180),
    likes: m?.like_count ?? 0,
    comments: m?.comments_count ?? 0,
    engagement: (m?.like_count ?? 0) + 3 * (m?.comments_count ?? 0), // comments weigh heavier
    at: m?.timestamp || null,
    url: m?.permalink || null,
  })).sort((a: any, b: any) => b.engagement - a.engagement);
  return { ok: true as const, followers: bd?.followers_count ?? null, mediaCount: bd?.media_count ?? null, topPosts: media.slice(0, 5) };
}

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const listRaw = await getSetting(LIST_KEY);
  let competitors: Competitor[] = DEFAULTS;
  try { if (listRaw) competitors = JSON.parse(listRaw); } catch { /* fall back to defaults */ }

  // 12h cache — business_discovery is rate-limited per IG user and this data
  // doesn't move fast enough to justify hammering it.
  if (!refresh) {
    const cached = await getSetting(CACHE_KEY);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (Date.now() - new Date(c.fetchedAt).getTime() < 12 * 3600_000) {
          return NextResponse.json({ ...c, competitors, cached: true });
        }
      } catch { /* refetch */ }
    }
  }

  const token = await cfg("META_USER_TOKEN");
  const results: any[] = [];
  let igBlocked: string | null = null;
  for (const c of competitors) {
    const adLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(c.fbAdLibraryQuery)}&media_type=all`;
    const igUrl = `https://www.instagram.com/${c.ig}/`;
    if (!token || igBlocked) {
      results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: null });
      continue;
    }
    const d = await discover(token, c.ig);
    if (!d.ok) {
      // (#10) = the app token lacks instagram_manage_insights — one permission
      // short. Stop burning calls; surface the exact gap once.
      if (d.code === 10) igBlocked = "Token lacks instagram_manage_insights — re-mint META_USER_TOKEN with that permission added and IG metrics light up.";
      results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: null, ig_error: d.error });
      continue;
    }
    results.push({ ...c, adLibraryUrl, igUrl, ig_metrics: { followers: d.followers, mediaCount: d.mediaCount, topPosts: d.topPosts } });
  }

  const payload = { fetchedAt: new Date().toISOString(), igBlocked, results };
  await setSetting(CACHE_KEY, JSON.stringify(payload));
  return NextResponse.json({ ...payload, competitors, cached: false });
}

// AUDIENCE CAPTURE, the legal way: draft a genuinely useful Fetti comment for a
// competitor's high-engagement post. Their audience sees Fetti being helpful (not
// pitching) → we earn our way into their feed + algorithm. Compliance-gated: a
// licensed lender's public comment must NEVER quote a rate/payment or promise
// approval. Ramon posts it himself (one click) — auto-posting at scale gets an
// account flagged as spam, which we deliberately avoid.
async function draftEngagement(competitor: string, caption: string): Promise<string | null> {
  const system = `You write short, warm, genuinely-helpful Instagram/Facebook comments AS Fetti (a licensed mortgage broker, NMLS #2267023). Goal: add real value to a home-buying/real-estate post so the audience notices Fetti as the helpful expert — NEVER a sales pitch, never spammy, never "DM us". Teach one useful thing in 1-2 sentences, friendly and human. HARD RULES: never state or imply a specific interest rate, monthly payment, or APR; never promise approval or "you'll qualify"; no guarantees. No hashtags. Sound like a sharp, generous human, not a brand bot.`;
  const user = `The post (by ${competitor}) says: "${(caption || "").slice(0, 400)}"\n\nWrite ONE comment (max ~200 characters) that teaches something useful and makes Fetti look like the expert worth following. Just the comment text.`;
  const raw = await claudeChat({ system, messages: [{ role: "user", content: user }], maxTokens: 160, timeoutMs: 20000 });
  if (!raw) return null;
  const text = raw.trim().replace(/^["']|["']$/g, "").slice(0, 280);
  if (markReplyViolates(text)) return null; // rate/approval slipped in → drop it
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Engagement action: draft compliant comments for the current hit-list posts.
    if (body?.action === "draft_engagement") {
      // Throttle: each draft run is up to 8 AI calls. One run per 30s ceilings the
      // token spend even if a session loops the button.
      const last = await getSetting("COMPETITOR_DRAFT_LAST");
      if (last && Date.now() - new Date(last).getTime() < 30_000) {
        return NextResponse.json({ error: "Give it a few seconds between draft runs." }, { status: 429 });
      }
      await setSetting("COMPETITOR_DRAFT_LAST", new Date().toISOString());
      const posts = Array.isArray(body.posts) ? body.posts.slice(0, 8) : [];
      const drafts = [];
      for (const p of posts) {
        const comment = await draftEngagement(p.who || "a lender", p.caption || "");
        drafts.push({ who: p.who, url: p.url, caption: (p.caption || "").slice(0, 120), comment: comment || "(couldn't draft a compliant comment — write your own)", ok: !!comment });
      }
      return NextResponse.json({ drafts });
    }

    const list = Array.isArray(body?.competitors) ? body.competitors : null;
    if (!list || list.some((c: any) => !c?.name || !c?.ig)) {
      return NextResponse.json({ error: "competitors must be [{name, ig, fbAdLibraryQuery}]" }, { status: 400 });
    }
    await setSetting(LIST_KEY, JSON.stringify(list.map((c: any) => ({
      name: String(c.name), ig: String(c.ig).replace(/^@/, ""), fbAdLibraryQuery: String(c.fbAdLibraryQuery || c.name),
    }))));
    await setSetting(CACHE_KEY, ""); // bust cache
    return NextResponse.json({ ok: true, count: list.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "bad request" }, { status: 400 });
  }
}
