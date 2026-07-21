"use client";

// Conversational application wizard. Two arcs:
//   1) QUALIFY. A few intuitive, branching questions route to the right product
//      from Fetti's full catalog, then we capture contact and CREATE the lead
//      immediately (speed-to-lead is preserved even if they stop here).
//   2) APPLICATION (1003). Framed as "lock in your pre-approval," we quietly
//      collect the rest of a complete Uniform Residential Loan Application
//      (URLA / Form 1003): borrower, residence, employment & income, assets,
//      declarations, property. Each answer UPDATES the same lead (dedup-merge).
// Occupancy is authoritative: if the borrower won't live there, it's an
// investment loan. That drives product selection AND licensing (investment /
// business loans are available in all 50 states; owner-occupied only FL/MI/CA).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, ShieldCheck, Lightbulb } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";
import { trackLead, trackApplication } from "@/lib/track";
import { armFormShield, shieldFields, shouldTrack } from "@/lib/formShield";
import { getAttribution } from "@/lib/attribution";
import AddressInput from "@/components/AddressInput";
import { CediBubble } from "@/components/CediBubble";
import CurrencyInput from "@/components/ui/CurrencyInput";

type Opt = { value: string; label: string; emoji?: string; hint?: string };
type Q =
  | { id: string; kind: "select"; prompt: string; sub?: string; options: Opt[] }
  | { id: string; kind: "number" | "text" | "date" | "address"; prompt: string; sub?: string; placeholder?: string; optional?: boolean };

type Answers = Record<string, string>;

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];
const CREDIT: Opt[] = [
  { value: "760", label: "Excellent (740+)" },
  { value: "720", label: "Good (700-739)" },
  { value: "680", label: "Fair (660-699)" },
  { value: "640", label: "Building (620-659)" },
  { value: "600", label: "Below 620" },
  { value: "0", label: "Not sure" },
];

const GOAL: Q = {
  id: "goal",
  kind: "select",
  prompt: "What are you looking to do?",
  sub: "We'll tailor everything to your goal.",
  options: [
    { value: "buy", label: "Buy a home", emoji: "🏠", hint: "A place to live" },
    { value: "refi", label: "Refinance", emoji: "🔄", hint: "Lower my rate or take cash out" },
    { value: "invest", label: "Invest in real estate", emoji: "📈", hint: "Rental / DSCR" },
    { value: "flip", label: "Flip, rehab or build", emoji: "🔨", hint: "Fix & flip, construction, bridge" },
    { value: "equity", label: "Tap my home equity", emoji: "💰", hint: "HELOC or 2nd mortgage" },
    { value: "business", label: "Business / commercial", emoji: "🏢", hint: "Commercial RE, SBA, capital" },
    { value: "reverse", label: "Reverse mortgage", emoji: "🏡", hint: "Access equity (age 62+)" },
  ],
};

// Per-goal QUALIFY follow-ups. Kept short to stay engaging.
const FLOWS: Record<string, Q[]> = {
  buy: [
    { id: "occupancy", kind: "select", prompt: "Will you live there?", sub: "This is the single biggest factor in your options.", options: [
      { value: "Owner", label: "Yes. My primary home", emoji: "🏠" },
      { value: "Second Home", label: "It's a second / vacation home", emoji: "🌴" },
      { value: "Investor", label: "No. It's an investment", emoji: "📈", hint: "Rental income property" },
    ] },
    { id: "military", kind: "select", prompt: "Are you a veteran or active military?", sub: "You may qualify for a $0-down VA loan.", options: [
      { value: "yes", label: "Yes", emoji: "🎖️" }, { value: "no", label: "No", emoji: "🙂" },
    ] },
    { id: "firsttime", kind: "select", prompt: "Is this your first home purchase?", options: [
      { value: "yes", label: "Yes. First time", emoji: "✨" }, { value: "no", label: "I've owned before", emoji: "🔑" },
    ] },
    { id: "down", kind: "select", prompt: "How much can you put down?", sub: "Little saved? You may qualify for down payment assistance.", options: [
      { value: "lt3", label: "Little to none", hint: "FHA/VA/USDA + down payment assistance" },
      { value: "3to10", label: "3-10%", hint: "Assistance programs may help" }, { value: "10to20", label: "10-20%" }, { value: "20p", label: "20%+" },
    ] },
    { id: "property_value", kind: "number", prompt: "About what price range?", sub: "A rough number is fine.", placeholder: "Home price ($)" },
  ],
  refi: [
    { id: "refi_goal", kind: "select", prompt: "What's the goal of your refinance?", options: [
      { value: "rate", label: "Lower my rate/payment", emoji: "📉" },
      { value: "cash", label: "Take cash out", emoji: "💵" },
      { value: "both", label: "Both", emoji: "✅" },
    ] },
    { id: "current_loan", kind: "select", prompt: "What kind of loan do you have now?", options: [
      { value: "FHA", label: "FHA" }, { value: "VA", label: "VA" }, { value: "Conventional", label: "Conventional" }, { value: "unsure", label: "Not sure" },
    ] },
    { id: "occupancy", kind: "select", prompt: "Is this your primary home or an investment?", options: [
      { value: "Owner", label: "Primary home", emoji: "🏠" },
      { value: "Second Home", label: "Second / vacation home", emoji: "🌴" },
      { value: "Investor", label: "Investment property", emoji: "📈" },
    ] },
    { id: "property_value", kind: "number", prompt: "What's the home worth today?", placeholder: "Estimated value ($)" },
  ],
  invest: [
    { id: "invest_action", kind: "select", prompt: "Buying a new one or refinancing one you own?", options: [
      { value: "purchase", label: "Buying", emoji: "🛒" }, { value: "refi", label: "Refinancing", emoji: "🔄" }, { value: "cashout", label: "Cash-out refi", emoji: "💵" },
    ] },
    { id: "rental_type", kind: "select", prompt: "How will it be rented?", options: [
      { value: "ltr", label: "Long-term rental", emoji: "🏘️" }, { value: "str", label: "Short-term / Airbnb", emoji: "🏖️" }, { value: "none", label: "Not rented yet", emoji: "🤷" },
    ] },
    { id: "prop_type", kind: "select", prompt: "What type of property?", options: [
      { value: "SFR", label: "Single-family" }, { value: "2-4 Unit", label: "2-4 units" }, { value: "Multifamily", label: "5+ units" }, { value: "Condo", label: "Condo / townhome" },
    ] },
    { id: "property_value", kind: "number", prompt: "Roughly what's the purchase price or value?", placeholder: "Price / value ($)" },
  ],
  flip: [
    { id: "flip_type", kind: "select", prompt: "What's the project?", options: [
      { value: "Fix and Flip", label: "Fix & flip", emoji: "🔨" }, { value: "Rehab", label: "Rehab to rent", emoji: "🧰" },
      { value: "Construction", label: "Ground-up build", emoji: "🏗️" }, { value: "Bridge", label: "Bridge / buy-before-sell", emoji: "🌉" },
    ] },
    { id: "experience", kind: "select", prompt: "How many projects have you done?", options: [
      { value: "0", label: "This is my first", emoji: "🌱" }, { value: "1-4", label: "A few (1-4)", emoji: "👍" }, { value: "5+", label: "I'm seasoned (5+)", emoji: "🚀" },
    ] },
    { id: "property_value", kind: "number", prompt: "Purchase price of the property?", placeholder: "Purchase price ($)" },
    { id: "loan_amount_requested", kind: "number", prompt: "Estimated rehab / build budget?", sub: "Ballpark is fine.", placeholder: "Rehab budget ($)" },
  ],
  equity: [
    { id: "equity_occupancy", kind: "select", prompt: "Is this your home or a rental you own?", options: [
      { value: "Owner", label: "My home", emoji: "🏠" }, { value: "Investor", label: "A rental / investment", emoji: "📈" },
    ] },
    { id: "equity_type", kind: "select", prompt: "How do you want to access your equity?", options: [
      { value: "HELOC", label: "A line of credit (HELOC)", emoji: "💳" }, { value: "Home Equity Loan", label: "A lump sum", emoji: "💰" }, { value: "unsure", label: "Whichever is best", emoji: "🤔" },
    ] },
    { id: "property_value", kind: "number", prompt: "What's your home worth?", placeholder: "Home value ($)" },
    { id: "loan_amount_requested", kind: "number", prompt: "About how much do you owe on it?", placeholder: "Mortgage balance ($)" },
  ],
  business: [
    { id: "biz_type", kind: "select", prompt: "What kind of financing?", options: [
      { value: "Commercial Real Estate", label: "Commercial property", emoji: "🏢" },
      { value: "SBA Loan", label: "SBA loan", emoji: "🏛️" },
      { value: "Working Capital", label: "Working capital", emoji: "💵" },
      { value: "Equipment", label: "Equipment financing", emoji: "🚜" },
    ] },
    { id: "loan_amount_requested", kind: "number", prompt: "How much are you looking for?", placeholder: "Loan amount ($)" },
  ],
  reverse: [
    { id: "age62", kind: "select", prompt: "Are you 62 or older?", sub: "Reverse mortgages require age 62+.", options: [
      { value: "yes", label: "Yes", emoji: "✅" }, { value: "no", label: "Not yet", emoji: "🙂" },
    ] },
    { id: "property_value", kind: "number", prompt: "What's your home worth?", placeholder: "Home value ($)" },
  ],
};

const CONSUMER_GOALS = ["buy", "refi", "equity", "reverse"];
const CREDIT_Q: Q = { id: "credit", kind: "select", prompt: "Roughly, how's your credit?", sub: "An estimate is fine. No credit pull to get started.", options: CREDIT };

// ---- Objection handling -----------------------------------------------------
// When a borrower picks an answer that often makes people feel disqualified, we
// don't let them stall. We coach them with an alternative strategy and keep them
// moving. These defaults are the floor; the Application Coach LEARNS better copy
// per obstacle from real drop-off and overrides them via config.rebuttals.
const DEFAULT_REBUTTALS: Record<string, string> = {
  low_credit: "Credit under 620 is very workable. FHA goes to 580 and we have flexible programs. Plenty of clients raise their score fast once we show them how. Let's keep going and I'll find real options for you. 💪",
  building_credit: "Scores in the 620s open up plenty of programs. This won't hold you back. Let's keep going.",
  low_down: "Little to put down? No problem. FHA needs just 3.5%, VA/USDA can be $0, and you may qualify for down payment assistance. Let's find what fits. 🙌",
  self_employed: "Self-employed? We have bank-statement and P&L programs. No tax returns required. You're in great company here.",
  past_bk_fc: "A past bankruptcy or foreclosure doesn't disqualify you. There are seasoning windows and non-QM paths. Let's map your timeline together.",
  first_flip: "First project? We fund first-time investors with the right deal and a solid plan. Let's structure it together. 🚀",
  // Investor/DSCR path (Fetti's biggest paid segment) had no coaching, so first-time
  // investors stalled here — the #1 reason the wizard's investor goal under-converts.
  dscr_not_rented: "Not rented yet? That's completely fine. DSCR loans qualify on the property's market rent — an appraiser's rent estimate does the job, so you don't need a signed lease or a tenant in place to get started. Let's keep going. 🏠",
  not_62: "Not 62 yet? A HELOC or cash-out refinance can unlock your equity now. Let's look at those instead.",
  high_balance: "Owe a lot relative to the value? There are still options. And improving your equity is a strategy we can plan toward. Let's keep going.",
  // Refi was the one major goal with NO coaching beat, and wizard_insights flagged
  // it as the weakest for contact conversion. This encouraging floor keeps refi
  // starters moving; refiMessage() tailors it by their stated refi goal.
  refi_start: "Refinancing is worth a real look. Depending on your goal we can target a lower payment, cash for renovations or debt payoff, dropping mortgage insurance, or a shorter term. Let's find the angle that pays off for you. 🔄",
};

// The "little to nothing down" objection is the buy flow's weakest point (it
// converts ~50%). The generic "FHA/VA/USDA" floor ignores what we JUST learned
// two questions earlier — whether they're a veteran or a first-time buyer. Speak
// to the specific door already open to them and the rebuttal lands far harder.
// (A learned config override, if present, still wins over this.)
function lowDownMessage(a: Answers): string {
  if (a.military === "yes")
    return "Here's the good news: as a veteran you may qualify for a $0-down VA loan. Little to put down is exactly who this is built for. Let's confirm what you've earned. 🎖️";
  if (a.firsttime === "yes")
    return "First-time buyers get the most help here. Conventional loans go as low as 3% down, down payment assistance grants can cover much of the rest, and a gift from family can fund the whole thing. Little saved is a starting line, not a wall. Let's keep going. 🙌";
  return "Little to put down? That's one of the easiest things to solve. FHA needs just 3.5%, that down payment can come entirely from a family gift, and assistance programs can cover much of the rest. Let's find the program that fits you. 🙌";
}

// Refinancers march through four dry questions with no warmth — the same spot
// where buy gets low_down and invest gets dscr_not_rented. A goal-specific beat
// right after they state their refi goal keeps them engaged. Honest, non-
// promissory copy (no rate/APR or guaranteed-savings claims — Reg Z safe); a
// learned config override still wins over this.
function refiMessage(a: Answers): string {
  if (a.refi_goal === "cash")
    return "Cash-out is one of the most common reasons people refinance — tapping your equity for renovations, debt payoff, or your next investment is very doable. Let's see how much you could put to work. 💵";
  if (a.refi_goal === "both")
    return "Lowering your payment and taking cash out can happen in one loan. Let's structure it so it works on both fronts. ✅";
  // "rate" or anything else → payment/term/mortgage-insurance angles.
  return "Smart to check. A refinance can be about a lower payment, a shorter term, or dropping mortgage insurance you no longer need — and if today isn't the right moment, we'll tell you straight and map when to strike. Let's see your options. 📉";
}

// Returns an obstacle key if this answer is a known friction point, else null.
function detectObstacle(id: string, value: string, a: Answers): string | null {
  // Every refinancer gets one encouraging beat right after stating their goal.
  if (id === "refi_goal") return "refi_start";
  if (id === "credit" && value === "600") return "low_credit";
  if (id === "credit" && value === "640") return "building_credit";
  if (id === "down" && value === "lt3") return "low_down";
  if (id === "employment_status" && value === "Self-Employed") return "self_employed";
  if (id === "bk_fc" && value === "yes") return "past_bk_fc";
  if (id === "experience" && value === "0") return "first_flip";
  // DSCR investor picking "Not rented yet" is the biggest first-DSCR stall — reassure
  // that market rent (not a signed lease) qualifies the loan, and keep them moving.
  if (id === "rental_type" && value === "none") return "dscr_not_rented";
  if (id === "age62" && value === "no") return "not_62";
  // Low-equity refinance/equity: owe >= 85% of value.
  if (id === "loan_amount_requested" && a.property_value && Number(value) >= 0.85 * Number(a.property_value)) return "high_balance";
  return null;
}

// ---- Occupancy is authoritative ---------------------------------------------
// Resolve the borrower's intended occupancy from whichever question captured it,
// defaulting sensibly per goal. This decides investment-vs-consumer everywhere.
function effectiveOccupancy(a: Answers): string {
  if (a.occupancy) return a.occupancy;
  if (a.equity_occupancy) return a.equity_occupancy;
  switch (a.goal) {
    case "invest":
    case "flip": return "Investor";
    case "business": return "Investment/Commercial";
    case "reverse": return "Owner"; // HECM must be primary residence
    case "equity": return "Owner";
    default: return "";
  }
}
function isInvestment(a: Answers): boolean {
  const o = effectiveOccupancy(a);
  return o === "Investor" || o === "Investment/Commercial";
}
// Consumer (owner-occupied) loans are licensed FL/MI/CA only. Anything the
// borrower won't live in is investment/business. Available in all 50 states.
function isConsumer(a: Answers): boolean {
  return CONSUMER_GOALS.includes(a.goal) && !isInvestment(a);
}

// Map answers -> a specific product from the Fetti catalog. Occupancy leads.
function product(a: Answers): string {
  const g = a.goal;
  const investor = isInvestment(a);
  const big = a.property_value && Number(a.property_value) >= 1000000;
  if (g === "buy") {
    if (investor) return a.rental_type === "str" ? "Short-Term Rental (Airbnb) DSCR" : "DSCR Purchase";
    let base: string;
    if (a.military === "yes") base = "VA Purchase";
    else if (a.down === "lt3") base = "FHA Purchase";
    else if (big) base = "Jumbo Purchase";
    else if (a.firsttime === "yes") base = "First-Time Homebuyer (Conventional)";
    else base = "Conventional Purchase";
    // Down payment assistance pairs with FHA/Conventional owner-occupied loans.
    if (a.dpa === "yes" && /FHA|Conventional|First-Time/.test(base)) base += " + Down Payment Assistance";
    return base;
  }
  if (g === "refi") {
    if (investor) return a.refi_goal === "cash" || a.refi_goal === "both" ? "DSCR Cash-Out Refinance" : "DSCR Rate & Term Refinance";
    if (a.refi_goal === "cash" || a.refi_goal === "both") return "Cash-Out Refinance";
    if (a.current_loan === "FHA") return "FHA Streamline Refinance";
    if (a.current_loan === "VA") return "VA IRRRL Streamline";
    return "Rate & Term Refinance";
  }
  if (g === "invest") {
    if (a.rental_type === "str") return "Short-Term Rental (Airbnb) DSCR";
    if (a.invest_action === "cashout") return "DSCR Cash-Out";
    if (a.invest_action === "refi") return "DSCR Rate & Term";
    if (a.prop_type === "Multifamily") return "Multi-Family Investor Financing";
    return "DSCR Purchase";
  }
  if (g === "flip") return a.flip_type || "Fix and Flip";
  if (g === "equity") {
    const prefix = investor ? "Investment " : "";
    return a.equity_type === "Home Equity Loan" ? `${prefix}Home Equity Loan` : `${prefix}HELOC`;
  }
  if (g === "business") return a.biz_type || "Business Loan";
  if (g === "reverse") return a.age62 === "no" ? "Home Equity (HELOC / Cash-Out Refinance)" : "Reverse Mortgage (HECM)";
  return "Mortgage Inquiry";
}

// ---- Arc 2: the disguised 1003 ----------------------------------------------
// Built per-answers so we only ask what's relevant (purchase vs refi, etc.).
function appSteps(a: Answers): Q[] {
  const purchase = a.goal === "buy" || a.invest_action === "purchase" || a.goal === "flip";
  const consumer = isConsumer(a);
  // DSCR loans qualify on the PROPERTY's rental income, not the borrower's. So
  // we never ask for personal employment/income. We ask projected rent instead.
  const dscr = product(a).toLowerCase().includes("dscr");
  const steps: Q[] = [];
  // Borrower (URLA §1)
  steps.push({ id: "dob", kind: "date", prompt: "Quick one. When's your birthday? 🎂", sub: "Required on every loan application — we use it to match you to the best programs.", optional: true });
  steps.push({ id: "ssn", kind: "text", prompt: "Your Social Security number", sub: "🔒 Encrypted and used only to prepare your application and verify identity. Required to finalize your loan — you can skip it for now if you prefer.", placeholder: "XXX-XX-XXXX", optional: true });
  steps.push({ id: "citizenship", kind: "select", prompt: "Citizenship status?", options: [
    { value: "US Citizen", label: "U.S. citizen", emoji: "🇺🇸" },
    { value: "Permanent Resident", label: "Permanent resident (green card)" },
    { value: "Non-Permanent Resident", label: "Visa / other" },
  ] });
  steps.push({ id: "marital", kind: "select", prompt: "Marital status?", sub: "Required on every loan application.", options: [
    { value: "Married", label: "Married", emoji: "💍" }, { value: "Unmarried", label: "Single", emoji: "🙂" }, { value: "Separated", label: "Separated" },
  ] });
  steps.push({ id: "dependents", kind: "select", prompt: "Anyone depend on you financially?", options: [
    { value: "0", label: "Just me" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3+" },
  ] });
  // Co-borrower (URLA supports multiple borrowers; the public form used to hard-cap
  // at one, so spouses/partners/co-investors had no way onto their own application).
  steps.push({ id: "has_coborrower", kind: "select", prompt: "Is anyone applying with you?", sub: "A spouse, partner or co-investor on the loan with you.", options: [
    { value: "no", label: "Just me", emoji: "🙂" },
    { value: "yes", label: "Yes — add a co-borrower", emoji: "👥", hint: "Their income can strengthen the application" },
  ] });
  // Current residence (URLA §1b)
  steps.push({ id: "own_or_rent", kind: "select", prompt: "Right now, do you own or rent?", options: [
    { value: "Own", label: "I own", emoji: "🏠" }, { value: "Rent", label: "I rent", emoji: "🔑" }, { value: "Rent-free", label: "Neither / live rent-free" },
  ] });
  steps.push({ id: "housing_payment", kind: "number", prompt: "What's your current monthly housing payment?", sub: "Rent or mortgage. A round number is fine.", placeholder: "Monthly housing ($)", optional: true });
  steps.push({ id: "years_at_address", kind: "select", prompt: "How long at your current place?", options: [
    { value: "<2", label: "Less than 2 years" }, { value: "2+", label: "2+ years" },
  ] });
  if (dscr) {
    // DSCR = no personal-income docs. Qualify on the property's cash flow.
    steps.push({ id: "rent_income", kind: "number", prompt: "What's the expected monthly rent?", sub: "This is what qualifies a DSCR loan. No pay stubs or tax returns needed. A market estimate is fine.", placeholder: "Monthly rent ($)", optional: true });
  } else {
    // Employment & income (URLA §1c / §1d)
    steps.push({ id: "employment_status", kind: "select", prompt: "How do you earn your income?", options: [
      { value: "Employed", label: "Employed (W-2)", emoji: "💼" }, { value: "Self-Employed", label: "Self-employed / business owner", emoji: "🧑‍💻" },
      { value: "Retired", label: "Retired", emoji: "🌅" }, { value: "Other", label: "Other" },
    ] });
    steps.push({ id: "employer", kind: "text", prompt: "Who do you work for?", sub: "Your employer or business name.", placeholder: "Employer / business", optional: true });
    steps.push({ id: "job_title", kind: "text", prompt: "What's your role?", placeholder: "Job title", optional: true });
    steps.push({ id: "years_employed", kind: "select", prompt: "How long in this line of work?", options: [
      { value: "<2", label: "Less than 2 years" }, { value: "2+", label: "2+ years" },
    ] });
    steps.push({ id: "monthly_income", kind: "number", prompt: "About what's your monthly income, before taxes?", sub: "Best estimate. We verify later.", placeholder: "Gross monthly income ($)", optional: true });
    steps.push({ id: "other_income", kind: "number", prompt: "Any other monthly income?", sub: "Rentals, side business, support, etc. Skip if none.", placeholder: "Other monthly income ($)", optional: true });
  }
  // Assets (URLA §2)
  steps.push({ id: "liquid_assets", kind: "number", prompt: "Roughly how much do you have saved or invested?", sub: "Checking, savings, 401k/IRA. Helps us show what you qualify for.", placeholder: "Total assets ($)", optional: true });
  if (purchase && consumer) {
    // Offer down payment assistance. Only meaningful for owner-occupied buyers.
    steps.push({ id: "dpa", kind: "select", prompt: "Want help covering your down payment?", sub: "You may qualify for down payment assistance. Grants or low-interest 'silent second' loans that cut the cash you need to close.", options: [
      { value: "yes", label: "Yes. Show me assistance options", emoji: "🙌" },
      { value: "no", label: "No, I've got it covered", emoji: "👍" },
    ] });
    steps.push({ id: "down_payment_source", kind: "select", prompt: "Where will your down payment come from?", options: [
      { value: "Savings", label: "My savings", emoji: "🏦" }, { value: "Gift", label: "Gift from family", emoji: "🎁" },
      { value: "Sale of Property", label: "Selling a property", emoji: "🏡" }, { value: "Assistance Program", label: "A down payment assistance program", emoji: "🙌" }, { value: "Other", label: "Other" },
    ] });
  }
  steps.push({ id: "own_other_property", kind: "select", prompt: "Do you own any other real estate?", options: [
    { value: "no", label: "No, this is it", emoji: "🙂" }, { value: "yes", label: "Yes, I own other property", emoji: "🏘️" },
  ] });
  // Declarations (URLA §5. The most material ones, asked gently)
  steps.push({ id: "bk_fc", kind: "select", prompt: "In the last 7 years, any bankruptcy or foreclosure?", sub: "Totally fine either way. It just shapes your options.", options: [
    { value: "no", label: "Nope, all good", emoji: "✅" }, { value: "yes", label: "Yes, within 7 years" },
  ] });
  // Co-borrower details (URLA borrower #2). Only when they said yes above. The
  // prompts personalize once the name is captured (appSteps rebuilds per answer).
  if (a.has_coborrower === "yes") {
    const coFirst = (a.co_full_name || "").trim().split(/\s+/)[0] || "your co-borrower";
    steps.push({ id: "co_full_name", kind: "text", prompt: "What's your co-borrower's full name?", sub: "As it appears on their ID.", placeholder: "Co-borrower full name" });
    steps.push({ id: "co_email", kind: "text", prompt: `Best email for ${coFirst}?`, sub: "So they're on the application too. We won't spam them.", placeholder: "Co-borrower email", optional: true });
    steps.push({ id: "co_phone", kind: "text", prompt: `And ${coFirst}'s phone number?`, placeholder: "Co-borrower phone", optional: true });
    steps.push({ id: "co_dob", kind: "date", prompt: `When's ${coFirst}'s birthday? 🎂`, sub: "Required on the final application — skip for now if you're not sure.", optional: true });
    steps.push({ id: "co_ssn", kind: "text", prompt: `${coFirst}'s Social Security number`, sub: "🔒 Encrypted, same as yours. You can skip it for now.", placeholder: "XXX-XX-XXXX", optional: true });
    steps.push({ id: "co_citizenship", kind: "select", prompt: `${coFirst}'s citizenship status?`, options: [
      { value: "US Citizen", label: "U.S. citizen", emoji: "🇺🇸" },
      { value: "Permanent Resident", label: "Permanent resident (green card)" },
      { value: "Non-Permanent Resident", label: "Visa / other" },
    ] });
    steps.push({ id: "co_lives_together", kind: "select", prompt: `Does ${coFirst} live with you?`, options: [
      { value: "yes", label: "Yes, same address", emoji: "🏠" }, { value: "no", label: "No, different address" },
    ] });
    if (!dscr) {
      // DSCR qualifies on the property's rent — no personal income for either borrower.
      steps.push({ id: "co_employment_status", kind: "select", prompt: `How does ${coFirst} earn income?`, options: [
        { value: "Employed", label: "Employed (W-2)", emoji: "💼" }, { value: "Self-Employed", label: "Self-employed / business owner", emoji: "🧑‍💻" },
        { value: "Retired", label: "Retired", emoji: "🌅" }, { value: "Other", label: "Other" },
      ] });
      steps.push({ id: "co_employer", kind: "text", prompt: `Who does ${coFirst} work for?`, placeholder: "Their employer / business", optional: true });
      steps.push({ id: "co_monthly_income", kind: "number", prompt: `About what's ${coFirst}'s monthly income, before taxes?`, sub: "Best estimate. Their income counts toward qualifying.", placeholder: "Their gross monthly income ($)", optional: true });
    }
  }
  // Property (URLA §4)
  steps.push({ id: "property_address", kind: "address", prompt: "What's the property address?", sub: purchase ? "Already have one? We'll verify it. Still shopping? Just skip." : "The address we're financing. We'll verify it.", placeholder: "Property address", optional: true });
  return steps;
}

const field = "w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none";
// OPTIONAL SMS consent (TCPA + carrier A2P/toll-free rule: agreeing to texts must NOT
// be a condition of service). Collected via a separate, unchecked checkbox — never
// bundled into form submission. When unchecked, we do not text the lead.
const SMS_CONSENT = "Text or call me too — I agree that Fetti Financial Services LLC (NMLS #2267023) may send me account, application, and appointment text messages (SMS) AND may call me at the number provided, including automated calls made with an AI voice assistant (for example, appointment reminders and returning my calls). Consent is not a condition of any service. Message frequency varies; Msg & data rates may apply. Reply STOP to opt out of texts, HELP for help; say or press opt-out during any call to stop calls.";

export default function ApplyWizard() {
  const [answers, setAnswers] = useState<Answers>({});
  const [i, setI] = useState(0);
  const [ai, setAi] = useState(0);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"flow" | "contact" | "app" | "done">("flow");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [fileLink, setFileLink] = useState<string | null>(null); // secure document-upload link
  const [prod, setProd] = useState<string>("");
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [contact, setContact] = useState<Record<string, unknown>>({});
  // Magic-link prefill (?lead=&t=): the lead's known contact info, so a nurtured
  // borrower lands with everything already typed — one confirm click, zero friction.
  const [prefill, setPrefill] = useState<{ full_name: string; first_name: string; email: string; phone: string; state: string } | null>(null);

  // ---- Learning loop: telemetry + learned config -----------------------------
  const sid = useRef<string>("");
  const [goalOrder, setGoalOrder] = useState<string[] | null>(null);
  const [tip, setTip] = useState<string>("");
  const [rebuttals, setRebuttals] = useState<Record<string, string>>({});
  // Objection-handling interstitial: the coaching message + the deferred advance.
  const [coach, setCoach] = useState<{ key: string; message: string } | null>(null);
  const advanceRef = useRef<null | (() => void)>(null);
  useEffect(() => {
    sid.current =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `s_${Math.random().toString(36).slice(2)}${Date.now()}`;
    track("start", { phase: "flow" });
    armFormShield(); // server-signed fill-time token (anti-bot)
    // Deep links (/links bio page, ads) pass ?goal= — honor it so an investor CTA
    // actually lands on the investor flow, not the generic first question.
    try {
      const params = new URLSearchParams(window.location.search);
      const g = params.get("goal");
      const valid = ["buy", "refi", "invest", "flip", "equity", "business", "reverse"];
      if (g && valid.includes(g)) {
        setAnswers((a) => ({ ...a, goal: g }));
        setI(1);
        // Attribute the session to its goal up front. Deep-linked/ad traffic
        // (?goal=invest, paid_lp_dscr, etc.) skips the goal question, so a bounce
        // on the first qualify step otherwise logs as "unknown" — polluting the
        // per-goal conversion stats the Application Coach learns from. No
        // step_index: this must not claim a drop-off step it didn't reach.
        track("answer", { phase: "flow", step_id: "goal", goal: g });
      }
      // Magic application link (?lead=&t=): fetch the lead's known info so the
      // contact step arrives pre-filled and the goal flow is already chosen.
      const leadParam = params.get("lead");
      const tok = params.get("t");
      if (leadParam && tok) {
        fetch(`/api/apply/prefill?lead=${encodeURIComponent(leadParam)}&t=${encodeURIComponent(tok)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((p) => {
            if (!p?.ok) return;
            setPrefill(p);
            if (!g && p.goal && valid.includes(p.goal)) { setAnswers((a) => (a.goal ? a : { ...a, goal: p.goal })); setI((cur) => (cur === 0 ? 1 : cur)); track("answer", { phase: "flow", step_id: "goal", goal: p.goal }); }
          })
          .catch(() => {});
      }
    } catch { /* ignore */ }
    // Pull what the Application Coach has learned, and adapt this session to it.
    fetch("/api/wizard/event")
      .then((r) => r.json())
      .then((d) => {
        const c = d?.config || {};
        if (Array.isArray(c.goal_order) && c.goal_order.length) setGoalOrder(c.goal_order);
        if (typeof c.tip === "string") setTip(c.tip);
        if (c.rebuttals && typeof c.rebuttals === "object") setRebuttals(c.rebuttals);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire-and-forget funnel event (never blocks or breaks the UI).
  function track(event: string, extra: Record<string, unknown> = {}) {
    if (!sid.current) return;
    try {
      fetch("/api/wizard/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ session_id: sid.current, event, ...extra }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  // Goal question reordered by what actually converts (learned), base order otherwise.
  const goalQ: Q = useMemo(() => {
    const base = GOAL as Extract<Q, { kind: "select" }>;
    if (!goalOrder) return base;
    const byVal = new Map(base.options.map((o) => [o.value, o]));
    const ordered = goalOrder.map((v) => byVal.get(v)).filter(Boolean) as Opt[];
    for (const o of base.options) if (!ordered.includes(o)) ordered.push(o);
    return { ...base, options: ordered };
  }, [goalOrder]);

  const steps: Q[] = useMemo(() => (answers.goal ? [GOAL, ...FLOWS[answers.goal], CREDIT_Q] : [GOAL]), [answers.goal]);
  const aSteps: Q[] = useMemo(() => appSteps(answers), [answers]);

  // Progress across all three arcs (qualify -> contact -> 1003).
  const totalQualify = steps.length;
  const grandTotal = totalQualify + 1 /*contact*/ + aSteps.length;
  const done =
    phase === "flow" ? i :
    phase === "contact" ? totalQualify :
    phase === "app" ? totalQualify + 1 + ai :
    grandTotal;
  const pct = Math.round((done / grandTotal) * 100);

  // Show the coaching interstitial for an obstacle, deferring `advance` until the
  // borrower taps "Keep going". Falls back to default copy if nothing learned yet.
  function maybeCoach(id: string, value: string, next: Answers, phaseName: string, advance: () => void): boolean {
    const key = detectObstacle(id, value, next);
    if (!key) return false;
    const message = rebuttals[key] || (key === "low_down" ? lowDownMessage(next) : key === "refi_start" ? refiMessage(next) : DEFAULT_REBUTTALS[key]);
    advanceRef.current = advance;
    setCoach({ key, message });
    track("objection", { phase: phaseName, step_id: id, goal: next.goal, occupancy: effectiveOccupancy(next), product: product(next), meta: { obstacle: key } });
    return true;
  }
  function continueCoach() {
    const go = advanceRef.current;
    advanceRef.current = null;
    setCoach(null);
    if (go) go();
  }

  function answerFlow(id: string, raw: string, kind: Q["kind"]) {
    const value = kind === "number" ? raw.replace(/[^0-9.]/g, "") : raw;
    // Switching GOAL mid-flow (via Back) must clear downstream answers. Each goal
    // has a different question set, so a stale answer from the old flow — most
    // dangerously `occupancy` — silently drives the wrong product AND the wrong
    // licensing: effectiveOccupancy() trusts a leftover occupancy="Owner" and
    // mislabels a DSCR investment loan as "consumer, FL/MI/CA" (owner-occupied
    // is FL/MI/CA only; investment is all 50 states).
    const next = (id === "goal" && answers.goal && answers.goal !== value)
      ? ({ goal: value } as Answers)
      : { ...answers, [id]: value };
    setAnswers(next);
    setInput("");
    track("answer", { phase: "flow", step_id: id, step_index: i, goal: next.goal, occupancy: effectiveOccupancy(next), product: next.goal ? product(next) : undefined });
    const flow = id === "goal" ? [GOAL, ...FLOWS[value], CREDIT_Q] : steps;
    const advance = () => { if (i + 1 >= flow.length) setPhase("contact"); else setI(i + 1); };
    if (!maybeCoach(id, value, next, "flow", advance)) advance();
  }

  function answerApp(id: string, raw: string, kind: Q["kind"]) {
    const value = kind === "number" ? raw.replace(/[^0-9.]/g, "") : raw.trim();
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setInput("");
    track("answer", { phase: "app", step_id: id, step_index: totalQualify + 1 + ai, goal: next.goal, occupancy: effectiveOccupancy(next), product: product(next) });
    const advance = () => { if (ai + 1 >= aSteps.length) submitApplication(next); else setAi(ai + 1); };
    if (!maybeCoach(id, value, next, "app", advance)) advance();
  }

  // Restore the saved answer into the input whenever the current question changes —
  // going Back used to show blank fields and force re-typing (audit P2).
  const currentQId = phase === "app" ? aSteps[ai]?.id : phase === "flow" ? steps[i]?.id : null;
  useEffect(() => {
    if (!currentQId) return;
    const saved = (answers as Record<string, string | undefined>)[currentQId];
    setInput(saved != null ? String(saved) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQId, phase]);

  function back() {
    setError(null);
    if (phase === "app") { if (ai > 0) setAi(ai - 1); else setPhase("contact"); setInput(""); return; }
    if (phase === "contact") { setPhase("flow"); return; }
    if (i > 0) setI(i - 1);
  }

  // Build the /api/apply payload. `extra` carries the contact fields from the form.
  function buildPayload(a: Answers, extra: Record<string, unknown>) {
    const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const occ = effectiveOccupancy(a);
    const p = product(a);
    const dscr = p.toLowerCase().includes("dscr");
    // DSCR qualifies on property cash flow. Never report borrower personal income.
    const monthly = !dscr && a.monthly_income ? Number(a.monthly_income) : undefined;
    const propType = a.prop_type || (a.goal === "buy" ? "Residential" : undefined);
    // A readable 1003 summary that updates on the lead (notes survives dedup-merge).
    const lines: string[] = [`Product: ${p}`, `Goal: ${a.goal}`, `Occupancy: ${occ || "n/a"} (${isInvestment(a) ? "INVESTMENT, all 50 states" : "consumer, FL/MI/CA"})`];
    if (dscr) lines.push("Qualification: DSCR (property cash flow, no personal income)");
    const add = (label: string, v?: string) => { if (v) lines.push(`${label}: ${v}`); };
    add("DOB", a.dob); add("Citizenship", a.citizenship); add("Marital", a.marital); add("Dependents", a.dependents);
    add("Owns/Rents", a.own_or_rent); add("Current housing pmt", a.housing_payment && `$${a.housing_payment}/mo`);
    add("Yrs at address", a.years_at_address); add("Employment", a.employment_status); add("Employer", a.employer); add("Title", a.job_title);
    add("Yrs in field", a.years_employed); add("Gross monthly income", monthly ? `$${monthly}` : undefined);
    add("Projected monthly rent", a.rent_income && `$${a.rent_income}`);
    add("Other monthly income", !dscr && a.other_income ? `$${a.other_income}` : undefined); add("Liquid assets", a.liquid_assets && `$${a.liquid_assets}`);
    add("Down pmt source", a.down_payment_source); add("Down payment assistance", a.dpa === "yes" ? "INTERESTED" : undefined); add("Owns other RE", a.own_other_property);
    add("BK/Foreclosure 7yr", a.bk_fc); add("Property address", a.property_address);
    add("VA/Military", a.military); add("First-time buyer", a.firsttime); add("Rental type", a.rental_type); add("Experience", a.experience);
    // Co-borrower summary for the notes blob — name + income only, never SSN/DOB.
    const withCo = a.has_coborrower === "yes" && !!a.co_full_name;
    if (withCo) lines.push(`Co-borrower: ${a.co_full_name}${a.co_monthly_income ? ` ($${a.co_monthly_income}/mo income)` : ""}`);
    const attr = getAttribution();
    const av = (k: string) => (attr as Record<string, string>)[k] || qs.get(k) || undefined;
    return {
      ...extra,
      ...shieldFields(),
      loan_purpose: p,
      occupancy: occ || undefined,
      property_type: propType,
      property_address: a.property_address || undefined,
      property_value: a.property_value ? Number(a.property_value) : undefined,
      loan_amount_requested: a.loan_amount_requested ? Number(a.loan_amount_requested) : undefined,
      credit_score: a.credit && a.credit !== "0" ? Number(a.credit) : undefined,
      liquid_assets: a.liquid_assets ? Number(a.liquid_assets) : undefined,
      income: monthly,
      income_is_monthly: true, // scorer hint: wizard income is genuinely monthly (Meta forms may be annual)
      // Discrete identity / URLA fields so the 1003 captures them structurally
      // (not just in the notes summary). SSN is encrypted server-side; never in notes.
      dob: a.dob || undefined,
      ssn: a.ssn || undefined,
      citizenship: a.citizenship || undefined,
      marital_status: a.marital || undefined,
      dependents: a.dependents || undefined,
      employment_status: a.employment_status || undefined,
      employer: a.employer || undefined,
      job_title: a.job_title || undefined,
      years_employed: a.years_employed || undefined,
      own_or_rent: a.own_or_rent || undefined,
      // Co-borrower (URLA borrower #2) — discrete fields, gated on the explicit
      // "yes" so a Back-and-switch to "just me" never sends stale co_* answers.
      // co_ssn is encrypted server-side exactly like the primary's; never in notes.
      has_coborrower: a.has_coborrower || undefined,
      ...(withCo ? {
        co_full_name: a.co_full_name || undefined,
        co_email: a.co_email || undefined,
        co_phone: a.co_phone || undefined,
        co_dob: a.co_dob || undefined,
        co_ssn: a.co_ssn || undefined,
        co_citizenship: a.co_citizenship || undefined,
        co_lives_together: a.co_lives_together || undefined,
        co_employment_status: a.co_employment_status || undefined,
        co_employer: a.co_employer || undefined,
        co_monthly_income: a.co_monthly_income ? Number(a.co_monthly_income) : undefined,
      } : {}),
      // Portfolio flag — structural, not just a notes string: scoreLead awards
      // tier points for it and it lands in raw for downstream agents.
      own_other_property: a.own_other_property || undefined,
      bk_fc: a.bk_fc || undefined,
      notes: lines.join(" · "),
      referrer: av("ref"),
      utm_source: av("utm_source"),
      utm_medium: av("utm_medium"),
      utm_campaign: av("utm_campaign"),
      utm_term: av("utm_term"),
      utm_content: av("utm_content"),
      gclid: av("gclid"),
      fbclid: av("fbclid"),
      // Mark ad-sourced wizard leads as paid so they're visible as paid in the CRM
      // (first-touch utm survives navigation; ignore the LP success-CTA's lp_* tag).
      source: av("ref") ? "referral" : (av("utm_source") && !/^lp_/.test(String(av("utm_source")))) ? `paid_${av("utm_source")}` : "wizard",
      // TCPA/CAN-SPAM: submitting authorizes phone & email contact about the inquiry.
      // SMS (text) consent is SEPARATE and OPTIONAL — it rides in via the sms_optin
      // checkbox (spread from `extra`/contact), never bundled into form submission.
      consent: true,
      consent_at: new Date().toISOString(),
      consent_text: "By submitting, borrower agreed Fetti Financial Services may contact them by phone & email about their inquiry. Consent not required to buy.",
    };
  }

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/apply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Something went wrong.");
    return j as { lead_id: string; file_link?: string };
  }

  // Contact step: CREATE the lead now (speed-to-lead), then continue into the 1003.
  async function submitContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const p = product(answers);
    setProd(p);
    const smsOptin = fd.get("sms_optin") === "on";
    // Only SEND the sms_consent keys when the box is CHECKED: a returning borrower
    // (magic link) who leaves it unchecked must never OVERWRITE a consent they already
    // gave — unchecked means "no new grant", not "revoke" (STOP is the revocation path).
    const c = {
      full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
      state: fd.get("state"), zip: String(fd.get("zip") || "").replace(/\D/g, "").slice(0, 5) || undefined, hp: String(fd.get("company") || ""),
      ...(smsOptin ? {
        sms_consent: true,
        sms_consent_at: new Date().toISOString(),
        sms_consent_text: SMS_CONSENT,
        // Same checkbox covers AI-assistant CALLS (appointment reminders, call returns)
        // — required by the FCC's artificial-voice rules before Penny may dial out.
        ai_call_consent: true,
      } : {}),
    };
    setContact(c);
    try {
      const j = await post(buildPayload(answers, c));
      setLeadId(j.lead_id);
      if (j.file_link) setFileLink(j.file_link); // borrower's secure upload link

      if (shouldTrack(j)) trackLead(answers.loan_amount_requested ? Number(answers.loan_amount_requested) : undefined); // pixel only for shield-passed leads
      track("contact", { phase: "contact", goal: answers.goal, occupancy: effectiveOccupancy(answers), product: p });
      setPhase("app"); setAi(0);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); } finally { setSubmitting(false); }
  }

  // Final step of the 1003: UPDATE the same lead (dedup-merge by email/phone).
  async function submitApplication(finalAnswers: Answers) {
    setSubmitting(true); setError(null);
    try {
      // hp (honeypot) was already judged on POST #1 — re-sending a stale autofill
      // value here could quarantine the COMPLETED 1003. Send it once, never again.
      const j = await post({ ...buildPayload(finalAnswers, contact), hp: undefined, app_completed: true });
      if (j.file_link) setFileLink(j.file_link); // returning borrowers get the upload CTA too
      trackApplication(finalAnswers.loan_amount_requested ? Number(finalAnswers.loan_amount_requested) : undefined); // completed-1003 conversion
      track("complete", { phase: "app", goal: finalAnswers.goal, occupancy: effectiveOccupancy(finalAnswers), product: product(finalAnswers) });
      setSubmitting(false); setPhase("done");
    } catch (err) {
      // NEVER show "You're all set!" when the application didn't save — the borrower
      // walks away believing it's done and the data is gone (audit P2).
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "We couldn't submit your application. Please retry.");
    }
  }

  // ---- DONE -----------------------------------------------------------------
  if (phase === "done") {
    return (
      <Shell pct={100}>
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">You're all set! 🎉</h1>
          <p className="text-slate-600 mt-3">
            Based on everything you shared, a <span className="text-emerald-600 font-semibold">{prod || "loan"}</span> looks
            like a strong fit. And your application is essentially done. A Fetti specialist will reach out shortly to confirm
            your numbers and send next steps.
          </p>
          <CediBubble center size={56} className="mt-6">We got it from here. Sit back. I&apos;ll make sure your file moves. 🌴</CediBubble>
          {fileLink ? (
            <div className="mt-7 flex flex-col items-center gap-3">
              <a href={fileLink} className="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-3 rounded-full">
                Upload your documents securely →
              </a>
              <p className="text-xs text-slate-500 max-w-sm">This is your private, secure upload link — we&apos;ve also sent it to your email{contact.sms_consent ? " and phone" : ""}. Uploading now gets your file moving fastest.</p>
            </div>
          ) : (
            <p className="mt-7 text-sm text-slate-500">A specialist is reviewing your application now — keep an eye on your email.</p>
          )}
        </div>
      </Shell>
    );
  }

  // ---- COACH (objection handling. Keep them engaged) -----------------------
  if (coach) {
    return (
      <Shell pct={pct} onBack={() => { advanceRef.current = null; setCoach(null); }}>
        <div className="rounded-2xl bg-gradient-to-b from-emerald-500/15 to-white/0 border border-emerald-200 p-6">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold"><Lightbulb className="w-5 h-5" /> Good news. There's a path here</div>
          <p className="text-slate-800 text-lg leading-relaxed mt-3">{coach.message}</p>
        </div>
        <button onClick={continueCoach} className="w-full mt-5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-full">
          Keep going →
        </button>
        <p className="text-center text-xs text-slate-400 mt-3">No obligation. We'll show you real options either way.</p>
      </Shell>
    );
  }

  // ---- CONTACT (creates the lead) -------------------------------------------
  if (phase === "contact") {
    // Name the specific product they qualified for at the highest-drop-off gate.
    // Seeing "Your DSCR Purchase match is ready" (vs a generic "send your options")
    // turns the contact ask into claiming something already earned — the endowment
    // lever the wizard-learn insight flagged: high engagement, weak conversion.
    // "Mortgage Inquiry" is the catch-all fallback, so we keep the generic copy there.
    const matched = (() => { const p = product(answers); return p && p !== "Mortgage Inquiry" ? p : null; })();
    return (
      <Shell pct={pct} onBack={back}>
        <h1 className="text-2xl font-bold">{prefill ? `Welcome back${prefill.first_name ? `, ${prefill.first_name}` : ""} 👋` : matched ? `Your ${matched} match is ready` : "Where should we send your options?"}</h1>
        <p className="text-slate-500 mt-1 text-sm">{prefill ? "We saved everything — confirm your info and keep going. No impact to your credit." : matched ? "Confirm your info and I'll pull your real numbers. No impact to your credit." : "No impact to your credit. A real specialist follows up fast."}</p>
        <CediBubble size={48} className="mt-4">{prefill ? "I kept your file warm. One click and we pick up right where we left off. 😎" : matched ? `Nice — you line up for a ${matched}. Drop your info and I'll get it moving. 😎` : "Almost there. Drop your info and I'll get your options moving. 😎"}</CediBubble>
        <form key={prefill ? "prefilled" : "blank"} onSubmit={submitContact} className="space-y-3 mt-5">
          <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
          <input name="full_name" required placeholder="Full name" defaultValue={prefill?.full_name || ""} className={field} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="email" type="email" required placeholder="Email" defaultValue={prefill?.email || ""} className={field} />
            <div>
              <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="Phone" defaultValue={prefill?.phone || ""} className={field}
                onInput={(e) => {
                  const el = e.currentTarget;
                  const d = el.value.replace(/\D/g, "");
                  // Auto-format a US 10-digit number as (xxx) xxx-xxxx for clean data;
                  // leave anything else as typed so overseas investors can enter a
                  // country code. Soft hint only — never blocks submission.
                  const us = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
                  if (us.length === 10 && /^[2-9]/.test(us)) {
                    el.value = `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
                    setPhoneHint(null);
                  } else if (d.length === 10 && d.startsWith("1")) {
                    // mid-entry of a US number WITH country code ("1" + 9 so far) — not
                    // foreign, they're just still typing. No warning.
                    setPhoneHint(null);
                  } else if (d.length >= 10 && !/^[2-9]/.test(us.slice(0, 1))) {
                    setPhoneHint("That doesn't look like a U.S. number — if you're overseas, include your country code so we can reach you.");
                  } else if (d.length < 10) {
                    setPhoneHint(null);
                  }
                }} />
              {phoneHint && <p className="text-[11px] text-amber-600 mt-1">{phoneHint}</p>}
            </div>
          </div>
          <div className="flex gap-3">
            <select name="state" required defaultValue={prefill?.state && STATES.includes(prefill.state) ? prefill.state : ""} className={`${field} flex-1`}>
              <option value="" disabled>Property state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} placeholder="ZIP"
              onChange={(e) => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 5); }}
              className={`${field} w-28`} />
          </div>
          {isConsumer(answers) ? (
            <p className="text-[11px] text-amber-700">Owner-occupied home loans are offered in FL, MI &amp; CA. Other states: we'll connect you with the right option.</p>
          ) : (
            <p className="text-[11px] text-emerald-600/80">Investment &amp; business-purpose loans are available in all 50 states.</p>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <label className="flex items-start gap-2 text-left cursor-pointer">
            <input type="checkbox" name="sms_optin" className="mt-1 h-4 w-4 shrink-0 accent-emerald-600" />
            <span className="text-[11px] text-slate-400 leading-relaxed">{SMS_CONSENT}</span>
          </label>
          <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-3 rounded-full">
            {submitting ? "Submitting…" : "See my options →"}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            By submitting, you agree Fetti Financial Services LLC (NMLS #2267023) may contact you by phone &amp; email about your inquiry and application.
            Consent isn&apos;t required to buy. Texts are optional (checkbox above). See our <a href="/privacy" className="underline hover:text-slate-300">Privacy Policy</a> &amp; <a href="/terms" className="underline hover:text-slate-300">Terms</a>.
          </p>
          <p className="text-[10px] text-slate-400 text-center">{LICENSING_SHORT}</p>
        </form>
      </Shell>
    );
  }

  // ---- APP (the disguised 1003) ---------------------------------------------
  if (phase === "app") {
    const q = aSteps[ai];
    return (
      <Shell pct={pct} onBack={back}>
        {ai === 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-700">Nice. You pre-qualify! A few quick details and your pre-approval is ready.</p>
          </div>
        )}
        <QuestionView q={q} input={input} setInput={setInput} onAnswer={(v) => answerApp(q.id, v, q.kind)} onSkip={q.kind !== "select" && q.optional ? () => answerApp(q.id, String((answers as Record<string, string | undefined>)[q.id] ?? ""), q.kind) : undefined} />
        {error && (
          <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => submitApplication(answers)} className="mt-2 text-sm font-bold text-red-700 underline">Tap to retry</button>
          </div>
        )}
        {submitting && <p className="text-slate-400 text-sm mt-4">Saving…</p>}
      </Shell>
    );
  }

  // ---- FLOW (qualify) -------------------------------------------------------
  const q = steps[i];
  const displayQ = q.id === "goal" ? goalQ : q; // apply learned goal ordering
  return (
    <Shell pct={pct} onBack={i > 0 ? back : undefined}>
      <QuestionView q={displayQ} input={input} setInput={setInput} onAnswer={(v) => answerFlow(q.id, v, q.kind)} onSkip={q.kind !== "select" && q.optional ? () => answerFlow(q.id, String((answers as Record<string, string | undefined>)[q.id] ?? ""), q.kind) : undefined} />
      {q.id === "goal" && tip && (
        <p className="mt-4 text-xs text-emerald-700/80 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {tip}</p>
      )}
    </Shell>
  );
}

function QuestionView({ q, input, setInput, onAnswer, onSkip }: {
  q: Q; input: string; setInput: (v: string) => void; onAnswer: (v: string) => void; onSkip?: () => void;
}) {
  return (
    <>
      <h1 className="text-2xl font-bold">{q.prompt}</h1>
      {q.sub && <p className="text-slate-500 mt-1 text-sm">{q.sub}</p>}
      {q.kind === "select" && (
        <div className="grid grid-cols-1 gap-2.5 mt-5">
          {q.options.map((o) => (
            <button key={o.value} onClick={() => onAnswer(o.value)}
              className="text-left bg-white border border-slate-200 hover:border-emerald-300 hover:bg-slate-50 rounded-xl px-4 py-3.5 transition">
              <span className="font-medium">{o.emoji ? `${o.emoji} ` : ""}{o.label}</span>
              {o.hint && <span className="block text-xs text-slate-400 mt-0.5">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {q.kind === "address" && (
        <div className="mt-5">
          <AddressInput value={input} onChange={setInput} placeholder={q.placeholder} />
          <button disabled={!input} onClick={() => onAnswer(input)}
            className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-3 rounded-full">Continue →</button>
          {onSkip && <button onClick={onSkip} className="w-full mt-2 text-slate-400 hover:text-slate-600 text-sm">Skip for now</button>}
        </div>
      )}
      {(q.kind === "number" || q.kind === "text" || q.kind === "date") && (
        <div className="mt-5">
          {q.kind === "number" ? (
            <CurrencyInput
              autoFocus
              value={input}
              onChange={setInput}
              placeholder={q.placeholder}
              className={field}
              onKeyDown={(e) => { if (e.key === "Enter" && input) onAnswer(input); }}
            />
          ) : (
            <input
              autoFocus
              type={q.kind === "date" ? "date" : "text"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={q.placeholder}
              className={field}
              onKeyDown={(e) => { if (e.key === "Enter" && input) onAnswer(input); }}
            />
          )}
          <button disabled={!input} onClick={() => onAnswer(input)}
            className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-3 rounded-full">Continue →</button>
          {onSkip && (
            <button onClick={onSkip} className="w-full mt-2 text-slate-400 hover:text-slate-600 text-sm">Skip for now</button>
          )}
        </div>
      )}
    </>
  );
}

function Shell({ children, pct, onBack }: { children: React.ReactNode; pct: number; onBack?: () => void }) {
  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      <div className="h-1.5 bg-slate-50"><div className="h-1.5 bg-emerald-600 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <img src="/fetti-emblem.png" alt="Fetti Financial Services LLC logo" width={34} height={34} className="w-[34px] h-[34px]" />
              <div className="text-emerald-600 font-extrabold">Fetti<span className="text-slate-900"> Financial Services</span> <span className="text-slate-400 text-[0.7em] font-bold align-middle">LLC</span></div>
            </div>
            {onBack && <button onClick={onBack} className="text-slate-400 hover:text-slate-900 text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back</button>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
