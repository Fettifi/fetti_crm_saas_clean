import { NextRequest, NextResponse } from "next/server";

// Speech-to-text for Rupee. The browser records the mic and POSTs the audio
// blob here; we transcribe with OpenAI Whisper and return the text so it can be
// sent straight into the chat brain. Server-side fetch (no Cloudflare issues).
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "Voice input needs OPENAI_API_KEY." }, { status: 503 });

  try {
    const inForm = await req.formData();
    const file = inForm.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No audio provided." }, { status: 400 });
    }

    const out = new FormData();
    // Whisper infers format from the filename extension; webm is what the
    // browser MediaRecorder produces by default.
    out.append("file", file, "speech.webm");
    out.append("model", "whisper-1");
    out.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("[rupee/listen] whisper error:", json);
      return NextResponse.json({ error: json?.error?.message || "Transcription failed." }, { status: 502 });
    }
    return NextResponse.json({ text: (json.text || "").trim() });
  } catch (e: any) {
    console.error("[rupee/listen] error:", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
