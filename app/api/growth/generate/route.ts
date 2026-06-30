// Generate fresh, on-brand IG/TikTok Reel scripts on demand so the social engine
// never runs dry. Returns hook / script / caption / hashtags per post.
import { NextRequest, NextResponse } from "next/server";
import { BRAND_BRIEF } from "@/lib/brand";

export const dynamic = "force-dynamic";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  let topic = "";
  try { topic = (await req.json())?.topic || ""; } catch { /* optional */ }

  const system = `${BRAND_BRIEF}
You write short-form video (Instagram Reels / TikTok) scripts for a mortgage broker.
Audience: home buyers (FHA/VA/first-time), real estate investors (DSCR, fix & flip), and the
self-employed. Hooks must stop the scroll in the first 2 seconds. Be punchy, concrete, and
compliant — NEVER promise approval or specific rates. Always drive to "link in bio."
Output ONLY valid JSON: { "posts": [ { "hook": string, "script": string, "caption": string, "hashtags": string } ] } with exactly 5 posts.`;

  const user = topic ? `Theme to focus on: ${topic}. Generate 5 fresh posts.` : "Generate 5 fresh, varied posts across buyers, investors, and self-employed.";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, temperature: 0.9, max_tokens: 1100, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const j = await res.json();
    if (!res.ok) return NextResponse.json({ error: j?.error?.message || "OpenAI error" }, { status: 500 });
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    const posts = (Array.isArray(out.posts) ? out.posts.slice(0, 5) : []).map((p: any) => ({
      ...p, hashtags: Array.isArray(p.hashtags) ? p.hashtags.join(" ") : String(p.hashtags || ""),
    }));
    return NextResponse.json({ posts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
