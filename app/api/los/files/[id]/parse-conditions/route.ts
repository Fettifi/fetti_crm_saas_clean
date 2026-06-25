// Read a pre-approval letter / underwriting conditions / stip sheet (PDF or image)
// and SPLIT it into individual condition line items, each one ready to become a
// document request on the loan file. Claude (vision) does the reading — same engine
// as /api/los/extract. Returns the parsed items only (no DB writes); the LO reviews,
// assigns a recipient, and creates the requests from the UI. Auth-gated via /api/los.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

const SYSTEM = `You read U.S. mortgage PRE-APPROVAL letters and CONDITIONS / approval documents (underwriting conditions, prior-to-doc and prior-to-funding stips, condition sheets). Split the document into EACH individual condition or required item as its own line item — break numbered or bulleted lists into separate items; never merge two requirements into one.
Return ONLY valid JSON in this exact shape:
{"conditions":[{"title":"<the specific item needed, a clear concise request, <=160 chars>","category":"Income|Assets|Property|Credit|Identity|Title|Insurance|Disclosure|Other","recipient":"borrower|title|insurance|employer|appraiser|other"}]}
Rules: one object per distinct condition; preserve the underwriter's meaning but phrase it as a clear request (e.g. "Most recent 2 pay stubs covering 30 days"); recipient = who normally supplies it — MOST are "borrower"; homeowner's/hazard insurance binder -> "insurance"; title commitment / CPL / prelim -> "title"; verification of employment (VOE) -> "employer"; appraisal/value items -> "appraiser". If the document contains no conditions/requirements, return {"conditions":[]}. JSON only, no prose.`;

export async function POST(req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Reading documents needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    const file = form.get("doc");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No document provided." }, { status: 400 });
    const mediaType = (file as any).type || "application/octet-stream";
    if (!MEDIA.has(mediaType)) return NextResponse.json({ error: `Unsupported type ${mediaType}. Upload a PDF or an image.` }, { status: 415 });
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const block = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract every condition / required item as separate line items. JSON only." }] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    let txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    try { parsed = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read conditions from that document — try a clearer scan or a PDF." }, { status: 422 }); }

    const conditions = (Array.isArray(parsed.conditions) ? parsed.conditions : [])
      .map((c: any) => ({
        title: String(c?.title || "").trim().slice(0, 200),
        category: String(c?.category || "Other").trim().slice(0, 24),
        recipient: String(c?.recipient || "borrower").trim().toLowerCase(),
      }))
      .filter((c: any) => c.title);

    return NextResponse.json({ conditions });
  } catch (e: any) {
    console.error("[los/parse-conditions]", e);
    return NextResponse.json({ error: e?.message || "Failed to read the document." }, { status: 500 });
  }
}
