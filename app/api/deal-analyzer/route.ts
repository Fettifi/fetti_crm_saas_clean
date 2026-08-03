// INVESTOR DEAL ANALYZER — "should I buy this?" in one pass. Input an address + a
// potential purchase price; the tool pulls the property + neighborhood from the public
// web, runs the deterministic economics for every acquisition strategy (fix & flip, DSCR
// rental hold, BRRRR, wholesale), and synthesizes an investor verdict + best strategy +
// a full strategic plan. Distinct from the lender-side Underwriting Desk: this answers
// "is it a good deal for ME as an investor," not "can we fund it."
//
// Data: free Census geocoder + ACS market, Serper/Google web pull (Zillow/Redfin/assessor
// + neighborhood/comps), the shared deal math (qualifyDeal + underwriteOne). No property
// AVM/title vendor API exists — web AVMs are preliminary; TitlePro/county records are
// verified by a human before an offer (surfaced as due-diligence steps). Auth via proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { verifyAddress } from "@/lib/address";
import { resolveLocation } from "@/lib/propertyData";
import { taxLookupFor } from "@/lib/underwrite/taxLinks";
import { qualifyDeal } from "@/lib/underwrite/dealQualifier";
import { underwriteOne, DEFAULT_ASSUMPTIONS, type PropertyRow } from "@/lib/underwrite/engine";
import { carryingCosts, dealAssumptions, entered, overriddenAssumptions } from "@/lib/underwrite/dealInputs";
import { pullPropertyFromWeb, pullNeighborhood, acsMarket, callClaudeJSON } from "@/lib/underwrite/webIntel";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const num = (v: any): number => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const str = (v: any, n = 200) => String(v ?? "").trim().slice(0, n);

const INVESTOR_SYSTEM = `You are a sharp, honest real-estate investment analyst advising a principal buyer (an investor who also happens to be a mortgage broker). You are handed a specific deal: the entered purchase price, the subject property's facts pulled from the public web (Zillow/Redfin/assessor — AVM ESTIMATES, not appraisals), the neighborhood/market read, Census area medians, and the DETERMINISTIC ECONOMICS already computed for each strategy (fix & flip, DSCR rental hold, BRRRR, and a rough wholesale view). Your job: tell the investor plainly whether this is a good deal, the BEST way to play it, and exactly what to do.

Anchor every number to the economics you were given — do not invent returns. Treat web AVM value/rent as preliminary and require confirmation (appraisal/BPO, rent survey). Be direct: if it's a pass, say pass and why. Output ONLY this JSON:
{
 "verdict": "<Strong Buy | Buy — at the right price | Marginal | Pass>",
 "dealScore": <0-100>,
 "bestStrategy": "<Fix & Flip | DSCR Rental Hold | BRRRR | Buy & Hold | Wholesale / Assign | Pass>",
 "headline": "<one punchy sentence: is this a good deal and how to play it>",
 "summary": "<3-5 sentences: the investor read — is the price right, what's the money-maker, what's the catch>",
 "propertyRead": "<condition/size/type from the web facts; what still must be verified>",
 "neighborhoodRead": "<market + area read: appreciating or soft, rental demand, resale liquidity, risks>",
 "strategies": {
   "flip": {"play":"<how you'd run it>","projectedProfit":<$|null>,"roiPct":<number|null>,"timelineMonths":<number|null>,"verdict":"<works|works if|thin|no>","note":"<the binding number / condition>"},
   "rentalHold": {"play":"<how you'd run it>","monthlyCashflow":<$|null>,"capRatePct":<number|null>,"cashOnCashPct":<number|null>,"dscr":<number|null>,"verdict":"<works|works if|thin|no>","note":"<the binding number / condition>"},
   "brrrr": {"play":"<how you'd run it>","cashLeftInDeal":<$|null>,"verdict":"<works|works if|thin|no>","note":"<short>"},
   "wholesale": {"play":"<assign to another investor?>","estimatedSpread":<$|null>,"verdict":"<works|works if|thin|no>","note":"<short>"}
 },
 "maxOffer": {"forFlip": <$|null>, "forRentalHold": <$|null>, "note":"<the price at which each strategy actually works, vs the entered price>"},
 "keyNumbers": "<the 3-5 figures that drive the call, stated tersely>",
 "risks": ["<the real risks: value uncertainty, rehab overrun, soft market, taxes/liens unknown, etc.>"],
 "dueDiligence": ["<the exact verification steps BEFORE an offer: pull the TitlePro profile for liens/vesting, verify current taxes at the county treasurer, confirm rehab scope + ARV with a walkthrough/BPO, rent survey, etc.>"],
 "strategicPlan": ["<numbered, concrete next actions to execute the best strategy — offer price, financing, team, timeline, exit>"],
 "confidence": "<high | medium | low — and why, based on how complete the pulled data was>"
}`;

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  try {
    const address = str(body?.address, 200), city = str(body?.city, 80), state = str(body?.state, 2).toUpperCase();
    let zip = str(body?.zip, 10).replace(/[^0-9]/g, "").slice(0, 5);
    const purchasePrice = num(body?.purchasePrice);
    const rehabBudget = num(body?.rehabBudget) || 0;
    const inputArv = num(body?.arv) || 0;
    const inputRent = num(body?.monthlyRent) || 0;
    // CARRYING COSTS THE INVESTOR ACTUALLY KNOWS. Until now there was no input for any of these
    // anywhere on the screen, and insurance was hardcoded null so it was ALWAYS modelled — an
    // investor holding the real tax bill and a bound premium had no way to use them, on the one
    // tool whose entire job is "should I buy this?". Coercion lives in lib/underwrite/dealInputs
    // so the guard tests what ships rather than a copy of these rules.
    const { taxesAnnual: inTaxes, insuranceAnnual: inIns, hoaMonthly: inHoa } = carryingCosts(body);
    const propertyType = str(body?.propertyType, 40) || "SFR";
    if (!address && !zip) return NextResponse.json({ error: "Enter a property address." }, { status: 422 });
    // A NEGATIVE price passed this guard and produced a negative cap rate presented as analysis.
    if (!purchasePrice || purchasePrice < 0) return NextResponse.json({ error: "Enter a potential purchase price." }, { status: 422 });

    const one = [address, city, state, zip].filter(Boolean).join(", ");

    // 1) Geocode (free) — backfills ZIP/state + gives a map pin.
    let geo: any = null;
    try { if (one) geo = await verifyAddress(one); } catch { /* non-fatal */ }
    if (!zip && geo?.zip) zip = geo.zip;
    const st = state || geo?.state || "";
    const loc = zip ? resolveLocation(zip) : null;
    const cityStateZip = [city || geo?.city, st, zip].filter(Boolean).join(" ");

    // 2) Fan out the intel pulls in parallel: property facts, neighborhood/market, Census.
    const [property, neighborhood, market] = await Promise.all([
      pullPropertyFromWeb(one).catch(() => null),
      pullNeighborhood(one, cityStateZip).catch(() => null),
      acsMarket(zip).catch(() => null),
    ]);
    const web = (property && property.matchedAddress) ? property : null;

    // 3) Effective inputs for the math. Purchase price is the buyer's basis. ARV falls back
    //    to the web value estimate (as-is), rent to the web rent estimate — clearly sourced.
    const effArv = inputArv || Number(web?.estimatedValue) || Number(web?.lastSalePrice) || 0;
    const arvSource = inputArv ? "entered" : (web?.estimatedValue ? `web:${web.valueBasis || "estimate"}` : web?.lastSalePrice ? "web:recent sale" : "none");
    // $0 rent is a real statement (vacant / owner-occupied at purchase), so test for ENTERED.
    const rentEntered = entered(body?.monthlyRent);
    const effRent = rentEntered ? Number(body.monthlyRent) : (Number(web?.estimatedRent) || 0);
    const rentSource = rentEntered ? "entered" : (web?.estimatedRent ? "web:Rent Zestimate" : "none");

    // 4) Deterministic economics for every strategy (the numbers the AI must anchor to).
    const propertyRow: PropertyRow = {
      id: "analyze", address: address || geo?.standardized || "", city: city || geo?.city || null, state: st || null, zip: zip || null,
      county: loc?.countyName || null, property_type: propertyType, units: null,
      price: purchasePrice, rent_monthly: effRent || null,
      // Entered figure wins; then the web pull; then the engine's %-of-price fallback (which
      // flags itself as an estimate).
      // PRECEDENCE, and it was wrong in the most expensive direction. The scraped
      // `annualPropertyTax` is the CURRENT OWNER'S bill — on a purchase the property reassesses to
      // the sale price, so the seller's (often long-held, often capped) bill understates the
      // buyer's tax, inflating NOI, cap rate and cashflow on the one tool that answers "should I
      // buy this?". Entered wins; then the ZIP-accurate rate model this route ALREADY RESOLVED
      // and then threw away; the seller's bill is used only on a refi, where the owner does not
      // change, and only as a last resort.
      // THIS TOOL ALWAYS MODELS AN ACQUISITION — flip, hold and BRRRR all begin with buying the
      // property — so the assessment always resets to the purchase price. The scraped
      // `annualPropertyTax` is the CURRENT OWNER'S bill, often long-held and often capped, and
      // using it understated the buyer's tax and inflated NOI, cap rate and cashflow on the one
      // tool that answers "should I buy this?".
      //
      // (My first version gated this on a `purpose` the screen never sends, so the branch could
      // never be true — a dead condition dressed as a rule. Removed rather than left in place.)
      // LEAVE IT NULL WHEN IT IS MODELLED. Populating it here from the ZIP rate looked like an
      // improvement and broke two things: the engine's `taxes_estimated` flag is set by
      // `p.taxes_annual == null`, so the "estimated — verify" warning stopped firing on EVERY
      // run; and dealQualifier's maxWorkablePrice iteration scales carrying costs with the
      // candidate price ONLY through the same `??` fallback, so a fixed figure froze the taxes at
      // the entered price and moved the tool's most action-driving number optimistically.
      //
      // The ZIP rate is a better MODEL than the engine's flat %-of-price, so it is passed as the
      // assumption instead — where it scales, and where it stays an acknowledged estimate.
      taxes_annual: inTaxes,
      insurance_annual: inIns,
      // The ZIP insurance model was resolved and discarded too — insurance fell all the way
      // through to the engine's flat %-of-price fallback even when a better figure existed.
      hoa_monthly: inHoa ?? (Number(web?.hoaMonthly) || null),
      rehab_budget: rehabBudget || null, arv: effArv || null, back_tax_status: "unknown", notes: str(body?.notes, 400) || null,
    };
    // THE DEAL TERMS ARE ASSUMPTIONS TOO. Rate, target DSCR, max LTV, vacancy, management,
    // maintenance and closing costs were all fixed house defaults, so an investor with a real
    // quoted rate or a real management contract could not model their own deal.
    const assumptions = dealAssumptions(body);
    // ZIP-accurate fallbacks, applied as RATES so they scale with the candidate price in the
    // maxWorkablePrice search and still read as estimates to the engine.
    if (loc?.taxRatePct) assumptions.tax_fallback_pct = loc.taxRatePct;
    if ((loc as any)?.insRatePct) assumptions.ins_fallback_pct = (loc as any).insRatePct;
    const assumptionsOverridden = overriddenAssumptions(body);
    const qualify = qualifyDeal(propertyRow, assumptions);   // flip / rental / brrrr requirements + verdicts
    const hold = underwriteOne(propertyRow, assumptions);    // NOI, cap rate, cash-on-cash, cashflow, max loan

    // 5) Investor synthesis — the verdict, best strategy, and the strategic plan.
    const brief = {
      deal: { address: one, purchasePrice, rehabBudget, arvUsed: effArv, arvSource, monthlyRentUsed: effRent, rentSource, propertyType },
      webProperty: web,
      neighborhood,
      censusMedians: market,
      economics: {
        flip: qualify.flip, rental: qualify.rental, brrrr: qualify.brrrr, headline: qualify.headline,
        hold: { noi_annual: hold.noi_annual, cap_rate_pct: hold.cap_rate_pct, max_loan: hold.max_loan, monthly_cashflow: hold.monthly_cashflow, cash_on_cash_pct: hold.cash_on_cash_pct, dscr_at_max_loan: hold.dscr_at_max_loan, verdict: hold.verdict, flags: hold.flags },
      },
      assumptions,
      // WHOSE TERMS THESE ARE. Without this the brief reads identically whether the investor
      // supplied a real quoted rate or we assumed one.
      assumptionsOverridden,
      carryingCostSource: {
        taxes: inTaxes != null ? "entered"
          : (loc?.taxRatePct ? `ESTIMATED at the ${loc.countyName || zip} effective rate (${loc.taxRatePct}%), applied to the purchase price — a sale resets the assessment. Verify with the county.`
          : Number(web?.annualPropertyTax) ? "current owner's bill from public records — verify, a sale usually reassesses"
          : "estimated %-of-price"),
        insurance: inIns != null ? "entered" : (loc && (loc as any).insRatePct ? `ESTIMATED — regional model for ${loc.countyName || zip}` : "estimated %-of-price"),
        hoa: inHoa != null ? "entered" : (Number(web?.hoaMonthly) ? "web" : "none on file"),
      },
    };
    let analysis: any = null;
    try { analysis = await callClaudeJSON(INVESTOR_SYSTEM, [{ type: "text", text: "Analyze this deal for me as the buyer:\n" + JSON.stringify(brief) }], 3500); }
    catch (e: any) { analysis = { error: e?.message || "Analysis synthesis failed — the numbers below are still valid." }; }

    const taxLink = (() => { try { return taxLookupFor({ id: "analyze", address: address || geo?.standardized || "", city, state: st, zip, county: loc?.countyName || "" } as any); } catch { return null; } })();

    await logActivity({ entity_type: "deal_analyzer", entity_id: (zip || "deal").slice(0, 40), actor: "ai:investor", action: "deal.analyze", detail: { verdict: analysis?.verdict, bestStrategy: analysis?.bestStrategy, price: purchasePrice, capRate: hold.cap_rate_pct } }).catch(() => {});

    return NextResponse.json({
      input: { address, city, state: st, zip, purchasePrice, rehabBudget, arv: effArv, monthlyRent: effRent, propertyType },
      arvSource, rentSource,
      geo: geo ? { standardized: geo.standardized, lat: geo.lat, lng: geo.lng, mapsUrl: geo.mapsUrl } : null,
      location: loc ? { countyName: loc.countyName, state: loc.state, taxRatePct: loc.taxRatePct, insRatePct: loc.insRatePct } : null,
      property: web, neighborhood, market, taxLink,
      economics: { qualify, hold },
      analysis,
    });
  } catch (e: any) {
    console.error("[deal-analyzer]", e);
    return NextResponse.json({ error: e?.message || "Analysis failed." }, { status: 500 });
  }
}
