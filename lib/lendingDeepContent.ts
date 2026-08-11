// SUBSTANTIVE, PER-SLUG COPY — the thing that earns a page its place in the index.
//
// The templated PRODUCTS copy in app/lending/[slug]/page.tsx says the same 535 words on every
// state page. That is why Google crawled 84 of them and indexed none. A slug listed in
// INDEXABLE_LENDING_SLUGS must have an entry here, and it must say something that is true of THIS
// state and no other — otherwise it is the same doorway with a longer word count.
//
// Everything here is operator knowledge: the things that actually change a California DSCR
// number and that a borrower will not find on a national lender's template.

export type DeepSection = { h: string; body: string[] };
export type DeepContent = {
  /** Replaces the templated intro when present. */
  lede: string;
  sections: DeepSection[];
  /** Extra FAQs appended to the product's generic set. */
  faqs: { q: string; a: string }[];
};

export const DEEP_CONTENT: Record<string, DeepContent> = {
  "dscr-loans-california": {
    lede:
      "A DSCR loan qualifies your California rental on the property's own cash flow instead of your " +
      "personal income, W-2s or tax returns. The arithmetic is simple — the rent has to cover the " +
      "payment — but in California the payment side of that ratio behaves differently than it does " +
      "anywhere else, and that is where most deals are won or lost. Below is what actually moves a " +
      "California DSCR number, written by the people who underwrite them.",
    sections: [
      {
        h: "How the ratio is actually calculated",
        body: [
          "DSCR is the property's rent divided by its full housing payment — principal, interest, " +
          "taxes, insurance and any HOA dues, the figure lenders call PITIA. A 1.00 means the rent " +
          "exactly covers the payment. A 1.25 means the rent covers it with 25% to spare.",
          "Two details decide more California files than anything else. First, most programs use the " +
          "lesser of the actual lease rent and the appraiser's market-rent opinion on Form 1007, so an " +
          "above-market lease from a friendly tenant will not carry a deal. Second, the taxes and " +
          "insurance in that denominator are the FUTURE numbers, not the seller's current bill — which " +
          "in California is where the surprise lives.",
        ],
      },
      {
        h: "Proposition 13 is the single biggest trap in California DSCR",
        body: [
          "Under Proposition 13, a property's assessed value is capped while ownership stays the same, " +
          "rising no more than 2% a year. When it sells, the assessment resets to the new purchase " +
          "price. A building held by the same family for twenty years can be assessed at a fraction of " +
          "what you are paying for it.",
          "Investors routinely underwrite a deal using the tax bill on the MLS sheet, get a DSCR that " +
          "works, and then watch the ratio collapse when the lender reassesses at roughly 1.1–1.25% of " +
          "the purchase price. On a $900,000 duplex bought from a long-time owner, the difference " +
          "between the old assessment and the reset one can be several hundred dollars a month of PITIA " +
          "— which is often the entire margin between a 1.15 DSCR and a 0.95.",
          "We underwrite California files on the reset number from the first conversation. If a lender " +
          "quotes you off the seller's current taxes, the ratio you are being shown is not the ratio " +
          "your file will close at.",
        ],
      },
      {
        h: "Insurance is now a real underwriting variable, not a rounding error",
        body: [
          "California property insurance has repriced hard in wildfire-exposed areas, and several " +
          "national carriers have pulled back from writing new policies in parts of the state. Where " +
          "the admitted market will not write, owners land on surplus-lines coverage or the California " +
          "FAIR Plan, usually paired with a separate wrapper policy for the perils FAIR Plan does not " +
          "cover.",
          "That premium sits directly in the DSCR denominator. A property in a high-hazard severity " +
          "zone can carry insurance several times what an equivalent building costs to insure in the " +
          "Central Valley — enough to move a ratio by a tenth or more on its own. Get a real quote " +
          "early. An estimate carried over from another state is the fastest way to have a file " +
          "re-priced late.",
        ],
      },
      {
        h: "Mello-Roos and special assessments",
        body: [
          "In newer California developments — much of the Inland Empire, Sacramento's suburbs, parts of " +
          "the Central Valley — a Mello-Roos community facilities district levies an additional annual " +
          "charge that funds the infrastructure the tract was built on. It appears on the tax bill and " +
          "counts fully in PITIA.",
          "Two identical houses on the same street, one inside the district and one outside, can " +
          "underwrite to materially different ratios. Pull the actual tax bill, not an estimate from " +
          "the assessed value.",
        ],
      },
      {
        h: "Rent control shapes the income side",
        body: [
          "California's statewide Tenant Protection Act caps annual rent increases on many older " +
          "properties and requires just cause for most terminations. Los Angeles, San Francisco, " +
          "Oakland, Santa Monica and others layer stricter local ordinances on top, often with lower " +
          "caps and their own registration requirements.",
          "For a DSCR file this matters in two ways. An in-place tenant well below market cannot simply " +
          "be raised to market to make the ratio work, so the lesser-of test bites harder. And on a " +
          "property where market rent is far above the legal rent, the appraiser's 1007 and the actual " +
          "lease can diverge sharply — expect underwriting to use the lease.",
        ],
      },
      {
        h: "ADUs can carry a California deal",
        body: [
          "California has spent several legislative sessions making accessory dwelling units easier to " +
          "permit, and a legally permitted ADU with its own lease adds income to the numerator. On a " +
          "single-family property in Los Angeles or San Diego, a permitted ADU is frequently what lifts " +
          "a marginal ratio over the line.",
          "The word doing the work is permitted. Unpermitted conversions — very common in older LA " +
          "housing stock — generally cannot be counted, and an appraiser who flags one can also reduce " +
          "the value conclusion. If the income matters to your ratio, confirm the permit before you " +
          "write the offer.",
        ],
      },
      {
        h: "When the ratio does not clear 1.00",
        body: [
          "California's price-to-rent relationship means plenty of good coastal properties simply do " +
          "not cash flow at closing. That is not automatically a dead file. Programs exist for ratios " +
          "below 1.00, and some will lend with no ratio requirement at all — the trade is lower " +
          "leverage, a stronger credit profile, and more reserves.",
          "The other levers are structural: a larger down payment lowers the payment and lifts the " +
          "ratio directly; an interest-only period reduces the denominator during the term; buying " +
          "down the rate trades cash at closing for a permanently better ratio. Which of those is " +
          "cheapest depends on how long you intend to hold, and it is worth modelling before you pick.",
        ],
      },
      {
        h: "Closing in an LLC, and what California charges for it",
        body: [
          "DSCR loans are business-purpose credit and close in an entity as a matter of course, which " +
          "keeps the financing off your personal credit report and is standard for portfolio builders.",
          "Budget for California's cost of holding that entity: the state levies an $800 annual minimum " +
          "franchise tax on LLCs, plus a graduated fee once gross receipts pass certain thresholds. It " +
          "is not a loan cost, but it is a real annual carry that investors coming from other states " +
          "regularly forget when they model a California hold.",
          "Because these are business-purpose loans on non-owner-occupied property, they are not " +
          "consumer mortgages — a distinction that governs which disclosures apply and lets us lend on " +
          "investment property in all fifty states, not only the three where we originate owner-occupied " +
          "financing.",
        ],
      },
      {
        h: "What we need to quote a California DSCR accurately",
        body: [
          "The property address and either the executed lease or your rent expectation. The purchase " +
          "price or your estimate of value on a refinance. An insurance quote if the property is in a " +
          "fire-exposed area. The full tax bill including any special assessments. Your credit range " +
          "and how much you plan to put down.",
          "With those we can tell you the ratio your file will actually underwrite to — using the reset " +
          "tax basis, not the seller's — and whether the deal clears as structured or needs one of the " +
          "levers above.",
        ],
      },
    ],
    faqs: [
      {
        q: "Will my California property taxes go up when I buy?",
        a: "Almost certainly. Proposition 13 caps assessment growth while ownership stays the same, then " +
          "resets to the purchase price on transfer. If you are buying from a long-time owner, expect a " +
          "materially higher tax bill than the seller's — and expect it to be in your DSCR calculation.",
      },
      {
        q: "Can I use rent from an ADU to qualify in California?",
        a: "Yes, when the ADU is legally permitted and there is a lease or a market-rent opinion " +
          "supporting it. Unpermitted units generally cannot be counted and can affect the appraised " +
          "value as well, so confirm the permitting before you rely on that income.",
      },
      {
        q: "My California property does not cash flow. Is a DSCR loan still possible?",
        a: "Often, yes. There are programs for ratios under 1.00 and some with no ratio requirement, " +
          "typically at lower leverage with stronger reserves. A larger down payment, an interest-only " +
          "structure or a rate buydown can also lift the ratio — which is cheapest depends on your hold " +
          "period.",
      },
      {
        q: "Does rent control affect a DSCR loan in Los Angeles?",
        a: "It affects the income side. Where a tenant is well below market, underwriting will generally " +
          "use the actual lease rather than the appraiser's market rent, so a below-market in-place " +
          "tenant lowers your qualifying ratio even though the property could rent for more.",
      },
    ],
  },
};

export function deepContentFor(slug: string): DeepContent | null {
  return DEEP_CONTENT[slug] || null;
}
