// Auto content engine: generates ready-to-post social content — Reel scripts +
// captions + hashtags, plus an AI-generated image — for the Content Studio queue.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { BRAND_BRIEF } from "@/lib/brand";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type Post = { hook: string; script: string; caption: string; hashtags: string };

export async function generatePosts(n: number, topic = ""): Promise<Post[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const system = `${BRAND_BRIEF}
You write short-form video (Instagram Reels / TikTok) scripts for a mortgage broker.
Audience: home buyers (FHA/VA/first-time), real estate investors (DSCR, fix & flip), the self-employed.
Hooks must stop the scroll in 2 seconds. Punchy, concrete, compliant — never promise approval or rates.
Always drive to "link in bio." Output ONLY JSON: { "posts": [ { "hook", "script", "caption", "hashtags" } ] } with exactly ${n} posts.`;
  const user = topic ? `Theme: ${topic}. ${n} fresh posts.` : `${n} fresh, varied posts across buyers, investors, and self-employed.`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.9, max_tokens: 1200, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || "OpenAI error");
  const out = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  return Array.isArray(out.posts) ? out.posts.slice(0, n) : [];
}

const IMAGE_CONCEPTS = [
  "Bright modern single-family home exterior at golden hour, welcoming front porch, real estate photography, vibrant, NO text, no words, no letters",
  "Happy diverse young couple holding house keys in front of their new home, candid, warm natural light, NO text, no words",
  "Stylish modern rental apartment building, clear blue sky, professional real estate photo, NO text, no words",
  "Confident entrepreneur reviewing documents with a laptop at a bright modern desk, warm tone, NO text, no words",
  "Aerial view of a sunny suburban neighborhood with attractive homes, professional drone photo, NO text, no words",
  "Keys on a contract next to a small model house on a clean desk, soft daylight, NO text, no words",
];

// Generate an on-brand image (no text — caption carries the message) and store it
// in the public `content` bucket. Returns the public URL, or null on failure.
export async function generateImage(): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = IMAGE_CONCEPTS[Math.floor(Math.random() * IMAGE_CONCEPTS.length)];
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1, quality: "medium" }),
    });
    const j = await res.json();
    if (!res.ok) { console.warn("[content] image gen:", j?.error?.message); return null; }
    // gpt-image-1 returns base64; tolerate a url response too.
    const d = j.data?.[0] || {};
    const buf = d.b64_json ? Buffer.from(d.b64_json, "base64")
      : d.url ? Buffer.from(await (await fetch(d.url)).arrayBuffer()) : null;
    if (!buf) return null;
    const path = `auto/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
    const { error } = await supabaseAdmin.storage.from("content").upload(path, buf, { contentType: "image/png", upsert: false });
    if (error) { console.warn("[content] upload:", error.message); return null; }
    return supabaseAdmin.storage.from("content").getPublicUrl(path).data.publicUrl;
  } catch (e) { console.warn("[content] image error:", e); return null; }
}

// Produce a day's batch: a few Reel scripts + one image post. Returns rows ready
// to insert into content_posts (does not insert).
export async function generateBatch(topic = ""): Promise<Record<string, unknown>[]> {
  const posts = await generatePosts(4, topic);
  const today = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  posts.slice(0, 3).forEach((p) => rows.push({
    platform: "all", type: "reel", hook: p.hook, script: p.script, caption: p.caption, hashtags: p.hashtags,
    status: "queued", scheduled_for: today, source: "auto",
  }));
  const imgPost = posts[3] || posts[0];
  if (imgPost) {
    const image_url = await generateImage();
    rows.push({
      platform: "all", type: "image", hook: imgPost.hook, script: imgPost.script || "", caption: imgPost.caption,
      hashtags: imgPost.hashtags, image_url, status: "queued", scheduled_for: today, source: "auto",
    });
  }
  return rows;
}
