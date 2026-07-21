// UNDERWRITING DESK — single-property underwriting API. One POST, action-switched:
//  underwrite  → geocode + Census ACS market + ZIP tax/insurance + county-treasurer tax
//                link + AI-read of the uploaded TitlePro/assessor profile + computed
//                metrics + lender-matched underwriting synthesis. All in one call.
//  pdf         → branded underwriting-summary PDF of a returned underwrite.
//  create-file → spin up a lead + LOS loan file from the deal (attach the docs), so the
//                LO continues in the LOS (title order, submit, price, e-sign already there).
// No TitlePro/AVM vendor API exists — the profile you pull is read instantly by AI. Auth
// is enforced by proxy.ts (the /api/underwriter-desk prefix). Reuses the pricer + income
// calculators and the same Anthropic vision pattern as verify-income.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { getSetting } from "@/lib/settings";
import { verifyAddress } from "@/lib/address";
import { resolveLocation } from "@/lib/propertyData";
import { getLenders } from "@/lib/pricing/lenders";
import { taxLookupFor } from "@/lib/underwrite/taxLinks";
import { createLoanFileFromLead } from "@/lib/los";
import { computeDeskMetrics, LOAN_BOX, TITLE_SYSTEM, UNDERWRITE_SYSTEM, type DeskInput, type DeskLoanType } from "@/lib/underwritingDesk";
import { buildUnderwritingDeskPdf } from "@/lib/underwritingDeskPdf";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const BUCKET = "loan-docs";
const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const ACS_VARS = "B19013_001E,B25077_001E,B25064_001E"; // median income, home value, gross rent

const numOr = (v: any, d = 0): number => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : d; };
const str = (v: any, max = 200): string => String(v ?? "").trim().slice(0, max);

function sanitizeInput(b: any): DeskInput {
  const lt = String(b?.loanType || "dscr") as DeskLoanType;
  return {
    address: str(b?.address), city: str(b?.city, 80), state: str(b?.state, 2).toUpperCase(), zip: str(b?.zip, 10).replace(/[^0-9]/g, "").slice(0, 5),
    borrower: str(b?.borrower, 120),
    loanType: (LOAN_BOX[lt] ? lt : "dscr"),
    loanPurpose: (["Purchase", "Refinance", "CashOutRefinance"].includes(b?.loanPurpose) ? b.loanPurpose : undefined),
    lienPosition: Number(b?.lienPosition) === 2 ? 2 : 1,
    loanAmount: numOr(b?.loanAmount), asIsValue: numOr(b?.asIsValue), arv: numOr(b?.arv) || undefined,
    existingLiens: numOr(b?.existingLiens) || undefined, rehabBudget: numOr(b?.rehabBudget) || undefined,
    monthlyRent: numOr(b?.monthlyRent) || undefined,
    propertyType: str(b?.propertyType, 40), occupancy: (["investment", "owner", "second_home"].includes(b?.occupancy) ? b.occupancy : "investment"),
    fico: numOr(b?.fico) || undefined, ratePct: numOr(b?.ratePct) || undefined, termYears: numOr(b?.termYears) || undefined,
    hoaMonthly: numOr(b?.hoaMonthly) || undefined, taxRatePct: numOr(b?.taxRatePct) || undefined, insRatePct: numOr(b?.insRatePct) || undefined,
    targetDscr: numOr(b?.targetDscr) || undefined,
  };
}

// Desk loan type → URLA loanType (MISMO). DSCR / hard money / bridge / flip / commercial /
// 2nd are all non-agency "Other" (Non-QM); conventional & FHA map straight across.
const LOANTYPE_URLA: Record<DeskLoanType, string> = {
  dscr: "Other", fixflip: "Other", bridge: "Other", hardmoney: "Other",
  commercial: "Other", conventional: "Conventional", fha: "FHA", second: "Other",
};
const OCC_URLA: Record<string, string> = { investment: "Investment", owner: "PrimaryResidence", second_home: "SecondHome" };

// Human product label for the LOS file (drives the cockpit product line + the doc-checklist
// / compliance routing in lib/los). Includes the purpose word so a refi/cash-out isn't
// asked for a purchase contract, and flags 2nd position.
function deskProductLabel(input: DeskInput, purpose: string): string {
  const box = LOAN_BOX[input.loanType];
  const purposeWord = purpose === "Refinance" ? "Refinance" : purpose === "CashOutRefinance" ? "Cash-Out Refinance" : "Purchase";
  return `${box.label}${input.lienPosition === 2 ? " 2nd Position" : ""} ${purposeWord}`.replace(/\s+/g, " ").trim();
}

// Build a COMPLETE structured 1003/URLA seed from the deal so assembleUrla() uses these
// verbatim (seeded values win over derivation) — the whole underwrite transfers to the LOS
// faithfully instead of being re-derived into a mislabeled "Purchase, Fixed, 360mo" default.
function deskUrlaSeed(input: DeskInput, purpose: string) {
  const box = LOAN_BOX[input.loanType];
  const termMonths = box.interestOnly ? 12 : (input.termYears && input.termYears > 0 ? input.termYears : 30) * 12;
  const addr = { street: input.address || undefined, city: input.city || undefined, state: input.state || undefined, zip: input.zip || undefined, country: "US" };
  const hasAddr = !!(addr.street || addr.city || addr.state || addr.zip);
  return {
    borrowers: input.borrower ? [{ fullName: input.borrower }] : [],
    property: {
      address: hasAddr ? addr : undefined,
      propertyType: input.propertyType || undefined,
      occupancy: OCC_URLA[input.occupancy || "investment"] || "Investment",
      presentValue: input.asIsValue || undefined,
      expectedMonthlyRentalIncome: input.monthlyRent || undefined,
      afterRepairValue: input.arv || undefined,
      rehabBudget: input.rehabBudget || undefined,
    },
    loan: {
      purpose,
      amount: input.loanAmount || undefined,
      loanType: LOANTYPE_URLA[input.loanType] || "Other",
      amortizationType: "Fixed",
      termMonths,
      noteRatePercent: input.ratePct || box.rate,
      productDescription: `${box.label}${input.lienPosition === 2 ? " — 2nd Position" : ""}`,
      interestOnly: box.interestOnly || undefined,
      lienPosition: input.lienPosition,
    },
  };
}

// Census ACS market (median income / home value / gross rent) by ZCTA, latest vintage.
async function acsMarket(zip?: string) {
  const zc = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (zc.length !== 5) return null;
  const key = ((await getSetting("CENSUS_API_KEY")) || process.env.CENSUS_API_KEY || "").trim();
  if (!key) return null;
  for (const v of [2023, 2022, 2021]) {
    try {
      const url = `https://api.census.gov/data/${v}/acs/acs5?get=${ACS_VARS}&for=zip%20code%20tabulation%20area:${encodeURIComponent(zc)}&key=${encodeURIComponent(key)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const row = j?.[1];
      if (!row) continue;
      const n = (x: any) => { const v2 = Number(x); return isFinite(v2) && v2 > 0 ? v2 : null; };
      return { vintage: v, zip: zc, medianIncome: n(row[0]), medianHomeValue: n(row[1]), medianGrossRent: n(row[2]) };
    } catch { /* try older vintage */ }
  }
  return null;
}

function docBlocks(docs: any): any[] {
  const blocks: any[] = [];
  for (const d of (Array.isArray(docs) ? docs : []).slice(0, 6)) {
    const mt = String(d?.mediaType || "");
    if (!MEDIA.has(mt) || !d?.base64) continue;
    blocks.push({ type: "text", text: `--- ${str(d.name, 80) || "document"} ---` });
    blocks.push(mt === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: String(d.base64) } }
      : { type: "image", source: { type: "base64", media_type: mt, data: String(d.base64) } });
  }
  return blocks;
}

async function callClaude(system: string, content: any[], maxTokens = 3000): Promise<any> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(110000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : txt);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  const action = String(body.action || "underwrite");

  // ── PDF ────────────────────────────────────────────────────────────────────
  if (action === "pdf") {
    try {
      const pdf = await buildUnderwritingDeskPdf(body.result || {});
      return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Underwriting-Desk.pdf"' } });
    } catch (e: any) { return NextResponse.json({ error: e?.message || "PDF failed" }, { status: 500 }); }
  }

  // ── CREATE FILE (hand off to the LOS) ────────────────────────────────────────
  if (action === "create-file") {
    try {
      const input = sanitizeInput(body.input || {});
      const full_name = input.borrower || "Underwriting Desk deal";
      const parts = full_name.split(/\s+/);
      // A 2nd lien is typically a cash-out against equity, a 1st a purchase — a sane default
      // the LO can override in the 1003; NEVER silently mislabel it (the old bug).
      const purpose = input.loanPurpose || (input.lienPosition === 2 ? "CashOutRefinance" : "Purchase");
      const { data: lead, error: le } = await supabaseAdmin.from("leads").insert({
        full_name, first_name: parts[0] || full_name, last_name: parts.slice(1).join(" ") || null,
        property_address: [input.address, input.city, input.state, input.zip].filter(Boolean).join(", ") || null,
        property_value: input.asIsValue || null, loan_amount_requested: input.loanAmount || null,
        // Descriptive product+purpose string (e.g. "Hard Money 2nd Position Cash-Out Refinance")
        // — drives the LOS product line + the doc-checklist / compliance routing in lib/los.
        loan_purpose: deskProductLabel(input, purpose), occupancy: input.occupancy || "investment",
        state: input.state || null, city: input.city || null, zip: input.zip || null, property_type: input.propertyType || null,
        stage: "Application", source: "underwriting_desk",
        // Full structured 1003 seed so the whole underwrite (loan type, lien, IO, term, rate,
        // ARV, rehab, rent, value, occupancy) lands in the LOS intact — not re-derived.
        raw: { desk_underwrite: body.result || null, urla: deskUrlaSeed(input, purpose), created_by: "underwriting_desk" },
      }).select("*").single();
      if (le || !lead) return NextResponse.json({ error: le?.message || "lead create failed" }, { status: 500 });
      const file = await createLoanFileFromLead(lead);
      if (!file?.id) return NextResponse.json({ error: "file create failed" }, { status: 500 });
      // Attach any uploaded title/assessor docs to the new file so the LOS is complete.
      for (const d of (Array.isArray(body.docs) ? body.docs : []).slice(0, 6)) {
        try {
          if (!MEDIA.has(String(d?.mediaType)) || !d?.base64) continue;
          const ext = String(d.mediaType).split("/")[1]?.replace("jpeg", "jpg") || "pdf";
          const safe = str(d.name, 60).replace(/[^a-zA-Z0-9._-]+/g, "_") || `title.${ext}`;
          const path = `${file.id}/${Date.now()}-${safe}`;
          const buf = Buffer.from(String(d.base64), "base64");
          await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: String(d.mediaType), upsert: false });
          await supabaseAdmin.from("loan_documents").insert({ loan_file_id: file.id, name: str(d.name, 80) || "Title / property profile", category: "Title", status: "received", storage_path: path, file_name: safe, size_bytes: buf.length, uploaded_by: "lo" });
        } catch { /* best-effort attach */ }
      }
      await logActivity({ entity_type: "loan_file", entity_id: file.id, loan_file_id: file.id, lead_id: lead.id, actor: "lo", action: "desk.file_created", detail: { loanType: input.loanType } }).catch(() => {});
      return NextResponse.json({ ok: true, fileId: file.id, leadId: lead.id });
    } catch (e: any) { return NextResponse.json({ error: e?.message || "create-file failed" }, { status: 500 }); }
  }

  // ── UNDERWRITE (default) ─────────────────────────────────────────────────────
  try {
    const input = sanitizeInput(body.input || body);
    if (!input.loanAmount || !input.asIsValue) return NextResponse.json({ error: "Enter at least a loan amount and an as-is value / purchase price." }, { status: 422 });

    // 1) Geocode (free Census/OSM) — best-effort.
    let geo: any = null;
    try { const one = [input.address, input.city, input.state, input.zip].filter(Boolean).join(", "); if (one) geo = await verifyAddress(one); } catch { /* non-fatal */ }
    const zip = input.zip || geo?.zip || "";
    const state = input.state || geo?.state || "";

    // 2) ZIP tax/insurance rates + county + 3) Census market + 4) county-treasurer tax link.
    const loc = zip ? resolveLocation(zip) : null;
    const market = await acsMarket(zip);
    let taxLink: any = null;
    try { taxLink = taxLookupFor({ id: "desk", address: input.address || geo?.standardized || "", city: input.city || "", state, zip, county: loc?.countyName || "" } as any); } catch { /* non-fatal */ }

    // 5) AI-read the uploaded TitlePro / assessor profile (if any).
    let titleRead: any = null;
    const blocks = docBlocks(body.docs);
    if (blocks.length) {
      try { titleRead = await callClaude(TITLE_SYSTEM, [...blocks, { type: "text", text: "Extract the property / title / tax facts. JSON only." }], 2500); }
      catch (e: any) { titleRead = { error: e?.message || "Couldn't read the uploaded document." }; }
    }

    // 6) Deterministic metrics (fill tax/ins from the ZIP resolver if not overridden).
    const metrics = computeDeskMetrics({ ...input, state, taxRatePct: input.taxRatePct || loc?.taxRatePct, insRatePct: input.insRatePct || loc?.insRatePct });

    // 7) Approved wholesale lenders for matching.
    let lenders: any[] = [];
    try { lenders = (await getLenders()).map((l: any) => ({ name: l.name, loanTypes: l.loanTypes, specialty: l.notes })); } catch { /* none */ }

    // 8) AI underwriting synthesis.
    const box = LOAN_BOX[input.loanType];
    const brief = {
      deal: { borrower: input.borrower, address: [input.address, input.city, input.state, input.zip].filter(Boolean).join(", "), loanType: box.label, lienPosition: input.lienPosition, loanAmount: input.loanAmount, asIsValue: input.asIsValue, arv: input.arv, existingSeniorLiens: input.existingLiens, rehabBudget: input.rehabBudget, monthlyRent: input.monthlyRent, propertyType: input.propertyType, occupancy: input.occupancy, fico: input.fico },
      programBox: box,
      metrics,
      titleRead: titleRead && !titleRead.error ? titleRead : null,
      titleReadError: titleRead?.error || null,
      market, taxLinkKnown: !!taxLink,
      approvedLenders: lenders,
    };
    let underwrite: any = null;
    try { underwrite = await callClaude(UNDERWRITE_SYSTEM, [{ type: "text", text: "Underwrite this deal:\n" + JSON.stringify(brief) }], 3000); }
    catch (e: any) { underwrite = { error: e?.message || "Underwriting synthesis failed — metrics still shown." }; }

    await logActivity({ entity_type: "underwriting_desk", entity_id: (zip || "deal").slice(0, 40), actor: "ai:underwriter", action: "desk.underwrite", detail: { loanType: input.loanType, verdict: underwrite?.verdict, ltv: metrics.ltv, dscr: metrics.dscr } }).catch(() => {});

    return NextResponse.json({
      input,
      geo: geo ? { standardized: geo.standardized, lat: geo.lat, lng: geo.lng, mapsUrl: geo.mapsUrl } : null,
      location: loc ? { countyName: loc.countyName, state: loc.state, taxRatePct: loc.taxRatePct, insRatePct: loc.insRatePct } : null,
      market, taxLink, titleRead, metrics, underwrite,
    });
  } catch (e: any) {
    console.error("[underwriter-desk]", e);
    return NextResponse.json({ error: e?.message || "Underwrite failed." }, { status: 500 });
  }
}
