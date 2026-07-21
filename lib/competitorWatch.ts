// Competitor Watch shared core — LEGAL competitor social monitoring only.
// Extracted from app/api/competitors/route.ts so the daily cron and the
// dashboard route pull through ONE implementation. Uses Instagram's SANCTIONED
// business_discovery API (public aggregate metrics: follower count + recent
// posts with like/comment counts). Never enumerates followers/commenters,
// never scrapes.

export const IG_USER_ID = process.env.META_IG_USER_ID || "17841453773767353"; // Fetti's IG business account
export const CACHE_KEY = "COMPETITOR_WATCH_CACHE";
export const LIST_KEY = "COMPETITOR_WATCH";
export const HISTORY_KEY = "COMPETITOR_HISTORY";
export const WEEKLY_BRIEF_KEY = "COMPETITOR_WEEKLY_BRIEF";

export type Competitor = { name: string; ig: string; fbAdLibraryQuery: string };

// Default tracked set: national retail lenders + the DSCR/investor lenders Fetti
// actually competes with. Editable via POST /api/competitors (app_settings).
export const DEFAULT_COMPETITORS: Competitor[] = [
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

export type TopPost = { caption: string; likes: number; comments: number; engagement: number; at: string | null; url: string | null };

export async function discover(token: string, handle: string): Promise<
  { ok: true; followers: number | null; mediaCount: number | null; topPosts: TopPost[]; avgEngagement: number }
  | { ok: false; error: string; code?: number }
> {
  const fields = `business_discovery.username(${handle}){followers_count,media_count,media.limit(9){caption,like_count,comments_count,timestamp,permalink,media_url}}`;
  const r = await fetch(`https://graph.facebook.com/v23.0/${IG_USER_ID}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j?.error) {
    const code = j?.error?.code;
    return { ok: false, error: j?.error?.message || `HTTP ${r.status}`, code };
  }
  const bd = j?.business_discovery || {};
  const media: TopPost[] = (bd?.media?.data || []).map((m: any) => ({
    caption: (m?.caption || "").slice(0, 180),
    likes: m?.like_count ?? 0,
    comments: m?.comments_count ?? 0,
    engagement: (m?.like_count ?? 0) + 3 * (m?.comments_count ?? 0), // comments weigh heavier
    at: m?.timestamp || null,
    url: m?.permalink || null,
  })).sort((a: TopPost, b: TopPost) => b.engagement - a.engagement);
  const avgEngagement = media.length ? Math.round(media.reduce((s, m) => s + m.engagement, 0) / media.length) : 0;
  return { ok: true, followers: bd?.followers_count ?? null, mediaCount: bd?.media_count ?? null, topPosts: media.slice(0, 5), avgEngagement };
}

// One competitor's numbers on one day — the unit the tracker quantifies over time.
export type Snapshot = {
  date: string; // YYYY-MM-DD
  comps: Array<{
    ig: string; name: string;
    followers: number | null; mediaCount: number | null;
    avgEngagement: number;               // mean (likes + 3×comments) of last ≤9 posts
    engagementRate: number | null;       // avgEngagement / followers, 4dp
    topPost: { url: string | null; engagement: number; caption: string } | null;
  }>;
};
