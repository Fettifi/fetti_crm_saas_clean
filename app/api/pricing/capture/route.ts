import { NextRequest, NextResponse } from "next/server";
import { addProducts, clearLender, type PricingProduct } from "@/lib/pricing/compare";
import crypto from "crypto";

// Attended "capture from a portal" ingest. The broker runs a quote in their OWN
// logged-in portal session (e.g. UWM Easy Qualifier), copies the visible result,
// and pastes it here — Claude parses that text into structured products that land
// in the comparison engine, with the same daily-replace + freshness semantics as
// rate sheets. This is human-driven capture of the user's own on-screen data: no
// stored credentials, no autonomous scraping, nothing that touches bot-detection.
// Auth-gated via the /api/pricing matcher (used from inside the CRM, same-origin).
export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `You parse U.S. mortgage product & pricing into structured products. The input is TEXT pasted from a pricing-engine result or quick-qualifier screen (e.g. UWM Easy Qualifier, a Quick Pricer), or a rate sheet. Return ONLY a JSON array. Each item:
{"productName": string, "loanType": "Conventional"|"FHA"|"VA"|"USDA"|"Jumbo"|"DSCR"|"NonQM"|"Other", "termMonths": number, "amortization": "Fixed"|"ARM",
 "noteRate": number (%), "pricePercent": number (price as % of par, e.g. 100.250; if shown as points/cost convert: price = 100 - cost or 100 + rebate),
 "lockDays": number, "minFico": number, "maxLtv": number, "minLoanAmount": number, "maxLoanAmount": number, "minDscr": number,
 "occupancy": string[], "purpose": string[], "states": string[] (2-letter), "notes": string,
 "effectiveDate": string (ISO YYYY-MM-DD if a date/as-of is shown)}
Rules: capture one row per product/rate where you can read a rate and a price. Pick the most representative lock if several. Put the same effectiveDate on every row. INCLUDE ONLY fields you can read; omit the rest. If the text has no usable pricing, return []. Never invent numbers.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "Capture needs ANTHROPIC_API_KEY." }, { status: 503 });
  try {
    const b = await req.json().catch(() => ({}));
    const lenderName = String(b.lenderName || "").trim();
    const text = String(b.text || "").trim().slice(0, 120000);
    const replace = b.replace !== false;
    if (!lenderName) return NextResponse.json({ error: "Lender name required." }, { status: 400 });
    if (text.length < 10) return NextResponse.json({ error: "Paste the pricing result first." }, { status: 400 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: 4000, system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: `Parse this ${lenderName} pricing result into the product JSON array:\n\n${text}` }] }],
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
    let txt = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\[[\s\S]*\]/);
    let rows: any[] = [];
    try { rows = JSON.parse(m ? m[0] : txt); } catch { return NextResponse.json({ error: "Couldn't read pricing from that text." }, { status: 422 }); }
    if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "No pricing found in the pasted text." }, { status: 422 });

    const lenderId = lenderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const now = new Date().toISOString();
    const isoDate = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : undefined);
    const num = (v: any) => (typeof v === "number" ? v : v != null && isFinite(Number(v)) ? Number(v) : undefined);
    const products: PricingProduct[] = rows.map((r) => ({
      id: crypto.randomUUID(), lenderId, lenderName, uploadedAt: now, effectiveDate: isoDate(r.effectiveDate),
      productName: r.productName || "Product", loanType: r.loanType, termMonths: num(r.termMonths), amortization: r.amortization,
      noteRate: num(r.noteRate), pricePercent: num(r.pricePercent), lockDays: num(r.lockDays),
      minFico: num(r.minFico), maxLtv: num(r.maxLtv), minLoanAmount: num(r.minLoanAmount), maxLoanAmount: num(r.maxLoanAmount), minDscr: num(r.minDscr),
      occupancy: Array.isArray(r.occupancy) ? r.occupancy : undefined, purpose: Array.isArray(r.purpose) ? r.purpose : undefined,
      states: Array.isArray(r.states) ? r.states : undefined, notes: r.notes ? `${r.notes} · captured from portal` : "captured from portal",
    })).filter((p) => p.noteRate !== undefined);

    if (!products.length) return NextResponse.json({ error: "Parsed the text but found no rate rows." }, { status: 422 });
    if (replace) await clearLender(lenderId);
    await addProducts(products);
    return NextResponse.json({ ok: true, lenderId, added: products.length, replaced: replace });
  } catch (e: any) {
    console.error("[pricing/capture] error:", e?.message);
    return NextResponse.json({ error: e?.message || "Capture failed." }, { status: 500 });
  }
}
