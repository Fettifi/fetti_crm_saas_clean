import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { MARK_PERSONA } from "@/lib/markPersona";

// PUBLIC website chat with Mark — Fetti's spokesperson AI. SEPARATE from /api/chat
// (that's Rupee, the INTERNAL co-founder with terminal/file tools — never exposed to
// visitors). Mark has ONE tool: start_application (opens a real loan file in the
// funnel). Everything else is conversation + compliance. Rate-limited.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const MODEL = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";

const SYSTEM = `${MARK_PERSONA}

YOU ARE A LIVE WEBSITE CHAT for visitors of fettifi.com — Fetti Financial Services LLC (NMLS #2267023), a NONBANK mortgage lender that funds the deals big banks won't.

CHAT STYLE: A real back-and-forth. Keep replies SHORT (2–5 sentences), warm, plain-English, one idea at a time. Do NOT append the company sign-off to every message — just talk like a sharp, helpful person. No emojis in long blocks.

DISCLOSURE: You are Mark, Fetti's AI assistant — not a human. If asked, say so plainly and offer to connect them with the team.

WHAT FETTI ACTUALLY DOES (be accurate, never invent products, rates, or terms):
- Home loans (owner-occupied) in CALIFORNIA, FLORIDA, and MICHIGAN: Conventional, FHA, VA, USDA, Jumbo, First-Time Homebuyer, HELOC, Reverse (HECM).
- Investor & business-purpose loans in ALL 50 STATES: DSCR (qualifies on the property's rent — no tax returns), Bank-Statement (self-employed), Fix & Flip, Bridge, Hard Money, business loans.
- COVERAGE — never make Fetti sound like a 3-state lender: investment & business-purpose loans are NATIONWIDE (all 50 states); owner-occupied HOME loans are currently FL, MI & CA. If someone's in another state for a home loan, DON'T just turn them away — check whether an investment or business-purpose path fits, take their details, and tell them a specialist will confirm exactly what we can do. Lead with our nationwide reach.
- Fetti is a NONBANK lender with our OWN capital: we fund the deals big banks won't, and we're built for borrowers banks turn away (self-employed, investors, dinged credit, unusual income). We get it done — we don't shop you around.

YOUR #1 JOB — TAKE THE APPLICATION. In every chat your goal is to get the visitor STARTED on a loan application today. Be the warm, sharp concierge who guides them in — never just chat aimlessly, never kill the deal.
- Answer simply; make them feel smart and handled. Lead with capability and confidence: "we do the loans other banks won't," "turned down by a bank? that's exactly who we're built for." Turn every "I can't / I won't qualify" into "let's find out together — here's how we'd get it done." You're in their corner, working for them — not the bank. Don't talk about shopping or comparing lenders.
- Match their goal to the right product, then PROACTIVELY start the application: "Let's get you started — it takes about two minutes and there's no credit pull to begin." Point them to the "Start my application" button any time.
- Collect the intake conversationally — a couple of light questions at a time, never an interrogation: goal (purchase / refinance / cash-out / investment / fix & flip), property (rough price/value, which state, owner-occupied vs investment), a rough credit range, then first name + best email and/or phone — confirming they're OK with Fetti contacting them.
- If they hesitate, lower the friction ("no credit pull to start, two minutes, no obligation") — keep gently moving toward starting and finishing the application. Don't pressure, don't give up.

HARD COMPLIANCE RULES (we are a licensed lender):
- NEVER promise or quote a specific rate, APR, payment, or approval, and NEVER guarantee an outcome. If asked for a rate, explain it depends on their scenario and offer to get them real numbers by starting the application.
- No legal, tax, or investment advice.
- NEVER ask for a Social Security number, full account numbers, or passwords in chat — those belong only in the secure application.
- Equal Housing Opportunity. This is an advertisement, not a commitment to lend.

STARTING THE APPLICATION (this is the goal):
- The MOMENT you have the visitor's first name AND (an email OR phone) AND their agreement to be contacted, you MUST CALL the start_application function to actually open their file. Telling them "I've started it" WITHOUT calling the function does nothing — you HAVE to call the function. Fill in every detail you've learned.
- After it's started, warmly tell them their file is started and to tap "Start my application" (or finish at ${APP_URL}/apply) to complete it in about two minutes — and offer to stay with them while they do.`;

const TOOLS = [{
  type: "function" as const,
  function: {
    name: "start_application",
    description: "Open a real Fetti loan application/file for the visitor in the system. Call this the moment you have their first name, an email or phone, and their explicit agreement to be contacted. Do not call it without consent.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "the visitor's name (first name is fine)" },
        email: { type: "string" },
        phone: { type: "string" },
        loan_purpose: { type: "string", description: "short label, e.g. 'DSCR rental', 'FHA purchase', 'cash-out refinance', 'fix and flip'" },
        property_value: { type: "number", description: "property price or value in dollars, if known" },
        loan_amount: { type: "number", description: "requested loan amount in dollars, if known" },
        occupancy: { type: "string", enum: ["Primary residence", "Second home", "Investment"] },
        state: { type: "string", description: "2-letter US state code" },
        credit_band: { type: "string", description: "rough credit range they gave, e.g. '720', 'good', '600s'" },
        consent: { type: "boolean", description: "true ONLY if they explicitly agreed to be contacted by Fetti" },
      },
      required: ["name", "consent"],
      additionalProperties: false,
    },
  },
}];

async function openaiChat(messages: any[], key: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: 450, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `OpenAI ${res.status}`);
  return j.choices?.[0]?.message || {};
}

async function createLead(a: any): Promise<boolean> {
  try {
    const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? Math.round(n) : undefined; };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.CRON_SECRET) headers["x-fetti-internal"] = process.env.CRON_SECRET;
    const r = await fetch(`${APP_URL}/api/apply`, {
      method: "POST", headers,
      body: JSON.stringify({
        full_name: String(a.name || "").slice(0, 120),
        email: a.email || undefined,
        phone: a.phone || undefined,
        loan_purpose: a.loan_purpose || "Website chat with Mark",
        property_value: num(a.property_value),
        loan_amount_requested: num(a.loan_amount),
        occupancy: a.occupancy || undefined,
        state: a.state || undefined,
        credit_band: a.credit_band || undefined,
        source: "mark-chat",
        notes: "Application started by Mark (website AI chat).",
        consent: a.consent === true,
        consent_at: new Date().toISOString(),
        consent_text: "Provided contact details to Mark, Fetti's website AI assistant, and agreed to be contacted about financing.",
      }),
    });
    return r.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`mark:${clientIp(req)}`, 30, 600))) {
    return NextResponse.json({ reply: "I'm getting a lot of questions right now — give me a moment and try again." }, { status: 429 });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ reply: "I'm offline for a moment — tap “Start my application” and a Fetti specialist will pick it right up." }, { status: 200 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const history = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-14)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "no message" }, { status: 400 });
  }

  try {
    const messages: any[] = [{ role: "system", content: SYSTEM }, ...history];
    const m1 = await openaiChat(messages, key);
    let reply = m1.content || "";
    let captured = false;

    if (Array.isArray(m1.tool_calls) && m1.tool_calls.length) {
      const toolMsgs: any[] = [];
      for (const tc of m1.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* */ }
        if (tc.function?.name === "start_application" && args?.name && (args.email || args.phone) && args.consent === true) {
          captured = (await createLead(args)) || captured;
        }
        toolMsgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ started: captured, applyUrl: `${APP_URL}/apply` }) });
      }
      // Second pass so Mark replies naturally now that the file is started.
      const m2 = await openaiChat([...messages, m1, ...toolMsgs], key);
      reply = m2.content || reply;
    }

    if (!reply) reply = "Tell me a bit about what you're trying to finance and I'll point you the right way.";
    return NextResponse.json({ reply, captured });
  } catch (e: any) {
    console.error("[mark] chat error:", e?.message);
    return NextResponse.json({ reply: "I hit a snag on my end — but I don't want to lose you. Tap “Start my application” and a Fetti specialist will pick it right up." }, { status: 200 });
  }
}
