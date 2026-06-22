// Paid landing-page configs. One message-matched LP per product so each ad angle
// gets its own high-converting destination (/lp/<slug>). Add a product here and
// the page + tracked lead capture come for free.
export type LpPurpose = { value: string; label: string; loanPurpose: string };
export type LpConfig = {
  slug: string;
  badge: string;
  headline: string;      // first part
  accent: string;        // emphasized tail (emerald)
  subhead: string;
  bullets: string[];     // emoji-prefixed
  occupancy: string;     // Investor | Owner
  productType: string;   // Investment | Residential
  purposes: LpPurpose[]; // selector shown if >1
  statesNote?: string;
  markLine: string;      // Mark's one-liner
};

export const LP_CONFIGS: Record<string, LpConfig> = {
  // Sponsorship capture page for "The Lot" (YouTube show). Broad, approachable
  // — the audience isn't only investors. Host reads fettifi.com/tv → here.
  tv: {
    slug: "tv",
    badge: "As seen on The Lot 🎬",
    headline: "You watch The Lot.",
    accent: "Now let's get you the money.",
    subhead: "Buying a home, lowering your payment, or grabbing an investment property? Fetti is your mortgage solutions specialist — we've got the capital and the programs to get your deal done. No stress, no runaround.",
    bullets: ["⚡ See what you qualify for in 2 minutes — no credit pull to start", "🏠 Home loans & refis (CA/FL/MI) · investment property nationwide", "🦉 Straight answers from Mark and the Fetti team. We do money."],
    occupancy: "Owner", productType: "Residential",
    purposes: [
      { value: "purchase", label: "Buy a home", loanPurpose: "Purchase" },
      { value: "refi", label: "Refinance / lower my payment", loanPurpose: "Rate-and-Term Refinance" },
      { value: "investor", label: "Investment property", loanPurpose: "DSCR Purchase" },
    ],
    statesNote: "Owner-occupied loans in CA, FL & MI. Investment property: all 50 states.",
    markLine: "You found me on The Lot. Here's how we get you the money — start in about 2 minutes. — Mark 🦉",
  },
  dscr: {
    slug: "dscr",
    badge: "Nationwide · Investment property",
    headline: "DSCR loans — qualify on the rental income,",
    accent: "not your tax returns.",
    subhead: "Buy or refinance 1–4 unit rentals on the property's cash flow. No W-2, no DTI, close in an LLC. As your solutions specialist, we fund it ourselves or tap dozens of lenders for your best fit.",
    bullets: ["⚡ Pre-qualify in 2 minutes — no credit pull to start", "🏢 1–4 units, nationwide. Close in your LLC.", "🛡️ Built by people who've scaled real companies. No games."],
    occupancy: "Investor", productType: "Investment",
    purposes: [{ value: "purchase", label: "Purchase", loanPurpose: "DSCR Purchase" }, { value: "refi", label: "Refinance / cash-out", loanPurpose: "DSCR Refinance" }],
    markLine: "Here's the move: qualify on the rent, not your tax returns. Start in 2 minutes. — Mark 🦉",
  },
  "dscr-refi": {
    slug: "dscr-refi",
    badge: "Investors · Cash-out your rentals",
    headline: "DSCR refinance —",
    accent: "pull cash from your rentals.",
    subhead: "Lower your rate or pull equity out of your investment properties to fund your next deal — qualifying on the property's cash flow, not your tax returns. Close in an LLC, nationwide.",
    bullets: ["💵 Cash-out to scale your portfolio", "⚡ Qualify on rental income — no tax returns", "🛡️ Solutions specialist — we tap dozens of lenders for your best terms"],
    occupancy: "Investor", productType: "Investment",
    purposes: [{ value: "cashout", label: "Cash-out refinance", loanPurpose: "DSCR Cash-Out Refinance" }, { value: "rate", label: "Rate & term refinance", loanPurpose: "DSCR Refinance" }],
    statesNote: "Investment property loans available in all 50 states.",
    markLine: "Your rentals are holding equity — pull it out on the property's income. Start today. — Mark 🦉",
  },
  refinance: {
    slug: "refinance",
    badge: "Homeowners · Refinance",
    headline: "Refinance —",
    accent: "lower your rate or tap your equity.",
    subhead: "Cut your monthly payment, shorten your term, or pull cash out. As your solutions specialist, we shop the whole market for your best refinance — not a single bank's menu.",
    bullets: ["💵 Lower payment, shorter term, or cash out", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ Solutions specialist — your best option, not a bank's quota"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "rate", label: "Lower my rate / payment", loanPurpose: "Rate-and-Term Refinance" }, { value: "cashout", label: "Cash-out refinance", loanPurpose: "Cash-Out Refinance" }],
    statesNote: "Owner-occupied loans offered in FL, MI & CA. Investment refi: all 50 states.",
    markLine: "Lower your payment by shopping the whole market, not one bank. See it in 2 minutes. — Mark 🦉",
  },
  "cash-out-refi": {
    slug: "cash-out-refi",
    badge: "Homeowners · Tap your equity",
    headline: "Cash-out refinance —",
    accent: "turn your equity into cash.",
    subhead: "Use the equity you've built for renovations, debt payoff, or your next investment. As your solutions specialist, we shop the whole market for your best terms.",
    bullets: ["💵 Pull cash from your home's equity", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ Solutions specialist — your best option, not a bank's quota"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "refi", label: "Cash-out refinance", loanPurpose: "Cash-Out Refinance" }],
    statesNote: "Owner-occupied loans offered in FL, MI & CA. Investment cash-out: all 50 states.",
    markLine: "Turn your home equity into cash for your next move. Get your number now. — Mark 🦉",
  },
  "fix-and-flip": {
    slug: "fix-and-flip",
    badge: "Investors · Fix & Flip",
    headline: "Fund your flip —",
    accent: "purchase + rehab, fast.",
    subhead: "Move quick on competitive deals with purchase-plus-rehab financing. Interest-only during the project, fast closings, experienced and first-time flippers welcome.",
    bullets: ["⚡ Up to ~90% of purchase + rehab", "🏢 Fast closings to win competitive offers", "🛡️ Interest-only during the project"],
    occupancy: "Investor", productType: "Investment",
    purposes: [{ value: "purchase", label: "Fix & flip purchase", loanPurpose: "Fix and Flip" }],
    markLine: "Fund the flip on the deal, not your DTI — we've got the capital. Start your file. — Mark 🦉",
  },
  "bank-statement": {
    slug: "bank-statement",
    badge: "Self-employed · Business owners",
    headline: "Self-employed? Qualify on",
    accent: "bank statements, not tax returns.",
    subhead: "Your tax returns don't show your real income — so we don't use them. Qualify on 12–24 months of bank deposits. Built by entrepreneurs who get it.",
    bullets: ["💵 Qualify on bank deposits, no tax returns", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ We speak entrepreneur because we are one"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "purchase", label: "Purchase", loanPurpose: "Bank Statement Purchase" }, { value: "refi", label: "Refinance", loanPurpose: "Bank Statement Refinance" }],
    statesNote: "Owner-occupied loans offered in FL, MI & CA. Investment: all 50 states.",
    markLine: "Self-employed? We use your bank deposits, not tax returns. Get pre-qualified now. — Mark 🦉",
  },
  "first-time-buyer": {
    slug: "first-time-buyer",
    badge: "First-time buyers · FL, MI & CA",
    headline: "Buy your first home —",
    accent: "we make it simple.",
    subhead: "Low-down-payment options, first-time buyer programs, and down payment assistance. We carry the load so the biggest purchase of your life feels handled.",
    bullets: ["🏡 FHA from 3.5% down · VA/USDA $0 down options", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ A real specialist, start to funded"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "purchase", label: "Home purchase", loanPurpose: "Home Purchase" }],
    statesNote: "Owner-occupied home loans offered in FL, MI & CA.",
    markLine: "First home? Here's exactly how to start — pre-qualify in 2 minutes, no credit pull. — Mark 🦉",
  },
};

export const LP_SLUGS = Object.keys(LP_CONFIGS);
