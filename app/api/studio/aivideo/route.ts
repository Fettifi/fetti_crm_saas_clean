// External AI-video generation hook — DORMANT until a provider key is added, then it
// produces a true AI-animated clip (image-to-video) from a scene image + motion prompt.
// GET  -> { available, provider }  (lets the Studio enable/disable the premium button)
// POST -> queues a generation if a key exists, else returns a clear "add a key" message.
// Add ONE of: FAL_KEY (fal.ai — proxies Kling/Veo/Pika/Luma), RUNWAY_API_KEY, REPLICATE_API_TOKEN.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function provider(): { name: string; key: string } | null {
  if (process.env.FAL_KEY) return { name: "fal", key: process.env.FAL_KEY };
  if (process.env.RUNWAY_API_KEY) return { name: "runway", key: process.env.RUNWAY_API_KEY };
  if (process.env.REPLICATE_API_TOKEN) return { name: "replicate", key: process.env.REPLICATE_API_TOKEN };
  return null;
}

export async function GET() {
  const p = provider();
  return NextResponse.json({ available: !!p, provider: p?.name || null });
}

export async function POST(req: NextRequest) {
  const p = provider();
  if (!p) {
    return NextResponse.json({
      available: false,
      error: "AI video is not enabled yet. Add an API key to turn it on: FAL_KEY (fal.ai — gives access to Kling, Google Veo, Pika, Luma), RUNWAY_API_KEY, or REPLICATE_API_TOKEN.",
    });
  }
  try {
    const b = await req.json().catch(() => ({}));
    const prompt = String(b?.prompt || "Animate this cartoon scene with gentle, lively motion; the character gestures naturally.").slice(0, 1000);
    const imageUrl = b?.imageUrl ? String(b.imageUrl) : undefined; // hosted scene image to bring to life
    if (p.name === "fal") {
      const model = "fal-ai/kling-video/v1/standard/image-to-video";
      const sub = await fetch(`https://queue.fal.run/${model}`, {
        method: "POST",
        headers: { Authorization: `Key ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image_url: imageUrl, duration: "5", aspect_ratio: "9:16" }),
      });
      const j = await sub.json().catch(() => ({}));
      if (!sub.ok) return NextResponse.json({ error: j?.detail || `fal submit failed (HTTP ${sub.status})` }, { status: 502 });
      return NextResponse.json({ provider: "fal", status: "queued", request_id: j.request_id, status_url: j.status_url, response_url: j.response_url });
    }
    return NextResponse.json({ error: `Provider ${p.name} detected but its integration isn't wired yet — tell me and I'll finish it.` }, { status: 501 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
