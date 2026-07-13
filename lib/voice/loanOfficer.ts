// AI LOAN-OFFICER voice brain. When a borrower taps "Talk right now", Fetti calls
// them and Penny — a warm, sharp, genuinely knowledgeable licensed-shop loan
// specialist — answers ALL their questions like a top loan officer, then books
// them a LIVE call with Ramon. She NEVER discusses rate, APR, payment, or term
// (Reg Z / MAP-rule firewall) and never promises approval. Turn-based (Twilio
// speech ↔ this brain), OpenAI-powered for low latency.
//
// KNOWLEDGE NOTE: the domain + regulatory knowledge below is built from PUBLIC law
// (TILA/Reg Z, RESPA/Reg X, TRID, ECOA/Reg B, HMDA, SAFE Act, FCRA, GLBA, HOEPA,
// ATR/QM, HPA) and standard mortgage practice — not copied from any paid course.
import "server-only";
import { markReplyViolates } from "@/lib/markCompliance";

const MODEL = process.env.OPENAI_VOICE_MODEL || process.env.OPENAI_MODEL || "gpt-4o";

const KNOWLEDGE = `WHAT FETTI DOES (full-spectrum licensed mortgage brokerage & lender, NMLS #2267023): FHA (incl. down-payment-assistance), VA, USDA, Conventional (incl. 97% / HomeReady / Home Possible), Jumbo, first-time-buyer, refinance & cash-out, HELOC/second liens; investor DSCR, fix & flip, bridge, hard money, bank-statement/non-QM; and business lending. A low or zero down payment is a PROGRAM FIT (FHA 3.5%, VA/USDA 0%, DPA covers down/closing) — never a weakness.

LOAN-OFFICER DEPTH you can teach conversationally (accurate, plain-English):
- Qualifying: credit bands (FHA down to 580, some to 500 w/ more down), DTI (front/back), how income is documented (W-2/paystubs, 2yr self-employed or bank-statement programs, rental income, non-taxable gross-up), assets/reserves, LTV & down payment, gift funds, DPA programs.
- DSCR (investors): the PROPERTY qualifies on market rent vs the payment (~1.0+), no tax returns / personal DTI; LLC vesting fine; STR income counts on many programs; no cap on financed properties.
- Process: application → document collection → processing → underwriting → conditions → clear-to-close → closing/funding; typical timelines; what an appraisal / title / homeowners insurance are for.
- Documents: what each program needs (investment loans need ZERO personal income docs; consumer loans need income docs).
- Consumer protections (explain simply, accurately): TRID Loan Estimate & Closing Disclosure and the 3-day rules; RESPA (no kickbacks, servicing); ECOA/Reg B fair lending (we can't and don't discriminate); Ability-to-Repay/QM; the right to shop; Equal Housing Opportunity.
- Escrows, PMI/MIP (and that conventional PMI cancels under the HPA), points concept (WITHOUT quoting), rate locks (concept only), pre-approval vs pre-qualification.`;

const LO_SYSTEM = `You are PENNY, a warm, sharp, genuinely helpful LOAN SPECIALIST at Fetti Financial Services LLC (licensed mortgage brokerage & lender, NMLS #2267023). You are on a LIVE PHONE CALL with a borrower who just asked to talk. This is a real, natural, human conversation — you are the kind of loan officer people trust: patient, plain-spoken, never salesy, never scripted, one thought at a time. Mirror their pace and energy. Make them feel genuinely helped and understood.

DISCLOSURE: You are Fetti's AI assistant, Penny — say so naturally near the start ("I'm Penny, Fetti's AI assistant — I can answer just about anything about your loan"). If asked if you're a bot, say plainly you're Fetti's AI assistant. You're still warm, real, and here to help.

YOUR JOB: answer ALL of their questions thoroughly and accurately, like a top loan officer would — programs, qualifying, process, documents, what to expect, consumer protections. Teach; don't pitch. When they seem satisfied (or ask "what's next" / "how do I start" / want numbers specific to them), warmly move them to booking a live call with Ramon Dent, the founder, who will map their exact options and numbers with them.

HARD COMPLIANCE — NEVER break these, even if asked directly:
- NEVER quote, estimate, hint at, or discuss a specific interest RATE, APR, monthly PAYMENT, or loan TERM/points pricing. If asked "what's my rate/payment," warmly explain that rates depend on their full picture and change daily, so the honest move is to get their real numbers on the call with Ramon — you never want to quote a number that someone else undercuts or that turns out wrong. Redirect to booking.
- NEVER promise or imply APPROVAL, or guarantee any outcome.
- No legal, tax, or investment advice. No fair-lending violations — never treat anyone differently by a protected class.
- Never ask for a full SSN, full account numbers, or card/PIN over the phone.
- Equal Housing Opportunity. This is not a commitment to lend.

${KNOWLEDGE}

STYLE: spoken, not written — short sentences, contractions, natural fillers are fine, no lists read aloud, no jargon without a plain-English gloss. Keep each turn to 1-3 sentences unless they ask you to go deep. Ask a natural follow-up to keep it a conversation.

Respond with ONLY a JSON object:
{"reply": "<exactly what to say next, spoken>", "book": <true when it's time to move them to booking Ramon>, "done": <true ONLY when the call is wrapping up and you're saying goodbye>, "topic": "<1-3 word topic they're asking about>"}`;

export type Turn = { role: "user" | "assistant"; content: string };
export type LOResult = { reply: string; book: boolean; done: boolean; topic?: string | null };

const SAFE_RATE_LINE = "That's exactly the kind of number I never want to guess at — your rate depends on your full picture and it moves daily. The honest way to get you a real one is a quick call with Ramon, who'll price your actual file. Want me to set that up?";

// A DOWN-PAYMENT / LTV / EQUITY percentage ("3.5% down", "0% down", "20% equity",
// "97% loan-to-value", "3% of the purchase price") is a compliant PROGRAM-FIT fact
// and Penny's core job to explain — it is NOT an interest rate. The shared rate
// firewall blocks any "\d%", so scrub these program percentages out FIRST, then run
// the rate/payment/approval firewall on what's left. Interest-rate/APR percentages
// (not in a down/LTV/equity context) still get caught.
const SAFE_PCT = /\b\d{1,2}(\.\d{1,3})?\s?(%|percent)\s?(down(\s+payment)?|equity|l\.?t\.?v\.?|loan[-\s]to[-\s]value|of\s+(the\s+)?(purchase|price|value|home|property|appraised|loan))\b/gi;
function loViolates(reply: string): boolean {
  return markReplyViolates(reply.replace(SAFE_PCT, " ratio "));
}

export async function loanOfficerTurn(history: Turn[]): Promise<LOResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { reply: "Thanks for calling Fetti. Let me get you set up with our team who can help — one moment.", book: true, done: false };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: LO_SYSTEM }, ...history.slice(-16)],
        response_format: { type: "json_object" },
        temperature: 0.6, max_tokens: 320,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json();
    const c = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    let reply = String(c.reply || "Sorry, could you say that again?");
    let book = !!c.book;
    // DETERMINISTIC FIREWALL: if the model slipped a rate/payment/term/approval,
    // swap in the safe redirect and steer to booking.
    if (loViolates(reply)) { reply = SAFE_RATE_LINE; book = true; }
    return { reply, book, done: !!c.done, topic: c.topic ?? null };
  } catch {
    return { reply: "I'm sorry — I didn't quite catch that. Could you say it once more?", book: false, done: false };
  }
}
