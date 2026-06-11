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
  dscr: {
    slug: "dscr",
    badge: "Nationwide · Investment property",
    headline: "DSCR loans — qualify on the rental income,",
    accent: "not your tax returns.",
    subhead: "Buy or refinance 1–4 unit rentals on the property's cash flow. No W-2, no DTI, close in an LLC. We're a lender and a broker — we fund it ourselves or shop dozens of lenders for your best fit.",
    bullets: ["⚡ Pre-qualify in 2 minutes — no credit pull to start", "🏢 1–4 units, nationwide. Close in your LLC.", "🛡️ Built by people who've scaled real companies. No games."],
    occupancy: "Investor", productType: "Investment",
    purposes: [{ value: "purchase", label: "Purchase", loanPurpose: "DSCR Purchase" }, { value: "refi", label: "Refinance / cash-out", loanPurpose: "DSCR Refinance" }],
    markLine: "Qualify on the property, not your paperwork. I'll find your money. — Mark 🦉",
  },
  "dscr-refi": {
    slug: "dscr-refi",
    badge: "Investors · Cash-out your rentals",
    headline: "DSCR refinance —",
    accent: "pull cash from your rentals.",
    subhead: "Lower your rate or pull equity out of your investment properties to fund your next deal — qualifying on the property's cash flow, not your tax returns. Close in an LLC, nationwide.",
    bullets: ["💵 Cash-out to scale your portfolio", "⚡ Qualify on rental income — no tax returns", "🛡️ Lender + broker — we shop dozens of lenders for your best terms"],
    occupancy: "Investor", productType: "Investment",
    purposes: [{ value: "cashout", label: "Cash-out refinance", loanPurpose: "DSCR Cash-Out Refinance" }, { value: "rate", label: "Rate & term refinance", loanPurpose: "DSCR Refinance" }],
    statesNote: "Investment property loans available in all 50 states.",
    markLine: "Equity sitting in your rentals? Let's free it up and go again. — Mark 🦉",
  },
  refinance: {
    slug: "refinance",
    badge: "Homeowners · Refinance",
    headline: "Refinance —",
    accent: "lower your rate or tap your equity.",
    subhead: "Cut your monthly payment, shorten your term, or pull cash out. We're a lender and a broker, so we shop the whole market to find your best refinance — not a single bank's menu.",
    bullets: ["💵 Lower payment, shorter term, or cash out", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ Lender + broker — your best option, not a bank's quota"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "rate", label: "Lower my rate / payment", loanPurpose: "Rate-and-Term Refinance" }, { value: "cashout", label: "Cash-out refinance", loanPurpose: "Cash-Out Refinance" }],
    statesNote: "Owner-occupied loans offered in FL, MI & CA. Investment refi: all 50 states.",
    markLine: "Right loan, lower payment. I'll shop the whole market for you. — Mark 🦉",
  },
  "cash-out-refi": {
    slug: "cash-out-refi",
    badge: "Homeowners · Tap your equity",
    headline: "Cash-out refinance —",
    accent: "turn your equity into cash.",
    subhead: "Use the equity you've built for renovations, debt payoff, or your next investment. We're a lender and a broker, so we shop the whole market for your best terms.",
    bullets: ["💵 Pull cash from your home's equity", "⚡ Pre-qualify in 2 minutes — no credit pull to start", "🛡️ Lender + broker — your best option, not a bank's quota"],
    occupancy: "Owner", productType: "Residential",
    purposes: [{ value: "refi", label: "Cash-out refinance", loanPurpose: "Cash-Out Refinance" }],
    statesNote: "Owner-occupied loans offered in FL, MI & CA. Investment cash-out: all 50 states.",
    markLine: "Your equity is just money waiting. Let's put it to work. — Mark 🦉",
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
    markLine: "Move fast, fund faster. I've got the capital for your flip. — Mark 🦉",
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
    markLine: "Real income, real loan. No tax-return games. — Mark 🦉",
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
    markLine: "First home? Eyes open — I'll guide you the whole way. — Mark 🦉",
  },
};

export const LP_SLUGS = Object.keys(LP_CONFIGS);
