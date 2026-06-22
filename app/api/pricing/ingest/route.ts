import { NextRequest, NextResponse } from "next/server";
import { addProducts, clearLender, type PricingProduct } from "@/lib/pricing/compare";
import crypto from "crypto";

// AI rate-sheet ingestion. Upload a wholesaler's rate sheet (PDF/image) and
// Claude parses it into normalized pricing products. Built for a DAILY cadence:
// by default an upload REPLACES that lender's current sheet (clearLender first)
// so re-uploading every day swaps cleanly instead of stacking stale rows.
// For a multi-sheet lender, send replace=true on the first file and replace=false
// on the rest so they accumulate into one fresh set. Auth-gated via /api/pricing.
//   POST /api/pricing/ingest   FormData { lenderName, doc, replace? }
export const runtime = "nodejs";
export const maxDuration = 90;

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);

const SYSTEM = `You parse U.S. wholesale mortgage rate sheets into structured products. Return ONLY a JSON array. Each item:
{"productName": string, "loanType": "Conventional"|"FHA"|"VA"|"USDA"|"Jumbo"|"DSCR"|"NonQM"|"Other", "termMonths": number, "amortization": "Fixed"|"ARM",
 "noteRate": number (%), "pricePercent": number (price as % of par, e.g. 100.250; if the sheet shows points/cost convert: price = 100 - cost or 100 + rebate),
 "lockDays": number, "minFico": number, "maxLtv": number, "minLoanAmount": number, "maxLoanAmount": number, "minDscr": number,
 "occupancy": string[], "purpose": string[], "states": string[] (2-letter), "notes": string,
 "effectiveDate": string (the sheet's printed effective / "as of" date in ISO YYYY-MM-DD if shown; rate sheets are dated and often time-stamped — capture the date)}
Rules: capture one row per product/rate where you can read a rate and price. Pick the most representative lock period if several. Put the SAME effectiveDate on every row (it's the sheet's date). INCLUDE ONLY fields you can read; omit the rest. If it's not a rate sheet, return []. Never invent numbers.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Rate-sheet parsing needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const form = await req.formData();
    const lenderName = String(form.get("lenderName") || "").trim();
    const file = form.get("doc");
    const replace = String(form.get("replace") ?? "true") !== "false"; // default: replace this lender's sheet
    if (!lenderName) return NextResponse.json({ error: "Lender name required." }, { status: 400 });
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No rate sheet provided." }, { status: 400 });
    const mediaType = (file as any).type || "";
    if (!MEDIA.has(mediaType)) return NextResponse.json({ error: `Unsupported type ${mediaType}. Use PDF or an image.` }, { status: 415 });
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const block = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: [block, { type: "text", text: `Parse this ${lenderName} rate sheet into the product JSON array.` }] }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    let txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\[[\s\S]*\]/);
    let rows: any[] = [];
    try { rows = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't parse the rate sheet." }, { status: 422 }); }
    if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "No products found in that document." }, { status: 422 });

    const lenderId = lenderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = new Date().toISOString();
    const isoDate = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : undefined);
    const products: PricingProduct[] = rows.map((r) => ({
      id: crypto.randomUUID(), lenderId, lenderName, uploadedAt: now, effectiveDate: isoDate(r.effectiveDate),
      productName: r.productName || "Product", loanType: r.loanType, termMonths: r.termMonths, amortization: r.amortization,
      noteRate: typeof r.noteRate === "number" ? r.noteRate : undefined, pricePercent: typeof r.pricePercent === "number" ? r.pricePercent : undefined,
      lockDays: r.lockDays, minFico: r.minFico, maxLtv: r.maxLtv, minLoanAmount: r.minLoanAmount, maxLoanAmount: r.maxLoanAmount, minDscr: r.minDscr,
      occupancy: Array.isArray(r.occupancy) ? r.occupancy : undefined, purpose: Array.isArray(r.purpose) ? r.purpose : undefined, states: Array.isArray(r.states) ? r.states : undefined, notes: r.notes,
    })).filter((p) => p.noteRate !== undefined);

    if (!products.length) return NextResponse.json({ error: "Parsed the sheet but found no rate rows." }, { status: 422 });
    // Daily-refresh semantics: a fresh upload replaces this lender's prior sheet so
    // stale rows don't linger; replace=false lets multi-file sheets accumulate.
    if (replace) await clearLender(lenderId);
    await addProducts(products);
    return NextResponse.json({ ok: true, lenderId, added: products.length, replaced: replace, effectiveDate: products.find((p) => p.effectiveDate)?.effectiveDate });
  } catch (e: any) {
    console.error("[pricing/ingest] error:", e);
    return NextResponse.json({ error: e?.message || "Ingestion failed." }, { status: 500 });
  }
}
