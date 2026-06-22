import { NextRequest, NextResponse } from "next/server";
import { addProducts, clearLender, type PricingProduct } from "@/lib/pricing/compare";
import { cfg } from "@/lib/settings";
import crypto from "crypto";

// Machine-to-machine pricing feed. A sanctioned source you control — LUPA /
// Co-worq's lender pull, or a PPE/lender API you get access to — POSTs pricing
// here and it lands in the comparison engine + the "Price a deal" screen, with
// the same daily-replace + freshness semantics as rate sheets. This route only
// RECEIVES structured data (or raw text it AI-parses); it never logs into or
// scrapes anything. Token-authed so an external system can call it without a
// login session. Fails closed when no token is configured.
//
//   POST /api/pricing/feed
//   Authorization: Bearer <PRICING_FEED_TOKEN>
//   { "lenderName": "UWM", "replace": true, "effectiveDate": "2026-06-15",
//     "products": [ { "productName": "...", "loanType": "Conventional", "termMonths": 360,
//                     "noteRate": 6.5, "pricePercent": 100.25, "lockDays": 30,
//                     "minFico": 700, "maxLtv": 95, "occupancy": ["PrimaryResidence"],
//                     "purpose": ["Purchase"], "states": ["CA"] }, ... ] }
//   — OR — send { "lenderName": "...", "text": "<raw pricing the puller captured>" } and the CRM parses it.
export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `You parse U.S. mortgage product & pricing text into structured products. Return ONLY a JSON array. Each item:
{"productName": string, "loanType": "Conventional"|"FHA"|"VA"|"USDA"|"Jumbo"|"DSCR"|"NonQM"|"Other", "termMonths": number, "amortization": "Fixed"|"ARM",
 "noteRate": number (%), "pricePercent": number (price as % of par; if points/cost: price = 100 - cost or 100 + rebate),
 "lockDays": number, "minFico": number, "maxLtv": number, "minLoanAmount": number, "maxLoanAmount": number, "minDscr": number,
 "occupancy": string[], "purpose": string[], "states": string[] (2-letter), "notes": string, "effectiveDate": string (ISO YYYY-MM-DD if shown)}
Capture one row per product/rate with a readable rate and price. Include only fields you can read. If none, return []. Never invent numbers.`;

function tokenOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function parseText(text: string, lenderName: string): Promise<any[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("text parsing needs ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: `Parse this ${lenderName} pricing into the product JSON array:\n\n${text.slice(0, 120000)}` }] }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  let txt = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\[[\s\S]*\]/);
  try { const a = JSON.parse(m ? m[0] : txt); return Array.isArray(a) ? a : []; } catch { return []; }
}

export async function POST(req: NextRequest) {
  const expected = await cfg("PRICING_FEED_TOKEN");
  if (!expected) return NextResponse.json({ error: "Feed not configured (set PRICING_FEED_TOKEN)." }, { status: 503 });
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !tokenOk(token, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const b = await req.json().catch(() => ({}));
    const lenderName = String(b.lenderName || "").trim();
    if (!lenderName) return NextResponse.json({ error: "lenderName required" }, { status: 400 });
    const replace = b.replace !== false;

    let rows: any[] = Array.isArray(b.products) ? b.products : [];
    if (!rows.length && typeof b.text === "string" && b.text.trim().length >= 10) rows = await parseText(b.text, lenderName);
    if (!rows.length) return NextResponse.json({ error: "no products (send a products[] array or text)" }, { status: 400 });

    const lenderId = lenderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = new Date().toISOString();
    const isoDate = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : undefined);
    const feedDate = isoDate(b.effectiveDate);
    const numOf = (v: any) => (typeof v === "number" ? v : v != null && isFinite(Number(v)) ? Number(v) : undefined);
    const products: PricingProduct[] = rows.map((r: any) => ({
      id: crypto.randomUUID(), lenderId, lenderName, uploadedAt: now, effectiveDate: isoDate(r.effectiveDate) || feedDate,
      productName: String(r.productName || "Product"), loanType: r.loanType, termMonths: numOf(r.termMonths), amortization: r.amortization,
      noteRate: numOf(r.noteRate), pricePercent: numOf(r.pricePercent), lockDays: numOf(r.lockDays),
      minFico: numOf(r.minFico), maxLtv: numOf(r.maxLtv), minLoanAmount: numOf(r.minLoanAmount), maxLoanAmount: numOf(r.maxLoanAmount), minDscr: numOf(r.minDscr),
      occupancy: Array.isArray(r.occupancy) ? r.occupancy : undefined, purpose: Array.isArray(r.purpose) ? r.purpose : undefined,
      states: Array.isArray(r.states) ? r.states : undefined, notes: r.notes ? `${r.notes} · via feed` : "via feed",
    })).filter((p) => p.noteRate !== undefined);

    if (!products.length) return NextResponse.json({ error: "no rows with a noteRate" }, { status: 422 });
    if (replace) await clearLender(lenderId);
    await addProducts(products);
    return NextResponse.json({ ok: true, lenderId, added: products.length, replaced: replace });
  } catch (e: any) {
    console.error("[pricing/feed] error:", e?.message);
    return NextResponse.json({ error: e?.message || "feed failed" }, { status: 500 });
  }
}
