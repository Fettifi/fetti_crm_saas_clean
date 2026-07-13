import { NextRequest, NextResponse } from "next/server";

// Creative Studio background generator — OpenAI gpt-image-1. Auth-gated via the
// /api/studio matcher. Returns a data URL the canvas composes the ad on top of.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { prompt, size, style } = await req.json();
    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json({ error: "Image generation isn't configured (OPENAI_API_KEY)." }, { status: 500 });
    const p = String(prompt || "").trim();
    if (!p) return NextResponse.json({ error: "Describe the image first." }, { status: 400 });
    const sz = ["1024x1024", "1024x1536", "1536x1024"].includes(size) ? size : "1024x1024";

    // Style-aware. Default is ORIGINAL BRANDED creative — NOT generic stock photography
    // (the old hardcoded "photorealistic mortgage photo" suffix was why everything looked
    // like dry AI stock). "mascot" features the Fetti owl character; "photo" for property shots.
    const MASCOT = "Featuring Mark, the Fetti Financial Services brand mascot — an original GOLDEN OWL (gold/amber/honey-gold feathers, his signature color, with emerald/slate accents), smart stylish glasses, intelligent and dignified ('knighthood' poise) yet effortlessly cool with relaxed California body-swagger. He is a REAL OWL: his arms are feathered WINGS — wings only, never human hands, arms, or fingers. When Mark holds, points at, or gestures toward anything, he does it with his feathered wingtips (never a human hand), and he stands on two bird feet. Bold modern vector illustration, thick clean outlines, flat vibrant colors, scroll-stopping and memorable. Refined and aspirational, NOT street/ghetto. Original character — do NOT imitate the Simpsons, Family Guy, the GEICO gecko, or any existing show/brand. Absolutely NO human hands, NO human arms, NO fingers or thumbs on Mark — wings only.";
    const STYLE: Record<string, string> = {
      mascot: MASCOT,
      photo: "Professional real-estate / mortgage marketing photograph, photorealistic, bright natural light, clean and aspirational, NO people's faces in focus.",
      brand: "Bold, original, scroll-stopping branded social creative for a modern California mortgage & investment-lending brand — vibrant, fresh, high-energy, distinctive. NOT generic stock photography, NOT a boring corporate look.",
    };
    const suffix = STYLE[String(style)] || STYLE.brand;
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: `${p}. ${suffix} NO text, NO logos, NO words, NO watermark.`,
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
