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
  /**
   * Overrides for the templated `<title>` and meta description.
   *
   * The template builds `${product} in ${state} | Fetti Financial Services`, which spends 30 of
   * roughly 60 usable characters on the brand and makes no promise. Worse, it can only ever say
   * the product's own name — so the commercial page went live titled "Commercial Real Estate
   * Loans in Florida" while four of the five queries it targets say **business** ("business real
   * estate loans fl", "business property loans florida"). The word was absent from the one place
   * it matters most, and the 66-character title was going to truncate in results anyway.
   *
   * A page that has earned its own copy has earned its own title. Keep titles under ~60 chars and
   * descriptions under ~155, and never put a Reg Z triggering term in either.
   */
  title?: string;
  description?: string;
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

  "dscr-loans-florida": {
    // 51 chars. Carries the head query verbatim ("dscr loans florida", 33 impressions, and
    // "dscr loan florida" at 53) and then says something only an operator would say.
    title: "DSCR Loans in Florida: Insurance Decides Your Ratio",
    // 153 chars. Names the three Florida-specific levers the page actually explains.
    description:
      "Qualify a Florida rental on its rent, not your W-2 or tax returns. What insurance, CDD fees " +
      "and the tax reset do to your ratio, and how we get it funded.",
    lede:
      "A DSCR loan qualifies your Florida rental on the property\u2019s own cash flow rather than your " +
      "personal income, W-2s or tax returns. In Florida the rent side is usually the easy part \u2014 it is " +
      "the DENOMINATOR that decides these files. Insurance, the post-Surfside condo rules and a tax " +
      "bill that resets the moment you buy can move a ratio by more than a point of interest rate ever " +
      "will. Here is what actually governs a Florida DSCR, from the people who underwrite them.",
    sections: [
      {
        h: "Insurance is the single biggest number in a Florida DSCR",
        body: [
          "Everywhere else insurance is a rounding error in PITIA. In Florida it is frequently the " +
          "largest line after principal and interest. Carriers withdrew from the state in waves, and " +
          "what is left prices wind exposure aggressively \u2014 a policy that would cost $1,400 in Ohio can " +
          "run several times that on a coastal Florida rental.",
          "Three things move that premium more than anything else. Roof age: many carriers will not " +
          "write a roof over about fifteen years, and a roof approaching that age can make a property " +
          "effectively uninsurable until it is replaced — which is why buyers in that spot often acquire " +
          "on a [bridge loan](/lending/bridge-loans-florida), replace the roof, then refinance onto DSCR. A wind mitigation inspection: shutters, a " +
          "hip roof, roof-to-wall straps and a secondary water barrier earn credits that routinely " +
          "cut a premium by a third or more \u2014 order one before you order anything else. And the " +
          "hurricane deductible, which in Florida is a PERCENTAGE of dwelling coverage, typically 2% " +
          "to 5%, not a flat dollar amount.",
          "If the admitted market declines the risk you land on surplus lines or Citizens Property " +
          "Insurance, the state-backed insurer of last resort. Citizens is writable for DSCR, but " +
          "expect the carrier to be scrutinised and expect depopulation offers later. Get a real bound " +
          "quote early. Bind a real Florida policy before you are relying on the ratio it produces; a " +
          "file re-priced a week before closing.",
        ],
      },
      {
        h: "Flood is a separate policy, and the zone is not optional",
        body: [
          "Wind and flood are different perils on different policies. A standard Florida landlord " +
          "policy excludes flood, so if the property sits in a Special Flood Hazard Area the lender " +
          "will require separate flood coverage \u2014 NFIP or a private carrier \u2014 and that premium goes " +
          "into your DSCR denominator alongside everything else.",
          "Private flood has become genuinely competitive with NFIP in much of Florida and is often " +
          "both cheaper and faster to bind. Pull the flood zone from the survey or the elevation " +
          "certificate before you write the offer; a property that looks like a strong ratio in Zone X " +
          "can look very different in Zone AE.",
        ],
      },
      {
        h: "Condos after Surfside: milestone inspections and reserve studies",
        body: [
          "The 2021 Surfside collapse changed Florida condo lending permanently. Buildings three " +
          "storeys and taller now face milestone structural inspections at defined ages, and " +
          "associations must complete a structural integrity reserve study and fund those reserves " +
          "rather than waive them as many did for decades.",
          "The lending consequence is blunt. An association that has deferred maintenance, is mid-way " +
          "through a milestone inspection, or has just levied a six-figure special assessment can make " +
          "an otherwise perfect unit non-warrantable. That does not kill the deal \u2014 non-warrantable " +
          "condo DSCR programmes exist and we place them \u2014 but the pricing and leverage are different, " +
          "and you need to know before you are under contract, not after.",
          "Ask for the association\u2019s reserve study, the milestone inspection status, the current " +
          "budget and any assessment history the day you go under contract. Special assessments also " +
          "land in your carrying cost, which means they land in your ratio.",
        ],
      },
      {
        h: "CDD fees are Florida\u2019s hidden line item",
        body: [
          "In much of the newer inventory around Orlando, Tampa, Jacksonville and the I-4 corridor, a " +
          "Community Development District levies an annual charge that funded the roads, drainage and " +
          "amenities the subdivision was built on. It arrives on the property tax bill and it counts in " +
          "full toward PITIA.",
          "Two similar houses on facing streets \u2014 one inside a CDD, one outside \u2014 can underwrite to " +
          "meaningfully different ratios. Pull the actual tax bill line by line rather than estimating " +
          "from the assessed value, because the CDD portion is invisible in a millage calculation.",
        ],
      },
      {
        h: "Your tax bill will not look like the seller\u2019s",
        body: [
          "Florida caps annual assessment increases at 10% for non-homestead property, and the " +
          "Save Our Homes 3% cap and homestead exemption apply only to a primary residence \u2014 never to " +
          "your rental. When a long-held property changes hands the assessment resets toward market " +
          "value and the caps start again from that new basis.",
          "So the taxes on the listing sheet are the seller\u2019s taxes, often after years of capped " +
          "growth and possibly with a homestead exemption you will not inherit. We underwrite Florida " +
          "files on the reset figure from the first conversation. If a lender quotes you off the " +
          "current bill, the ratio you are being shown is not the ratio your file closes at.",
        ],
      },
      {
        h: "Short-term rentals: strong income, stricter underwriting",
        body: [
          "Florida is the largest short-term rental market in the country, and around Orlando and the " +
          "Gulf beaches an STR can produce two or three times the long-term rent. Several DSCR " +
          "programmes will qualify on that income \u2014 usually from twelve months of operating statements " +
          "or a recognised market-data report rather than a Form 1007 long-term rent opinion.",
          "The constraint is local, not financial. Florida municipalities regulate short-term rental " +
          "sharply and inconsistently: some zones permit nightly rental outright, others impose minimum " +
          "stays, registration and inspection, and some prohibit it entirely. A property that only " +
          "clears DSCR on STR numbers in a jurisdiction that bans STR is not a deal. Confirm the " +
          "ordinance for that specific address and zoning before you rely on the income.",
        ],
      },
      {
        h: "Doc stamps and intangible tax \u2014 Florida\u2019s own closing costs",
        body: [
          "Florida charges documentary stamp tax on the promissory note at $0.35 per $100 of the amount " +
          "financed, plus a nonrecurring intangible tax of 0.2% on the mortgage itself. On a $400,000 " +
          "loan that is roughly $1,400 in doc stamps and $800 in intangible tax before any other " +
          "closing cost.",
          "It does not touch your DSCR, but it is real cash to close that investors from other states " +
          "consistently forget to budget, and it is one reason Florida cash-to-close comes in higher " +
          "than an equivalent purchase elsewhere.",
        ],
      },
      {
        h: "When the ratio does not clear 1.00",
        body: [
          "Florida rents are strong relative to price in much of the state, so ratios often work \u2014 but " +
          "the insurance line can drag a good property under 1.00 on its own. That is not automatically " +
          "a dead file. Programmes exist for ratios below 1.00, and some will lend with no ratio " +
          "requirement at all; the trade is lower leverage, a stronger credit profile and more reserves.",
          "Before conceding the deal, work the denominator: a wind mitigation inspection, a higher " +
          "hurricane deductible, private flood instead of NFIP, or a roof replacement credited by the " +
          "carrier can each move the premium enough to change the answer. Structural levers work too \u2014 " +
          "a larger down payment, an interest-only period, or buying the rate down.",
          "One structural answer sits outside DSCR entirely: at five or more units the property stops " +
          "being residential investment and is financed as " +
          "[commercial real estate](/lending/commercial-real-estate-loans-florida), where the rent roll " +
          "and the leases behind it carry the file rather than a single ratio.",
        ],
      },
      {
        h: "Closing in an LLC, and why Florida is friendly to it",
        body: [
          "DSCR loans are business-purpose credit and close in an entity as a matter of course, which " +
          "keeps the financing off your personal credit report and is standard for portfolio builders.",
          "Florida levies no state personal income tax and no franchise tax on the LLC itself, so the " +
          "annual carrying cost of holding property in an entity here is materially lower than in " +
          "states that charge for the privilege. That is a genuine reason investors domicile Florida " +
          "holdings in Florida entities.",
          "Because these are business-purpose loans on non-owner-occupied property they are not " +
          "consumer mortgages, which governs which disclosures apply and lets us lend on investment " +
          "property in all fifty states.",
        ],
      },
      {
        h: "The prepayment penalty is the question nobody asks until closing",
        body: [
          "Almost every DSCR program carries a prepayment penalty, and it is not a trap — it is part of " +
          "how the loan is priced. Accepting one generally buys you better terms; refusing one generally " +
          "costs you them. What matters is that you know which structure you have before you sign, " +
          "because the structure decides what your exit costs.",
          "The common shapes are a step-down, where the charge declines each year the loan seasons; a " +
          "flat charge that applies for a fixed opening period and then disappears; and, less often on " +
          "residential-style DSCR paper, yield maintenance, which makes the lender whole for the income " +
          "it expected. Many programs will also shorten or remove the penalty in exchange for different " +
          "pricing. That trade is worth asking about explicitly rather than accepting the default.",
          "Match it to your actual plan. If you intend to hold the rental for years, a longer penalty " +
          "period is close to free money. If you are buying to season and refinance, or you expect to " +
          "sell into a strong Florida spring, a penalty that outlives your hold is a cost you have " +
          "already agreed to pay. The same logic applies to a bridge-to-DSCR sequence: if you are " +
          "refinancing out of a [bridge loan](/lending/bridge-loans-florida), check that the DSCR " +
          "penalty window does not collide with your next move.",
          "Ask for the prepayment structure on the term sheet, in writing, alongside the ratio. It is " +
          "the single most common thing an investor discovers late, and it is the easiest to settle " +
          "early.",
        ],
      },
      {
        h: "What we need to quote a Florida DSCR accurately",
        body: [
          "The property address and either the executed lease, your rent expectation, or STR operating " +
          "history. The purchase price or your value estimate on a refinance. A bound insurance quote, " +
          "or at minimum the roof age and a wind mitigation report. The full tax bill including any CDD " +
          "line. For a condo, the association budget, reserve study and milestone inspection status. " +
          "Your credit range and intended down payment.",
          "With those we can tell you the ratio your file will actually underwrite to \u2014 on the reset " +
          "tax basis and a real premium, not an estimate \u2014 and whether it clears as structured or needs " +
          "one of the levers above.",
        ],
      },
    ],
    faqs: [
      {
        q: "Why is insurance such a big deal on a Florida DSCR loan?",
        a: "Because it often becomes the largest line in the payment after principal and interest, and " +
          "the payment is the denominator of your ratio. Roof age, wind mitigation credits and the " +
          "percentage hurricane deductible move it more than anything else. Get a bound quote early; " +
          "an estimate carried from another state routinely re-prices a file late.",
      },
      {
        q: "Can I get a DSCR loan on a Florida condo after the new inspection laws?",
        a: "Yes, though the association matters as much as the unit. Milestone inspections, the " +
          "structural integrity reserve study and any special assessment can make a building " +
          "non-warrantable. Non-warrantable condo DSCR programmes exist \u2014 the leverage and pricing " +
          "differ \u2014 so confirm the association\u2019s status before you go under contract.",
      },
      {
        q: "Will my Florida property taxes go up when I buy?",
        a: "Almost certainly. The homestead exemption and the 3% Save Our Homes cap apply only to a " +
          "primary residence, never to a rental, and the assessment resets toward market value on " +
          "transfer. Expect a higher bill than the seller\u2019s, and expect it in your DSCR calculation.",
      },
      {
        q: "Can I qualify on Airbnb income in Florida?",
        a: "Often yes, using twelve months of operating statements or a recognised market-data report " +
          "rather than a long-term rent opinion. The real constraint is local: Florida municipalities " +
          "regulate short-term rental very differently, so confirm the ordinance for that address " +
          "before you rely on STR income to make the ratio.",
      },
      {
        q: "What are doc stamps and intangible tax going to cost me?",
        a: "Documentary stamp tax runs $0.35 per $100 of the amount financed and the intangible tax is " +
          "0.2% of the mortgage. On a $400,000 loan that is roughly $2,200 combined. It does not affect " +
          "your DSCR but it is real cash at closing that out-of-state investors often miss.",
      },
    ],
  },

  "bridge-loans-florida": {
    // 52 chars. "bridge loan florida" is the query (36 impressions); the promise after the colon
    // is the page's real subject — the deals a bank cannot approve YET.
    title: "Florida Bridge Loans: Buy Before You Sell, Fast",
    // 154 chars. The three scenarios the page covers, then the exit — which is the actual worry.
    description:
      "Short-term funding for Florida deals a bank cannot approve yet: aged roofs, non-warrantable " +
      "condos, buying before you sell. We place it and plan your exit.",
    lede:
      "A bridge loan buys you time in Florida \u2014 to close before your sale funds, to take a property " +
      "that will not survive a lender\u2019s condition list today, or to hold a deal while permanent " +
      "financing catches up. Florida makes timing unusually valuable: the buying season is short, the " +
      "insurance and condo rules can stall a conventional approval for weeks, and cash offers dominate " +
      "the good inventory. Here is how bridge financing actually works here, and what it costs.",
    sections: [
      {
        h: "What a bridge loan is, and what it is not",
        body: [
          "A bridge loan is short-term, asset-based capital \u2014 usually six to twenty-four months, " +
          "interest-only, secured by the property and underwritten primarily on the equity and the " +
          "exit rather than on income documentation. It is not a cheaper mortgage. You are buying " +
          "speed and certainty, and paying for them.",
          "That trade is worth making when the alternative is losing the deal. It is a poor trade when " +
          "there is no defined exit, because a bridge with no takeout is just an expensive clock.",
        ],
      },
      {
        h: "The Florida season is the whole reason bridges get used here",
        body: [
          "Florida transacts on a calendar. Snowbird and seasonal buyers arrive from late autumn, the " +
          "market runs hard through spring, and the summer and hurricane months are slower and softer. " +
          "A seller who misses the season often waits for the next one.",
          "That compresses timing in both directions. Buying before your existing property sells is " +
          "frequently the only way to secure inventory in season, and selling into the season rather " +
          "than after it can be worth far more than a few months of bridge interest. Do that arithmetic " +
          "explicitly \u2014 carry cost against the price difference of selling in February versus August.",
        ],
      },
      {
        h: "Insurance and roofs stall conventional approvals, and a bridge steps over that",
        body: [
          "A large share of Florida deals that die do not die on credit \u2014 they die on insurability. An " +
          "aged roof, an open claim, a four-point inspection that surfaces polybutylene plumbing or " +
          "aluminium wiring, or a carrier simply declining the risk will stop a conventional or agency " +
          "approval outright.",
          "Bridge lenders underwrite the asset and the exit, so a property can be acquired on bridge " +
          "financing, the roof replaced or the condition cured, insurance bound properly, and the loan " +
          "refinanced into permanent financing on a clean file. That sequence \u2014 buy, cure, refinance \u2014 " +
          "is the classic legitimate use of bridge money in Florida.",
          "Carry builder\u2019s risk or a vacant-property policy while the work is underway. A standard " +
          "landlord policy generally will not cover a vacant home under renovation, and a gap there is " +
          "an uninsured hurricane exposure.",
        ],
      },
      {
        h: "Condos: the pre-inspection and special-assessment window",
        body: [
          "Florida\u2019s milestone inspection and reserve-study requirements have created a genuine " +
          "financing gap. A building awaiting its inspection, or one that has just levied a large " +
          "special assessment, can be temporarily unfinanceable by agency standards even though the " +
          "individual unit is sound and the price reflects the problem.",
          "Bridge financing is often the only way to transact in that window. The exit is the " +
          "association completing its inspection and funding its reserves, after which the building " +
          "becomes warrantable again and the unit refinances normally. Underwrite the timeline " +
          "honestly \u2014 associations move slowly, and your bridge term needs to outlast the board.",
        ],
      },
      {
        h: "Buying before you sell",
        body: [
          "The classic residential bridge: you have substantial equity in a property you intend to " +
          "sell, and the one you want will not wait. A bridge secured against the departing property, " +
          "or across both, releases that equity as a down payment now and is repaid from the sale.",
          "Two disciplines keep this safe. Price the departing property to actually sell inside your " +
          "bridge term rather than to test the market, and make sure the term has room for a Florida " +
          "closing that slips \u2014 insurance binding, association estoppel letters and permit records " +
          "all routinely add a week or two here.",
        ],
      },
      {
        h: "Fix and flip, and the Florida permitting reality",
        body: [
          "Bridge and fix-and-flip capital overlap heavily: purchase plus rehab, interest-only, exit by " +
          "sale or refinance. What catches out-of-state investors is Florida permitting. County and " +
          "municipal review timelines vary enormously, coastal and historic jurisdictions add layers, " +
          "and work done without a permit surfaces later as an unpermitted-improvement problem that an " +
          "appraiser or a title company will flag.",
          "Build the permit calendar into the loan term rather than the optimistic construction " +
          "schedule. A twelve-month bridge on a six-month renovation is prudent here, not wasteful, " +
          "and hurricane season can idle a site for weeks regardless of your plan.",
        ],
      },
      {
        h: "What it costs, honestly",
        body: [
          "Bridge pricing sits well above permanent financing and is usually quoted as a rate plus " +
          "points, interest-only, with leverage set against value or against total cost on a rehab " +
          "deal. Expect a meaningful origination fee and expect the exit to matter more to the lender " +
          "than your personal income does.",
          "Florida adds its own transaction cost on top: documentary stamp tax of $0.35 per $100 of the " +
          "amount financed, plus 0.2% intangible tax on the mortgage \u2014 and those are charged again when " +
          "you refinance out of the bridge into permanent financing. Budget for paying them twice. It " +
          "is a real argument for getting the bridge term right the first time rather than extending.",
        ],
      },
      {
        h: "The exit is the underwrite",
        body: [
          "Every bridge is approved on how it gets repaid. In Florida the three credible exits are a " +
          "sale, a refinance into a DSCR loan once the property is stabilised and insurable, or a " +
          "refinance into conventional financing once a condition is cured or an association is " +
          "compliant again.",
          "We underwrite the takeout at the same time as the bridge, so the exit is not a hope. If the " +
          "plan is a [DSCR refinance](/lending/dscr-loans-florida), the ratio has to work on the reset tax " +
          "basis and a real insurance " +
          "premium \u2014 not on today\u2019s numbers. A bridge that exits into a ratio that will not clear is a " +
          "problem you have scheduled rather than solved.",
          "If the exit is a commercial takeout — five or more units, or a mixed-use or retail building — " +
          "it is underwritten on coverage against the lease income rather than on a residential ratio. " +
          "See [commercial real estate loans in Florida](/lending/commercial-real-estate-loans-florida).",
        ],
      },
      {
        h: "What we need to size a Florida bridge",
        body: [
          "The property address and current condition, including roof age and any open insurance " +
          "claims. Your purchase price or current value and payoff. The scope and budget if there is " +
          "work. The exit \u2014 sale, DSCR refinance or conventional \u2014 with a realistic date. For a condo, " +
          "the association\u2019s inspection and assessment status. Your entity, and how much you intend to " +
          "put in.",
          "With that we can size the loan, price it, and tell you plainly whether the exit holds up. " +
          "If it does not, we will say so before you are paying interest to find out.",
        ],
      },
    ],
    faqs: [
      {
        q: "How fast can a bridge loan close in Florida?",
        a: "Frequently within a week or two, because approval is driven by the asset, your equity and " +
          "the exit rather than by income documentation. The usual delays here are not underwriting \u2014 " +
          "they are binding insurance and getting an association estoppel letter back.",
      },
      {
        q: "Can I use a bridge loan on a Florida condo that is not warrantable right now?",
        a: "Often yes. A building awaiting its milestone inspection or working through a special " +
          "assessment can be temporarily unfinanceable by agency standards while the unit itself is " +
          "sound. Bridge financing transacts in that window; the exit is a refinance once the " +
          "association is compliant. Make sure the term outlasts the board\u2019s timeline.",
      },
      {
        q: "My roof is too old to insure. Can I still buy the property?",
        a: "That is one of the most common Florida bridge scenarios. Acquire on bridge financing, " +
          "replace the roof, bind proper coverage, then refinance into permanent financing on a clean " +
          "file. Carry builder\u2019s risk or vacant-property coverage during the work \u2014 a landlord policy " +
          "generally will not cover a vacant home under renovation.",
      },
      {
        q: "What does a Florida bridge loan actually cost?",
        a: "Above permanent financing, quoted as a rate plus points and paid interest-only. Florida " +
          "also charges documentary stamp tax of $0.35 per $100 financed and 0.2% intangible tax on " +
          "the mortgage \u2014 and charges them again when you refinance out. Budget for both events.",
      },
      {
        q: "What if my exit does not happen in time?",
        a: "Talk to us early rather than at the maturity date. Extensions exist and usually cost points. " +
          "The better answer is structural: set the term against Florida\u2019s permitting and association " +
          "timelines rather than an optimistic schedule, and price a departing property to sell inside " +
          "the term rather than to test the market.",
      },
    ],
  },
  "commercial-real-estate-loans-florida": {
    // 57 chars. Leads on "Business Property Loans", the phrasing of 4 of the 5 queries in this
    // cluster, and still carries "Commercial Real Estate" for the fifth.
    title: "Florida Business Property & Commercial Real Estate Loans",
    // 151 chars. One claim a searcher would click, not a keyword list.
    description:
      "No lender takes your operating statement as presented. See what Florida commercial " +
      "underwriting changes before your business property deal is sized.",
    lede:
      "A commercial real estate loan in Florida is underwritten against the building first: its leases " +
      "and the income they produce set what a lender will advance and on what structure, and your " +
      "balance sheet stands behind that rather than in place of it. Office, retail, industrial, " +
      "mixed-use, multifamily — investment or owner-user, the business property is the file. Fetti " +
      "Financial Services is a licensed mortgage lender and broker, which on a commercial deal means " +
      "placing your file with the lender whose credit box it genuinely fits, then getting it funded.",
    sections: [
      {
        h: "Which lender your deal belongs to",
        body: [
          "Commercial is not one market. The same Florida business property gets a different answer from " +
          "each kind of desk.",
          "Banks and portfolio lenders keep the loan, so they weight the relationship — deposits, " +
          "liquidity, your record in that submarket — and are the most flexible on an odd building, the " +
          "least forgiving of a thin guarantor. Credit unions are that desk at smaller scale, often patient " +
          "with an owner-user. SBA lenders are owner-user only and underwrite the operating company as hard " +
          "as the real estate. Agency small-balance multifamily programs begin at five units — below that a " +
          "rental is financed as residential investment, usually on a " +
          "[DSCR loan](/lending/dscr-loans-florida). Agency paper is the most " +
          "standardized capital for a stabilized apartment property, the most rigid about anything that is " +
          "not one. Life companies want well-located, well-leased assets and weight the real estate over " +
          "the sponsor. Conduit lenders — CMBS — pool and sell their loans, so the note is standardized, " +
          "commonly non-recourse, and every later request goes to a servicer with no discretion. Debt funds " +
          "are built for speed, underwrite a business plan rather than an operating history, and price " +
          "for that risk.",
          "So ask which side your deal wins on. A property-strong file — stabilized, well leased, " +
          "unremarkable — is what the conservative desks compete for; a debt fund would only sell it " +
          "flexibility it will not use. A sponsor-strong file — a capable operator with a building in " +
          "transition — often needs interim money to get there, which is a " +
          "[bridge loan](/lending/bridge-loans-florida); past that it belongs with a bank that already " +
          "knows you, or a fund willing to underwrite the plan. The wrong desk does not simply " +
          "decline; it declines slowly, after third-party reports you " +
          "already paid for.",
        ],
      },
      {
        h: "Structure decides more than pricing does",
        body: [
          "The first difference between two files quoted alike is recourse. On a recourse loan the " +
          "guarantors stand behind the debt personally; on a non-recourse loan the lender's remedy is the " +
          "property — but non-recourse is never absolute. Every non-recourse note carries bad-boy " +
          "carve-outs: fraud, misapplying rents or insurance proceeds, transferring or further encumbering " +
          "the property without consent, environmental misstatement, often a voluntary bankruptcy. Trip one " +
          "and the loss, sometimes the whole debt, becomes personally recourse. Read that schedule as " +
          "closely as the pricing, and read who is named on it: carve-outs follow the signature, not the " +
          "entity.",
          "The second is maturity. A commercial note's amortization schedule commonly runs far longer than " +
          "the note itself, so a balance comes due at maturity by design, not as a defect. Your hold plan " +
          "and your maturity are one conversation: a plan running through a lease-up or a repositioning " +
          "needs a maturity with room to reach the other side of it, because refinancing into whatever " +
          "market exists on that date is the risk the structure hands you.",
          "The third is what leaving early costs, and commercial notes penalize prepayment by structure " +
          "rather than a flat fee. A step-down declines as the loan seasons. Yield maintenance makes the " +
          "lender whole for the income it expected. Defeasance, standard on conduit paper, swaps securities " +
          "in for the collateral so the payments continue without you — its own transaction, with its own " +
          "cost and calendar. Some structures instead let a buyer assume the loan — on the right sale, " +
          "worth more than any of it. Structure, not pricing, decides whether you can sell in year three of " +
          "a hold, so ask for that language at term sheet, not at closing.",
        ],
      },
      {
        h: "What a lender does to your operating statement",
        body: [
          "Coverage measures annual net operating income — rent less vacancy and the real cost of running " +
          "the building, before debt service and capital projects — against annual debt service. No lender " +
          "takes your NOI as presented. Underwriting applies a vacancy factor to a fully leased building, " +
          "charges a management fee where you self-manage and take none, deducts a replacement reserve " +
          "whether or not you fund one, and pulls light expense lines toward market. The gap between your " +
          "NOI and the lender's is the deal.",
          "Which period gets normalized is worth arguing about on a Florida asset. A trailing twelve that " +
          "catches a strong season and misses a soft one flatters a seasonal asset; one that " +
          "straddles a storm that interrupted its tenants understates the same building. Expect a " +
          "multi-year average, or a trailing three annualized where recent months are the real story.",
          "The leases behind that income are read just as hard: the lender is buying the rent roll as much " +
          "as the building. Triple net, modified gross and full service divide taxes, insurance and common " +
          "area maintenance very differently, so two buildings with identical rent rolls are not the same " +
          "asset when one passes those lines through and the other absorbs them. A lease expiring early in " +
          "the loan's life is the risk it looks like, and one tenant paying most of the rent is a different " +
          "credit from eight each paying a share.",
        ],
      },
      {
        h: "An owner-user file underwrites twice",
        body: [
          "Owner-occupied here means your company occupies the space. It is business-purpose credit, not a " +
          "consumer mortgage, and it is underwritten twice: once as real estate, once as the business that " +
          "pays the rent. Expect a global cash flow review — business returns and interim statements " +
          "alongside the property file, the rent your company would pay itself eliminated so it is not " +
          "counted twice, and whatever remains has to service the debt. A company with real earnings can " +
          "support a building that market rent alone would not; one thin year can sink a clean property.",
          "If your company will occupy at least 51% of the space, SBA 7(a) and 504 are available to " +
          "owner-users. The trade is process: an SBA file asks for more documentation and a longer calendar " +
          "than conventional commercial credit. If your closing date is tight, say so before the file is " +
          "placed.",
        ],
      },
      {
        h: "Florida tax lines your projection has to carry",
        body: [
          "Property taxes are the line most commercial projections carry over from the seller unchanged, " +
          "and it is the one least likely to survive the sale. Florida assessments reset toward market " +
          "value when a property changes hands, and the year-over-year cap that limited the seller's " +
          "increases resets with the transfer — so the assessment behind the operating statement you were " +
          "handed is not the assessment behind your first bill. Underwrite the reset, and confirm the " +
          "mechanics for your parcel with the county property appraiser rather than working from the " +
          "current bill.",
          "Then read the non-ad-valorem section of that bill separately from the millage. Drainage, fire, " +
          "lighting and community development district assessments are billed there, and on a commercial " +
          "deal the question is rarely how large they are — it is whose expense they become. A triple net " +
          "lease passing through “real property taxes” does not automatically reach a district assessment " +
          "or a special levy: some leases name them, some carve out anything capital in nature, and some " +
          "are silent. Silence is how a landlord ends up absorbing a line he underwrote as a pass-through. " +
          "Test each lease's clause against the actual bill before you close.",
          "Where the pass-through does reach them, that cost lands on tenants who agreed their rent before " +
          "the sale — which makes it a renewal risk, and your lender prices renewal risk. Florida also " +
          "applies its own treatment to rent paid for commercial space, and the rules there have moved more " +
          "than once in recent years; confirm the current position with your CPA or the Department of " +
          "Revenue for the periods you are underwriting rather than carrying a figure across from an older " +
          "deal.",
        ],
      },
      {
        h: "Insurance is an underwriting input, not a closing errand",
        body: [
          "A commercial property policy is written against total insured value, and the named-storm " +
          "deductible is generally a share of that value rather than a flat sum, so it scales with the " +
          "building. Lenders read the coinsurance clause closely — an agreed-value endorsement is the usual " +
          "way that penalty comes off the table — and they require business income or loss-of-rents " +
          "coverage with an indemnity period long enough to carry debt service through the months a damaged " +
          "building earns nothing.",
          "On the binder they want the named insured matching the entity taking title, the mortgagee " +
          "clause, the deductible stated as its percentage, and the business income limit with its " +
          "indemnity period. Work those with a licensed Florida commercial agent early: the premium you " +
          "land on lands in operating expenses, operating expenses set NOI, and NOI is what the debt is " +
          "measured against.",
        ],
      },
      {
        h: "The closing package, grouped by who has to produce it",
        body: [
          "Most delay on a commercial file is documentary, and these items do not arrive at the same speed. " +
          "Start the slow ones the week you go under contract.",
          "You produce: the entity taking title and its ownership breakdown, matching the name on the " +
          "purchase contract; a personal financial statement and schedule of real estate owned for each " +
          "guarantor; business returns and an interim profit and loss if the business will occupy the " +
          "building; and the equity you are bringing.",
          "The seller produces: operating statements for the recent full years plus a current-year interim; " +
          "the rent roll (tenant, term dates, base rent, escalations, options); every executed lease and " +
          "amendment; service contracts; and the complete tax bill including its non-ad-valorem section.",
          "The tenants produce the slowest items — estoppel certificates confirming their terms are what " +
          "you say they are, and, where the lender requires them, subordination, non-disturbance and " +
          "attornment agreements. Both come through the seller, and the signers have no reason to hurry.",
          "The association produces, on a condominium unit or inside an owners' association (common in " +
          "office and retail parks): declaration, budget, reserve position, master insurance certificate, " +
          "assessment history, and any reciprocal easement governing parking, access and signage.",
          "The lender orders, at your expense: the appraisal, an income-approach second opinion on your own " +
          "operating statement; a Phase I environmental site assessment; an ALTA survey; and on many assets " +
          "a property condition assessment. Environmental most often moves the closing date — Florida's " +
          "commercial sites often carry a prior-use history — fueling, dry cleaning, automotive service — " +
          "and a recognized condition escalates a Phase I into a Phase II, a new scope of work with its own " +
          "vendor and calendar.",
          "All financing is subject to the lender's underwriting and approval. Not all applicants or " +
          "properties qualify.",
        ],
      },
    ],
    faqs: [
      {
        q: "My building has six units — is that a commercial loan or a rental property loan?",
        a:
          "It turns on how the lender classifies the collateral. By convention one to four units is " +
          "residential collateral financed from a lease and a rent figure; anything larger is underwritten " +
          "from the property's own operating statements. Six units generally lands on the commercial side, " +
          "which changes the document package more than your eligibility.",
      },
      {
        q: "The property is vacant or only partly leased. Can it still be financed?",
        a:
          "It underwrites differently. With little in-place income there is no operating statement to " +
          "normalize, so the file moves onto the sponsor, the equity and a lease-up plan tested against " +
          "real market rents and leasing costs — and the lenders who do that work are a narrower group. " +
          "Bring signed letters of intent and a defensible leasing budget.",
      },
      {
        q: "Does a commercial mortgage show up on my personal credit report?",
        a:
          "Usually not directly: title is typically held in an entity, and business-purpose credit is " +
          "generally not furnished to the consumer bureaus. A personal guaranty is still a real obligation " +
          "— you disclose it on your personal financial statement, and the next lender counts it in global " +
          "cash flow.",
      },
    ],
  },
};

export function deepContentFor(slug: string): DeepContent | null {
  return DEEP_CONTENT[slug] || null;
}
