// Auto content engine: generates ready-to-post social content — Reel scripts +
// captions + hashtags, plus an AI-generated image — for the Content Studio queue.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { BRAND_BRIEF, CONTENT_PERSONALITY } from "@/lib/brand";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type Post = { hook: string; script: string; caption: string; hashtags: string };

export async function generatePosts(n: number, topic = ""): Promise<Post[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const system = `${BRAND_BRIEF}

${CONTENT_PERSONALITY}

OUTPUT FORMAT — return ONLY JSON: { "posts": [ { "hook", "script", "caption", "hashtags" } ] } with exactly ${n} posts.
- hook: the on-screen / first-line hook (<= 12 words) — the scroll-stopper
- script: a tight shot-by-shot / talking-points script for a 20–60s Reel (CNBC-meets-TikTok pacing)
- caption: a polished caption following HOOK → VALUE → CTA (2–5 short lines). Include the rotating CTA. NO disclosure text.
- hashtags: 5–8 high-intent hashtags (mix niche + broad)
Across the ${n} posts: hit DIFFERENT content pillars and ROTATE the CTA — no repeated CTA, no two posts that feel alike.`;
  const user = topic
    ? `Create ${n} posts on this theme: ${topic}. Each distinct, each passing the Fetti Content Test (≥4 of 5).`
    : `Create ${n} posts — each on a DIFFERENT content pillar (home buying, investing, wealth building, market intel, success stories). Distinct hooks, real teaching value, rotated CTAs, all passing the Fetti Content Test.`;
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

const IMAGE_CONCEPTS = [
  "Editorial real-estate photograph: a stunning modern luxury home exterior at golden hour, manicured landscaping, warm glowing windows, shot on a 35mm lens, magazine quality, cinematic, NO text, no words, no letters",
  "Candid lifestyle photo: a joyful diverse young couple laughing while holding house keys in front of their new home, natural sunlight, shallow depth of field, premium real-estate brand aesthetic, NO text, no words",
  "Architectural photograph of a sleek contemporary multi-unit rental building, blue-hour sky, clean lines, professional commercial real-estate photography, NO text, no words",
  "A confident, well-dressed entrepreneur reviewing plans on a tablet in a bright modern home office, warm natural light, aspirational, NO text, no words",
  "Cinematic aerial drone shot of an upscale sunny suburban neighborhood with beautiful homes and tree-lined streets, crisp and vibrant, NO text, no words",
  "Elegant flat-lay: brass house keys on a clean contract beside a small architectural model home and a cup of coffee, soft daylight, lifestyle brand photography, NO text, no words",
  "Warm interior photo of a beautifully staged modern living room with large windows and natural light, inviting and aspirational, real-estate magazine quality, NO text, no words",
  "A happy family with kids playing in the front yard of a charming home on a sunny day, candid and heartfelt, premium lifestyle photography, NO text, no words",
  "Premium fintech aesthetic: a sleek modern workspace with a laptop showing clean financial charts, minimalist desk, soft directional light, private-equity / fintech brand feeling, sophisticated and tech-forward, NO text, no words",
  "Luxury real-estate investment vibe: keys and a sleek black card resting on the marble countertop of a high-end modern kitchen, shallow depth of field, editorial, aspirational wealth-building aesthetic, NO text, no words",
  "A polished young investor in smart-casual attire standing confidently on the balcony of a modern high-rise overlooking a city skyline at dusk, cinematic, ambitious and premium, NO text, no words",
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
      // JPEG so the image is Instagram-compatible (IG Content Publishing rejects PNG).
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1, quality: "medium", output_format: "jpeg" }),
    });
    const j = await res.json();
    if (!res.ok) { console.warn("[content] image gen:", j?.error?.message); return null; }
    // gpt-image-1 returns base64; tolerate a url response too.
    const d = j.data?.[0] || {};
    const buf = d.b64_json ? Buffer.from(d.b64_json, "base64")
      : d.url ? Buffer.from(await (await fetch(d.url)).arrayBuffer()) : null;
    if (!buf) return null;
    const path = `auto/${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
    const { error } = await supabaseAdmin.storage.from("content").upload(path, buf, { contentType: "image/jpeg", upsert: false });
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
  // NOTE: every row must have the SAME keys (PostgREST bulk-insert rule), so
  // reel rows carry image_url: null too.
  posts.slice(0, 3).forEach((p) => rows.push({
    platform: "all", type: "reel", hook: p.hook, script: p.script, caption: p.caption, hashtags: p.hashtags,
    image_url: null, status: "queued", scheduled_for: today, source: "auto",
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
