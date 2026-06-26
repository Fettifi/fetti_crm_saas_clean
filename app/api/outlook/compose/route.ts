import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { requireAddinAuth } from "@/lib/outlookAuth";
import { buildEmailSystem, type ComposeOptions, type EmailTone, TONE_PRESETS } from "@/lib/outlookEmail";

// Turns a rough (usually dictated) note into a polished professional email.
// Returns { subject, body }. Bearer-gated + rate-limited.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = process.env.OPENAI_EMAIL_MODEL || "gpt-4o";

export async function POST(req: NextRequest) {
  const denied = requireAddinAuth(req);
  if (denied) return denied;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "Email writing needs OPENAI_API_KEY." }, { status: 503 });

  const ip = clientIp(req);
  if (!(await rateLimit(`outlook:compose:${ip}`, 60, 60))) {
    return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
  }

  try {
    const b = await req.json().catch(() => ({} as any));
    const transcript = String(b?.transcript || b?.text || "").trim();
    if (!transcript) {
      return NextResponse.json({ error: "Nothing to write — dictate or type a note first." }, { status: 400 });
    }
    if (transcript.length > 8000) {
      return NextResponse.json({ error: "That note is too long — trim it down a bit." }, { status: 413 });
    }

    const tone: EmailTone = (b?.tone && TONE_PRESETS[b.tone as EmailTone]) ? (b.tone as EmailTone) : "professional";
    const opts: ComposeOptions = {
      tone,
      recipient: b?.recipient ? String(b.recipient).slice(0, 200) : undefined,
      sender: b?.sender ? String(b.sender).slice(0, 120) : undefined,
      signature: b?.signature ? String(b.signature).slice(0, 600) : undefined,
      context: b?.context ? String(b.context).slice(0, 6000) : undefined,
      isReply: !!b?.isReply,
      length: b?.length === "short" || b?.length === "long" ? b.length : "medium",
    };

    const system = buildEmailSystem(opts);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: transcript },
        ],
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      console.error("[outlook/compose] openai error:", j);
      return NextResponse.json({ error: j?.error?.message || "Writing failed." }, { status: 502 });
    }

    const content = j.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[outlook/compose] JSON parse failed on model content:", content.slice(0, 500));
      parsed = {};
    }
    const subject = String(parsed.subject || "").trim();
    const body = String(parsed.body || "").trim();
    if (!body) {
      console.error("[outlook/compose] empty/invalid body from model. keys:", Object.keys(parsed));
      return NextResponse.json({ error: "Couldn't compose that — try rephrasing your note." }, { status: 502 });
    }
    return NextResponse.json({ subject, body });
  } catch (e: any) {
    console.error("[outlook/compose] error:", e);
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
