"use client";

// Conversational application wizard. Asks a few intuitive questions, branches by
// goal, and intelligently routes to the right product from Fetti's full catalog
// (conventional, FHA/VA/USDA, jumbo, Non-QM, DSCR, fix&flip, construction, bridge,
// equity/HELOC, reverse, commercial/SBA). Submits a scored lead to /api/apply.
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, Loader2 } from "lucide-react";
import { LICENSING_SHORT } from "@/lib/legal";

type Opt = { value: string; label: string; emoji?: string; hint?: string };
type Q =
  | { id: string; kind: "select"; prompt: string; sub?: string; options: Opt[] }
  | { id: string; kind: "number"; prompt: string; sub?: string; placeholder: string }
  | { id: string; kind: "text"; prompt: string; sub?: string; placeholder: string };

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

// Per-goal follow-ups. Kept short to stay engaging.
const FLOWS: Record<string, Q[]> = {
  buy: [
    { id: "occupancy", kind: "select", prompt: "Will you live there?", options: [
      { value: "Owner", label: "Yes — my primary home", emoji: "🏠" },
      { value: "Second Home", label: "It's a second / vacation home", emoji: "🌴" },
      { value: "Investor", label: "No — it's an investment", emoji: "📈" },
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
      { value: "Owner", label: "Primary home", emoji: "🏠" }, { value: "Investor", label: "Investment", emoji: "📈" },
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

// Map answers -> a specific product from the Fetti catalog.
function product(a: Answers): string {
  const g = a.goal;
  const big = (a.property_value && Number(a.property_value) >= 1000000);
  if (g === "buy") {
    if (a.occupancy === "Investor") return "DSCR Purchase";
    if (a.military === "yes") return "VA Purchase";
    if (a.down === "lt3") return "FHA Purchase";
    if (big) return "Jumbo Purchase";
    if (a.firsttime === "yes") return "First-Time Homebuyer (Conventional)";
    return "Conventional Purchase";
  }
  if (g === "refi") {
    if (a.occupancy === "Investor") return a.refi_goal === "cash" ? "DSCR Cash-Out Refinance" : "Investor Refinance";
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
  if (g === "equity") return a.equity_type === "Home Equity Loan" ? "Home Equity Loan" : "HELOC";
  if (g === "business") return a.biz_type || "Business Loan";
  if (g === "reverse") return "Reverse Mortgage (HECM)";
  return "Mortgage Inquiry";
}

const field = "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

export default function ApplyWizard() {
  const [answers, setAnswers] = useState<Answers>({});
  const [i, setI] = useState(0);
  const [num, setNum] = useState("");
  const [phase, setPhase] = useState<"flow" | "contact" | "done">("flow");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ lead_id: string; product: string } | null>(null);

  const steps: Q[] = useMemo(() => (answers.goal ? [GOAL, ...FLOWS[answers.goal], CREDIT_Q] : [GOAL]), [answers.goal]);
  const q = steps[i];
  const total = steps.length + 1; // + contact
  const pct = Math.round(((phase === "contact" ? steps.length : i) / total) * 100);

  function answer(id: string, value: string) {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setNum("");
    const flow = id === "goal" ? [GOAL, ...FLOWS[value], CREDIT_Q] : steps;
    if (i + 1 >= flow.length) setPhase("contact");
    else setI(i + 1);
  }

  function back() {
    setError(null);
    if (phase === "contact") { setPhase("flow"); return; }
    if (i > 0) setI(i - 1);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const prod = product(answers);
    const notes = `Wizard: ${Object.entries(answers).map(([k, v]) => `${k}=${v}`).join(", ")}`;
    try {
      const res = await fetch("/api/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fd.get("full_name"), email: fd.get("email"), phone: fd.get("phone"),
          state: fd.get("state"), loan_purpose: prod, occupancy: answers.occupancy || undefined,
          property_value: answers.property_value ? Number(answers.property_value) : undefined,
          loan_amount_requested: answers.loan_amount_requested ? Number(answers.loan_amount_requested) : undefined,
          credit_score: answers.credit && answers.credit !== "0" ? Number(answers.credit) : undefined,
          notes, referrer: qs.get("ref") || undefined, utm_source: qs.get("utm_source") || undefined,
          source: qs.get("ref") ? "referral" : "wizard",
          hp: String(fd.get("company") || ""),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      setResult({ lead_id: j.lead_id, product: prod });
      setPhase("done");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setSubmitting(false); }
  }

  // DONE
  if (phase === "done" && result) {
    return (
      <Shell pct={100}>
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">You're all set! 🎉</h1>
          <p className="text-slate-300 mt-3">
            Based on your answers, a <span className="text-emerald-400 font-semibold">{result.product}</span> looks
            like a great fit. A Fetti specialist will reach out shortly to walk you through your options.
          </p>
          <Link href={`/portal/${result.lead_id}`} className="inline-block mt-7 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-3 rounded-full">
            Track my application
          </Link>
        </div>
      </Shell>
    );
  }

  // CONTACT
  if (phase === "contact") {
    return (
      <Shell pct={pct} onBack={back}>
        <h1 className="text-2xl font-bold">Last step — where should we send your options?</h1>
        <p className="text-slate-400 mt-1 text-sm">No impact to your credit. A real specialist follows up fast.</p>
        <form onSubmit={submit} className="space-y-3 mt-5">
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
          {CONSUMER_GOALS.includes(answers.goal) && (
            <p className="text-[11px] text-amber-400/80">Owner-occupied home loans are offered in FL, MI & CA. Other states: we'll connect you with the right option.</p>
          )}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold py-3 rounded-full">
            {submitting ? "Submitting…" : "See my options →"}
          </button>
          <p className="text-[11px] text-slate-500 text-center">
            By submitting, you agree Fetti Financial Services may contact you by phone, email & text (SMS),
            including automated, at the number provided. Consent isn't required to buy. Msg &amp; data rates may apply; reply STOP to opt out.
          </p>
          <p className="text-[10px] text-slate-600 text-center">{LICENSING_SHORT}</p>
        </form>
      </Shell>
    );
  }

  // FLOW question
  return (
    <Shell pct={pct} onBack={i > 0 ? back : undefined}>
      <h1 className="text-2xl font-bold">{q.prompt}</h1>
      {q.sub && <p className="text-slate-400 mt-1 text-sm">{q.sub}</p>}
      {q.kind === "select" && (
        <div className="grid grid-cols-1 gap-2.5 mt-5">
          {q.options.map((o) => (
            <button key={o.value} onClick={() => answer(q.id, o.value)}
              className="text-left bg-slate-900/60 border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-900 rounded-xl px-4 py-3.5 transition">
              <span className="font-medium">{o.emoji ? `${o.emoji} ` : ""}{o.label}</span>
              {o.hint && <span className="block text-xs text-slate-500 mt-0.5">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {q.kind === "number" && (
        <div className="mt-5">
          <input autoFocus inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} placeholder={q.placeholder} className={field}
            onKeyDown={(e) => { if (e.key === "Enter" && num) answer(q.id, num.replace(/[^0-9.]/g, "")); }} />
          <button disabled={!num} onClick={() => answer(q.id, num.replace(/[^0-9.]/g, ""))}
            className="w-full mt-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold py-3 rounded-full">Continue →</button>
        </div>
      )}
    </Shell>
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
