"use client";

// Conversational application wizard. Two arcs:
//   1) QUALIFY — a few intuitive, branching questions route to the right product
//      from Fetti's full catalog, then we capture contact and CREATE the lead
//      immediately (speed-to-lead is preserved even if they stop here).
//   2) APPLICATION (1003) — framed as "lock in your pre-approval," we quietly
//      collect the rest of a complete Uniform Residential Loan Application
//      (URLA / Form 1003): borrower, residence, employment & income, assets,
//      declarations, property. Each answer UPDATES the same lead (dedup-merge).
// Occupancy is authoritative: if the borrower won't live there, it's an
// investment loan — that drives product selection AND licensing (investment /
// business loans are available in all 50 states; owner-occupied only FL/MI/CA).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, ShieldCheck } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

type Opt = { value: string; label: string; emoji?: string; hint?: string };
type Q =
  | { id: string; kind: "select"; prompt: string; sub?: string; options: Opt[] }
  | { id: string; kind: "number" | "text" | "date"; prompt: string; sub?: string; placeholder?: string; optional?: boolean };

type Answers = Record<string, string>;

const STATES = ["CA", "FL", "MI", "TX", "AZ", "GA", "NV", "OH", "WA", "CO", "Other"];
const CREDIT: Opt[] = [
  { value: "760", label: "Excellent (740+)" },
  { value: "720", label: "Good (700–739)" },
  { value: "680", label: "Fair (660–699)" },
  { value: "640", label: "Building (620–659)" },
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
      { value: "Owner", label: "Yes — my primary home", emoji: "🏠" },
      { value: "Second Home", label: "It's a second / vacation home", emoji: "🌴" },
      { value: "Investor", label: "No — it's an investment", emoji: "📈", hint: "Rental income property" },
    ] },
    { id: "military", kind: "select", prompt: "Are you a veteran or active military?", sub: "You may qualify for a $0-down VA loan.", options: [
      { value: "yes", label: "Yes", emoji: "🎖️" }, { value: "no", label: "No", emoji: "🙂" },
    ] },
    { id: "firsttime", kind: "select", prompt: "Is this your first home purchase?", options: [
      { value: "yes", label: "Yes — first time", emoji: "✨" }, { value: "no", label: "I've owned before", emoji: "🔑" },
    ] },
    { id: "down", kind: "select", prompt: "How much can you put down?", options: [
      { value: "lt3", label: "Little to none", hint: "FHA/VA/USDA options" },
      { value: "3to10", label: "3–10%" }, { value: "10to20", label: "10–20%" }, { value: "20p", label: "20%+" },
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
      { value: "SFR", label: "Single-family" }, { value: "2-4 Unit", label: "2–4 units" }, { value: "Multifamily", label: "5+ units" }, { value: "Condo", label: "Condo / townhome" },
    ] },
    { id: "property_value", kind: "number", prompt: "Roughly what's the purchase price or value?", placeholder: "Price / value ($)" },
  ],
  flip: [
    { id: "flip_type", kind: "select", prompt: "What's the project?", options: [
      { value: "Fix and Flip", label: "Fix & flip", emoji: "🔨" }, { value: "Rehab", label: "Rehab to rent", emoji: "🧰" },
      { value: "Construction", label: "Ground-up build", emoji: "🏗️" }, { value: "Bridge", label: "Bridge / buy-before-sell", emoji: "🌉" },
    ] },
    { id: "experience", kind: "select", prompt: "How many projects have you done?", options: [
      { value: "0", label: "This is my first", emoji: "🌱" }, { value: "1-4", label: "A few (1–4)", emoji: "👍" }, { value: "5+", label: "I'm seasoned (5+)", emoji: "🚀" },
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
const CREDIT_Q: Q = { id: "credit", kind: "select", prompt: "Roughly, how's your credit?", sub: "An estimate is fine — no credit pull to get started.", options: CREDIT };

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
// borrower won't live in is investment/business — available in all 50 states.
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
    if (a.military === "yes") return "VA Purchase";
    if (a.down === "lt3") return "FHA Purchase";
    if (big) return "Jumbo Purchase";
    if (a.firsttime === "yes") return "First-Time Homebuyer (Conventional)";
    return "Conventional Purchase";
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
  if (g === "reverse") return "Reverse Mortgage (HECM)";
  return "Mortgage Inquiry";
}

// ---- Arc 2: the disguised 1003 ----------------------------------------------
// Built per-answers so we only ask what's relevant (purchase vs refi, etc.).
function appSteps(a: Answers): Q[] {
  const purchase = a.goal === "buy" || a.invest_action === "purchase" || a.goal === "flip";
  const consumer = isConsumer(a);
  // DSCR loans qualify on the PROPERTY's rental income, not the borrower's — so
  // we never ask for personal employment/income. We ask projected rent instead.
  const dscr = product(a).toLowerCase().includes("dscr");
  const steps: Q[] = [];
  // Borrower (URLA §1)
  steps.push({ id: "dob", kind: "date", prompt: "Quick one — when's your birthday? 🎂", sub: "We use it to match you to the best programs.", optional: true });
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
  // Current residence (URLA §1b)
  steps.push({ id: "own_or_rent", kind: "select", prompt: "Right now, do you own or rent?", options: [
    { value: "Own", label: "I own", emoji: "🏠" }, { value: "Rent", label: "I rent", emoji: "🔑" }, { value: "Rent-free", label: "Neither / live rent-free" },
  ] });
  steps.push({ id: "housing_payment", kind: "number", prompt: "What's your current monthly housing payment?", sub: "Rent or mortgage — a round number is fine.", placeholder: "Monthly housing ($)", optional: true });
  steps.push({ id: "years_at_address", kind: "select", prompt: "How long at your current place?", options: [
    { value: "<2", label: "Less than 2 years" }, { value: "2+", label: "2+ years" },
  ] });
  if (dscr) {
    // DSCR = no personal-income docs. Qualify on the property's cash flow.
    steps.push({ id: "rent_income", kind: "number", prompt: "What's the expected monthly rent?", sub: "This is what qualifies a DSCR loan — no pay stubs or tax returns needed. A market estimate is fine.", placeholder: "Monthly rent ($)", optional: true });
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
    steps.push({ id: "monthly_income", kind: "number", prompt: "About what's your monthly income, before taxes?", sub: "Best estimate — we verify later.", placeholder: "Gross monthly income ($)", optional: true });
    steps.push({ id: "other_income", kind: "number", prompt: "Any other monthly income?", sub: "Rentals, side business, support, etc. Skip if none.", placeholder: "Other monthly income ($)", optional: true });
  }
  // Assets (URLA §2)
  steps.push({ id: "liquid_assets", kind: "number", prompt: "Roughly how much do you have saved or invested?", sub: "Checking, savings, 401k/IRA — helps us show what you qualify for.", placeholder: "Total assets ($)", optional: true });
  if (purchase && consumer) {
    steps.push({ id: "down_payment_source", kind: "select", prompt: "Where will your down payment come from?", options: [
      { value: "Savings", label: "My savings", emoji: "🏦" }, { value: "Gift", label: "Gift from family", emoji: "🎁" },
      { value: "Sale of Property", label: "Selling a property", emoji: "🏡" }, { value: "Other", label: "Other" },
    ] });
  }
  steps.push({ id: "own_other_property", kind: "select", prompt: "Do you own any other real estate?", options: [
    { value: "no", label: "No, this is it", emoji: "🙂" }, { value: "yes", label: "Yes, I own other property", emoji: "🏘️" },
  ] });
  // Declarations (URLA §5 — the most material ones, asked gently)
  steps.push({ id: "bk_fc", kind: "select", prompt: "In the last 7 years, any bankruptcy or foreclosure?", sub: "Totally fine either way — it just shapes your options.", options: [
    { value: "no", label: "Nope, all good", emoji: "✅" }, { value: "yes", label: "Yes, within 7 years" },
  ] });
  // Property (URLA §4)
  steps.push({ id: "property_address", kind: "text", prompt: purchase ? "What's the property address?" : "What's the property address?", sub: purchase ? "Already have one in mind? If you're still shopping, just say 'shopping.'" : "The address we're financing.", placeholder: "Property address", optional: true });
  return steps;
}

const field = "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

export default function ApplyWizard() {
  const [answers, setAnswers] = useState<Answers>({});
  const [i, setI] = useState(0);
  const [ai, setAi] = useState(0);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"flow" | "contact" | "app" | "done">("flow");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [prod, setProd] = useState<string>("");
  const [contact, setContact] = useState<Record<string, unknown>>({});

  // ---- Learning loop: telemetry + learned config -----------------------------
  const sid = useRef<string>("");
  const [goalOrder, setGoalOrder] = useState<string[] | null>(null);
  const [tip, setTip] = useState<string>("");
  useEffect(() => {
    sid.current =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `s_${Math.random().toString(36).slice(2)}${Date.now()}`;
    track("start", { phase: "flow" });
    // Pull what the Application Coach has learned, and adapt this session to it.
    fetch("/api/wizard/event")
      .then((r) => r.json())
      .then((d) => {
        const c = d?.config || {};
        if (Array.isArray(c.goal_order) && c.goal_order.length) setGoalOrder(c.goal_order);
        if (typeof c.tip === "string") setTip(c.tip);
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

  function answerFlow(id: string, raw: string, kind: Q["kind"]) {
    const value = kind === "number" ? raw.replace(/[^0-9.]/g, "") : raw;
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setInput("");
    track("answer", { phase: "flow", step_id: id, step_index: i, goal: next.goal, occupancy: effectiveOccupancy(next), product: next.goal ? product(next) : undefined });
    const flow = id === "goal" ? [GOAL, ...FLOWS[value], CREDIT_Q] : steps;
    if (i + 1 >= flow.length) setPhase("contact");
    else setI(i + 1);
  }

  function answerApp(id: string, raw: string, kind: Q["kind"]) {
    const value = kind === "number" ? raw.replace(/[^0-9.]/g, "") : raw.trim();
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setInput("");
    track("answer", { phase: "app", step_id: id, step_index: totalQualify + 1 + ai, goal: next.goal, occupancy: effectiveOccupancy(next), product: product(next) });
    if (ai + 1 >= aSteps.length) submitApplication(next);
    else setAi(ai + 1);
  }

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
    // DSCR qualifies on property cash flow — never report borrower personal income.
    const monthly = !dscr && a.monthly_income ? Number(a.monthly_income) : undefined;
    const propType = a.prop_type || (a.goal === "buy" ? "Residential" : undefined);
    // A readable 1003 summary that updates on the lead (notes survives dedup-merge).
    const lines: string[] = [`Product: ${p}`, `Goal: ${a.goal}`, `Occupancy: ${occ || "—"} (${isInvestment(a) ? "INVESTMENT — all 50 states" : "consumer — FL/MI/CA"})`];
    if (dscr) lines.push("Qualification: DSCR (property cash flow — no personal income)");
    const add = (label: string, v?: string) => { if (v) lines.push(`${label}: ${v}`); };
    add("DOB", a.dob); add("Citizenship", a.citizenship); add("Marital", a.marital); add("Dependents", a.dependents);
    add("Owns/Rents", a.own_or_rent); add("Current housing pmt", a.housing_payment && `$${a.housing_payment}/mo`);
    add("Yrs at address", a.years_at_address); add("Employment", a.employment_status); add("Employer", a.employer); add("Title", a.job_title);
    add("Yrs in field", a.years_employed); add("Gross monthly income", monthly ? `$${monthly}` : undefined);
    add("Projected monthly rent", a.rent_income && `$${a.rent_income}`);
    add("Other monthly income", !dscr && a.other_income ? `$${a.other_income}` : undefined); add("Liquid assets", a.liquid_assets && `$${a.liquid_assets}`);
    add("Down pmt source", a.down_payment_source); add("Owns other RE", a.own_other_property);
    add("BK/Foreclosure 7yr", a.bk_fc); add("Property address", a.property_address);
    add("VA/Military", a.military); add("First-time buyer", a.firsttime); add("Rental type", a.rental_type); add("Experience", a.experience);
    return {
      ...extra,
      loan_purpose: p,
      occupancy: occ || undefined,
      property_type: propType,
      property_value: a.property_value ? Number(a.property_value) : undefined,
      loan_amount_requested: a.loan_amount_requested ? Number(a.loan_amount_requested) : undefined,
      credit_score: a.credit && a.credit !== "0" ? Number(a.credit) : undefined,
      liquid_assets: a.liquid_assets ? Number(a.liquid_assets) : undefined,
      income: monthly,
      notes: lines.join(" · "),
      referrer: qs.get("ref") || undefined,
      utm_source: qs.get("utm_source") || undefined,
      utm_medium: qs.get("utm_medium") || undefined,
      utm_campaign: qs.get("utm_campaign") || undefined,
      source: qs.get("ref") ? "referral" : "wizard",
    };
  }

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/apply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Something went wrong.");
    return j as { lead_id: string };
  }

  // Contact step: CREATE the lead now (speed-to-lead), then continue into the 1003.
  async function submitContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const p = product(answers);
    setProd(p);
    const c = {
      full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
      state: fd.get("state"), hp: String(fd.get("company") || ""),
    };
    setContact(c);
    try {
      const j = await post(buildPayload(answers, c));
      setLeadId(j.lead_id);
      track("contact", { phase: "contact", goal: answers.goal, occupancy: effectiveOccupancy(answers), product: p });
      setPhase("app"); setAi(0);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); } finally { setSubmitting(false); }
  }

  // Final step of the 1003: UPDATE the same lead (dedup-merge by email/phone).
  async function submitApplication(finalAnswers: Answers) {
    setSubmitting(true); setError(null);
    try {
      await post(buildPayload(finalAnswers, contact));
      track("complete", { phase: "app", goal: finalAnswers.goal, occupancy: effectiveOccupancy(finalAnswers), product: product(finalAnswers) });
    } catch { /* lead already exists; non-fatal — specialist follows up */ } finally {
      setSubmitting(false); setPhase("done");
    }
  }

  // ---- DONE -----------------------------------------------------------------
  if (phase === "done") {
    return (
      <Shell pct={100}>
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">You're all set! 🎉</h1>
          <p className="text-slate-300 mt-3">
            Based on everything you shared, a <span className="text-emerald-400 font-semibold">{prod || "loan"}</span> looks
            like a strong fit — and your application is essentially done. A Fetti specialist will reach out shortly to confirm
            your numbers and send next steps.
          </p>
          {leadId && (
            <Link href={`/portal/${leadId}`} className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-3 rounded-full">
              Track my application
            </Link>
          )}
        </div>
      </Shell>
    );
  }

  // ---- CONTACT (creates the lead) -------------------------------------------
  if (phase === "contact") {
    return (
      <Shell pct={pct} onBack={back}>
        <h1 className="text-2xl font-bold">Where should we send your options?</h1>
        <p className="text-slate-400 mt-1 text-sm">No impact to your credit. A real specialist follows up fast.</p>
        <form onSubmit={submitContact} className="space-y-3 mt-5">
          <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
          <input name="full_name" required placeholder="Full name" className={field} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="email" type="email" required placeholder="Email" className={field} />
            <input name="phone" required placeholder="Phone" className={field} />
          </div>
          <select name="state" required defaultValue="" className={field}>
            <option value="" disabled>Property state</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {isConsumer(answers) ? (
            <p className="text-[11px] text-amber-400/80">Owner-occupied home loans are offered in FL, MI &amp; CA. Other states: we'll connect you with the right option.</p>
          ) : (
            <p className="text-[11px] text-emerald-400/80">Investment &amp; business-purpose loans are available in all 50 states.</p>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-3 rounded-full">
            {submitting ? "Submitting…" : "See my options →"}
          </button>
          <p className="text-[11px] text-slate-500 text-center">
            By submitting, you agree Fetti Financial Services may contact you by phone, email &amp; text (SMS),
            including automated, at the number provided. Consent isn't required to buy. Msg &amp; data rates may apply; reply STOP to opt out.
          </p>
          <p className="text-[10px] text-slate-600 text-center">{LICENSING_SHORT}</p>
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
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">Nice — you pre-qualify! A few quick details and your pre-approval is ready.</p>
          </div>
        )}
        <QuestionView q={q} input={input} setInput={setInput} onAnswer={(v) => answerApp(q.id, v, q.kind)} onSkip={q.kind !== "select" && q.optional ? () => answerApp(q.id, "", q.kind) : undefined} />
        {submitting && <p className="text-slate-500 text-sm mt-4">Saving…</p>}
      </Shell>
    );
  }

  // ---- FLOW (qualify) -------------------------------------------------------
  const q = steps[i];
  const displayQ = q.id === "goal" ? goalQ : q; // apply learned goal ordering
  return (
    <Shell pct={pct} onBack={i > 0 ? back : undefined}>
      <QuestionView q={displayQ} input={input} setInput={setInput} onAnswer={(v) => answerFlow(q.id, v, q.kind)} onSkip={q.kind !== "select" && q.optional ? () => answerFlow(q.id, "", q.kind) : undefined} />
      {q.id === "goal" && tip && (
        <p className="mt-4 text-xs text-emerald-300/80 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {tip}</p>
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
      {q.sub && <p className="text-slate-400 mt-1 text-sm">{q.sub}</p>}
      {q.kind === "select" && (
        <div className="grid grid-cols-1 gap-2.5 mt-5">
          {q.options.map((o) => (
            <button key={o.value} onClick={() => onAnswer(o.value)}
              className="text-left bg-slate-900/60 border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-900 rounded-xl px-4 py-3.5 transition">
              <span className="font-medium">{o.emoji ? `${o.emoji} ` : ""}{o.label}</span>
              {o.hint && <span className="block text-xs text-slate-500 mt-0.5">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {(q.kind === "number" || q.kind === "text" || q.kind === "date") && (
        <div className="mt-5">
          <input
            autoFocus
            type={q.kind === "date" ? "date" : "text"}
            inputMode={q.kind === "number" ? "numeric" : undefined}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={q.placeholder}
            className={field}
            onKeyDown={(e) => { if (e.key === "Enter" && input) onAnswer(input); }}
          />
          <button disabled={!input} onClick={() => onAnswer(input)}
            className="w-full mt-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold py-3 rounded-full">Continue →</button>
          {onSkip && (
            <button onClick={onSkip} className="w-full mt-2 text-slate-500 hover:text-slate-300 text-sm">Skip for now</button>
          )}
        </div>
      )}
    </>
  );
}

function Shell({ children, pct, onBack }: { children: React.ReactNode; pct: number; onBack?: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <div className="h-1.5 bg-slate-900"><div className="h-1.5 bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="flex items-center justify-between mb-5">
            <div className="text-emerald-400 font-extrabold">Fetti<span className="text-white"> Financial</span></div>
            {onBack && <button onClick={onBack} className="text-slate-500 hover:text-white text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back</button>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
