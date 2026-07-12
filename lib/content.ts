// Auto content engine — THE SOCIAL DESK OF THE RAY & MARK WRITERS' ROOM.
// (2026-07-12, Ramon: "no more stock images — everything from OUR engine and OUR
// writers, on message, driving people to watch the videos.") Daily posts are
// written in-canon alongside what the show is producing, visuals come ONLY from
// our own character art (kit scenes in the content/brand-kit bucket — never a
// generated/stock image), and published episodes auto-queue as real Reels so the
// show itself is what spreads.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { BRAND_BRIEF, CONTENT_PERSONALITY, CEDI_PERSONA } from "@/lib/brand";
import { SHOW, RAY, MARK } from "@/lib/show/showBible";
import { getSetting } from "@/lib/settings";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Latest writers'-room episodes (SHOW_EPISODES app_setting) — the daily posts
// are written ALONGSIDE what the show is producing, in the same canon.
type ShowEp = { id?: string; number?: number; title?: string; logline?: string; video?: string; video_at?: string };
async function latestEpisodes(n = 3): Promise<ShowEp[]> {
  try {
    const eps = JSON.parse((await getSetting("SHOW_EPISODES")) || "[]");
    return (Array.isArray(eps) ? eps : []).slice(-n).reverse();
  } catch { return []; }
}

export type Post = { hook: string; script: string; caption: string; hashtags: string };

export async function generatePosts(n: number, topic = ""): Promise<Post[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const eps = await latestEpisodes(3);
  const epContext = eps.length
    ? `THE SHOW (your primary source material — you are the SOCIAL DESK of this writers' room):
"${SHOW.title || "Ray & Mark — We Do Money"}" — Ray (${RAY.role || "Fetti's founder, the brains"}) and Mark (${MARK.role || "the owl co-host who brings the scenario"}) break down real lending deals.
CURRENT EPISODES (tie AT LEAST HALF the posts to these themes — tease the lesson, make people want to WATCH):
${eps.map((e) => `• EP${e.number}: "${e.title}"${e.logline ? ` — ${e.logline}` : ""}${e.video ? " (VIDEO IS LIVE — drive viewers to it)" : " (in production)"}`).join("\n")}
The videos are the viral vector: posts exist to make people watch Ray & Mark, and watching converts them.`
    : "";

  const system = `${BRAND_BRIEF}

${CONTENT_PERSONALITY}

${CEDI_PERSONA}

${epContext}

CRITICAL — VOICE: Write EVERY post in Mark's first-person voice — Fetti's GOLDEN OWL mascot. Mark is
California-fresh and smooth with confident SWAGGER: intelligent, sharp, effortlessly cool, and he tells
you what he KNOWS, not what he thinks (he's done this before). Dignified and aspirational — knighthood,
not street/hood — never loud. Light, tasteful owl wordplay ("eyes open", "wise move", "we do money")
used sparingly; the real teaching value must land. Stay fully compliant (no rate or approval promises).
FRESHNESS: every post must feel CURRENT and specific — a real scenario, a real mechanic, a lesson from
the show — never a recycled platitude. Educational, informative, entertaining: teach like the show does.

CONTENT STRATEGY — EDUCATION FIRST, THEN BLEND THE STORY: Open every post by TEACHING something genuinely
useful and TRUE — a real finance or mortgage fact/insight (how DSCR qualifies on rent, what actually moves
your rate, how equity compounds, the rent-vs-buy math, credit factors, money principles). Deliver the value
first. THEN blend in Fetti's role and why Ramon Dent built it (the mission to do money the right way) as the
natural bridge into the CTA. Education earns the trust; the story earns the call. Facts must be accurate and
evergreen — NEVER invent statistics, rates, awards, or testimonials.

OUTPUT FORMAT — return ONLY JSON: { "posts": [ { "hook", "script", "caption", "hashtags" } ] } with exactly ${n} posts.
- hook: the on-screen / first-line hook (<= 12 words) — the scroll-stopper
- script: a tight shot-by-shot / talking-points script for a 20–60s Reel (CNBC-meets-TikTok pacing)
- caption: THE CAPTION IS HALF THE POST — treat it as seriously as the video. Structure: (1) a HOOK line that reframes something the reader assumed ("Most people think X — here's why that costs them"); (2) 1–2 lines of REAL, specific value/insight (a number, a mechanic, a name for the trap); (3) a genuine THOUGHT-PROVOKING QUESTION that invites a real answer in the comments (drives the algorithm) — never a yes/no, never rhetorical; (4) a natural CTA. 3–6 short lines, line breaks between ideas. Descriptive and specific, never vague platitudes. Refer to the brand in full as "Fetti Financial Services" (never just "Fetti Financial"). NO disclosure text (appended at publish).
- hashtags: 6–9 high-intent hashtags (mix niche + broad); ALWAYS include #fettifinancialservices and #wedomoney for brand uniformity
Across the ${n} posts: hit DIFFERENT content pillars and ROTATE the CTA — no repeated CTA, no two posts that feel alike.

PLATFORM-SAFETY RULES (2026-07-12 — the Fetti IG was restricted under Meta's fraud/scam
classifier; these are HARD rules so brand content never pattern-matches money-scam accounts):
- NEVER use "DM me <keyword>" / "Comment <keyword>" bait CTAs — that's the signature move of
  money-flipping scam accounts. CTAs are plain and verifiable: "book a call", "start your
  application on our site", "talk to a licensed broker".
- NEVER use hype-money vocabulary: "secret", "hidden money", "unlock wealth", "hack",
  "guaranteed", "fast cash", "get rich", "double your". Teach like a fiduciary, not a hustler.
- No urgency-pressure framing ("act now before it's gone").
- Frame Fetti as what it is: a LICENSED mortgage brokerage (never imply investment advice).`;
  const user = topic
    ? `Create ${n} posts on this theme: ${topic}. Each distinct, each passing the Fetti Content Test (≥4 of 5).`
    : `Create ${n} posts, EDUCATION-FIRST. Each OPENS with a real, useful finance/mortgage fact or insight — rotate the teaching pillar: home-buying know-how, DSCR & investment-loan basics, credit & how you qualify, building equity & wealth, rent-vs-buy math, market intel, core money principles. Deliver genuine value, THEN blend in Fetti / why Ramon Dent built it / the mission as the bridge to a rotated CTA. Distinct hooks, all TRUE, accurate, and compliant — never invent stats, rates, awards, or testimonials. Each passes the Fetti Content Test.`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.9, max_tokens: 1200, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || "OpenAI error");
  const out = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  const posts = Array.isArray(out.posts) ? out.posts.slice(0, n) : [];
  // Normalize hashtags to a clean space-separated string (models sometimes return an array).
  return posts.map((p: any) => ({
    ...p,
    hashtags: Array.isArray(p.hashtags) ? p.hashtags.join(" ") : String(p.hashtags || ""),
    caption: String(p.caption || ""), hook: String(p.hook || ""), script: String(p.script || ""),
  }));
}

// CUSTOM VISUALS ONLY (no generated/stock images, ever): image posts use OUR
// character scenes — the Ray & Mark brand art the studio uploaded to
// content/brand-kit/. Each day rotates a scene, center-cropped to IG's 4:5 feed
// ratio, re-encoded JPEG (IG Content Publishing rejects PNG), stored per-post.
const BRAND_SCENES = ["bg-clean.png", "bg-ray.png", "bg-mark.png", "bg-ai.png"];
export async function composeBrandCard(): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const pick = BRAND_SCENES[new Date().getUTCDate() % BRAND_SCENES.length]; // daily rotation
    const src = supabaseAdmin.storage.from("content").getPublicUrl(`brand-kit/${pick}`).data.publicUrl;
    const raw = Buffer.from(await (await fetch(src)).arrayBuffer());
    const meta = await sharp(raw).metadata();
    const W = meta.width || 1080, H = meta.height || 1920;
    // 4:5 portrait crop biased toward the characters (lower-middle of the scene).
    const targetH = Math.min(H, Math.round(W * 1.25));
    const top = Math.max(0, Math.min(H - targetH, Math.round(H * 0.28)));
    const buf = await sharp(raw).extract({ left: 0, top, width: W, height: targetH })
      .resize(1080, 1350).jpeg({ quality: 90 }).toBuffer();
    const path = `auto/${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    const { error } = await supabaseAdmin.storage.from("content").upload(path, buf, { contentType: "image/jpeg", upsert: false });
    if (error) { console.warn("[content] card upload:", error.message); return null; }
    return supabaseAdmin.storage.from("content").getPublicUrl(path).data.publicUrl;
  } catch (e) { console.warn("[content] brand card error:", e); return null; }
}

// Produce a day's batch: Reel scripts + one brand-art image post + (when a new
// episode video is live) the EPISODE ITSELF queued as a real Reel. Returns rows
// ready to insert into content_posts (does not insert).
export async function generateBatch(topic = ""): Promise<Record<string, unknown>[]> {
  const posts = await generatePosts(6, topic);
  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  // NOTE: every row must have the SAME keys (PostgREST bulk-insert rule), so
  // reel rows carry image_url: null too.
  posts.slice(0, 3).forEach((p) => rows.push({
    platform: "all", type: "reel", hook: p.hook, script: p.script, caption: p.caption, hashtags: p.hashtags,
    image_url: null, status: "queued", scheduled_for: today, source: "auto",
  }));
  const imgPost = posts[3] || posts[0];
  if (imgPost) {
    const image_url = await composeBrandCard();
    rows.push({
      platform: "all", type: "image", hook: imgPost.hook, script: imgPost.script || "", caption: imgPost.caption,
      hashtags: imgPost.hashtags, image_url, status: "queued", scheduled_for: today, source: "auto",
    });
  }

  // EPISODE → REEL: a published show video that hasn't hit social yet queues as a
  // real video post (type reel_video; image_url carries the MP4 URL — the table
  // has no video column and DDL isn't reachable, so the type field disambiguates).
  // The cron's picker prefers these: the show itself is the viral vector.
  try {
    const eps = await latestEpisodes(5);
    for (const ep of eps) {
      if (!ep.video || !ep.id) continue;
      const src = `show-ep-${ep.id}`;
      const { data: seen } = await supabaseAdmin.from("content_posts").select("id").eq("source", src).limit(1).maybeSingle();
      if (seen) continue;
      rows.push({
        platform: "all", type: "reel_video",
        hook: `EP${ep.number}: ${ep.title}`,
        script: "",
        caption: `${ep.logline ? ep.logline.trim() + "\n\n" : ""}Ray & Mark break down "${ep.title}" — a real scenario, real numbers, in about a minute. 🦉 Educational, never a sales pitch. Stay to the end for the part almost everyone misses.\n\nHere's the question worth sitting with: what would YOU have done? Tell us below 👇`,
        hashtags: "#mortgage #realestate #homebuying #firsttimehomebuyer #investing #raymark #fettifinancialservices #wedomoney",
        image_url: ep.video, status: "queued", scheduled_for: today, source: src,
      });
      break; // one episode per day max
    }
  } catch (e) { console.warn("[content] episode reel queue:", e); }
  return rows;
}
