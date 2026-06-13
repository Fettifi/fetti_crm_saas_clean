import { NextRequest, NextResponse } from "next/server";

// Creative Studio background generator — OpenAI gpt-image-1. Auth-gated via the
// /api/studio matcher. Returns a data URL the canvas composes the ad on top of.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { prompt, size } = await req.json();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "Image generation isn't configured (OPENAI_API_KEY)." }, { status: 500 });
    const p = String(prompt || "").trim();
    if (!p) return NextResponse.json({ error: "Describe the image first." }, { status: 400 });
    const sz = ["1024x1024", "1024x1536", "1536x1024"].includes(size) ? size : "1024x1024";
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: `${p}. Professional real-estate / mortgage marketing photograph, photorealistic, bright natural light, clean and aspirational. NO text, NO logos, NO words, NO watermark, NO people's faces in focus.`,
        size: sz, n: 1,
      }),
    });
    const j = await r.json();
    if (!r.ok) return NextResponse.json({ error: j?.error?.message || "Generation failed." }, { status: 500 });
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "No image returned." }, { status: 500 });
    return NextResponse.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
