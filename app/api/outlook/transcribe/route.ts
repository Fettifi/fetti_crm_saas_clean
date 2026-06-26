import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { requireAddinAuth } from "@/lib/outlookAuth";

// Speech-to-text for the Outlook add-in. The task pane records the mic and POSTs
// the audio blob here; we transcribe with OpenAI Whisper and return the text.
// Bearer-gated (see lib/outlookAuth) + rate-limited.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireAddinAuth(req);
  if (denied) return denied;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "Voice input needs OPENAI_API_KEY." }, { status: 503 });

  const ip = clientIp(req);
  if (!(await rateLimit(`outlook:transcribe:${ip}`, 60, 60))) {
    return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
  }

  try {
    const inForm = await req.formData();
    const file = inForm.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No audio provided." }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Recording too large (max 25 MB)." }, { status: 413 });
    }

    const out = new FormData();
    // Whisper infers the format from the filename extension. Chromium/WebView2
    // records webm; Safari/WKWebView (Outlook for Mac) records mp4 — honor the
    // name the client sent so both transcribe correctly.
    const base = String((file as any)?.name || "").split(/[/\\]/).pop() || "";
    const fname = /^[\w.-]+\.(webm|mp4|m4a|mp3|wav|ogg)$/i.test(base) ? base : "speech.webm";
    out.append("file", file, fname);
    out.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
    out.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("[outlook/transcribe] whisper error:", json);
      return NextResponse.json({ error: json?.error?.message || "Transcription failed." }, { status: 502 });
    }
    return NextResponse.json({ text: (json.text || "").trim() });
  } catch (e: any) {
    console.error("[outlook/transcribe] error:", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
