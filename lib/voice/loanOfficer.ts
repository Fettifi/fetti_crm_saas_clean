// AI LOAN-OFFICER voice brain. When a borrower taps "Talk right now", Fetti calls
// them and Penny — a warm, sharp, genuinely knowledgeable licensed-shop loan
// specialist — answers ALL their questions like a top loan officer, then books
// them a LIVE call with Ramon. She NEVER discusses rate, APR, payment, or term
// (Reg Z / MAP-rule firewall) and never promises approval. Turn-based (Twilio
// speech ↔ this brain), OpenAI-powered for low latency.
//
// KNOWLEDGE NOTE: Penny's mortgage + regulatory knowledge is grounded in Ramon's
// LICENSED Mortgage Educators & Compliance pre-licensing course (he has express
// permission to train Fetti's AI on it — see memory: mec-course-license), mined
// into Fetti's own words, verified for no-verbatim + compliance. The two CORE
// blocks live in the prompt; deeper topic detail is retrieved per-turn from
// lib/voice/mortgageKB (kbContextFor) so the base prompt stays lean/fast.
import "server-only";
import { markReplyViolates } from "@/lib/markCompliance";
import { CORE_PRODUCTS, CORE_LAW, kbContextFor } from "@/lib/voice/mortgageKB";

const MODEL = process.env.OPENAI_VOICE_MODEL || process.env.OPENAI_MODEL || "gpt-4o";

const KNOWLEDGE = `${CORE_PRODUCTS}

${CORE_LAW}`;

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

STYLE: spoken, not written — short sentences, contractions, natural fillers are fine, no lists read aloud, no jargon without a plain-English gloss. Keep each turn to 1-3 sentences unless they ask you to go deep, and even then stay conversational — one flowing spoken answer, then a natural follow-up question. NEVER use markdown, asterisks, bold, bullet points, numbered lists, or headings — you are SPEAKING out loud, not writing.

Respond with ONLY a JSON object:
{"reply": "<exactly what to say next, spoken>", "book": <true when it's time to move them to booking Ramon>, "done": <true ONLY when the call is wrapping up and you're saying goodbye>, "topic": "<1-3 word topic they're asking about>"}`;

export type Turn = { role: "user" | "assistant"; content: string };
export type LOResult = { reply: string; book: boolean; done: boolean; topic?: string | null };

const SAFE_RATE_LINE = "That's exactly the kind of number I never want to guess at — your rate depends on your full picture and it moves daily. The honest way to get you a real one is a quick call with Ramon, who'll price your actual file. Want me to set that up?";

// Penny teaches PROGRAM percentages constantly — down payment, LTV, equity, DTI, MI
// premiums, funding/guarantee fees, PMI-cancellation thresholds (80%/78%). Those are
// facts, NOT the interest RATE / APR / PAYMENT / TERM the compliance rule targets.
// Natural speech scatters the context before, after, or around the number ("LTV is
// above 90%", "terminates at 78%", "80% of the value", "up to 50% DTI"), so a scrub
// that requires the keyword to sit right after the % misses most of them. Instead we
// look at the ~45-char window around each percentage: if it reads as PROGRAM context
// and NOT rate context, treat it as a fact and scrub it; otherwise leave it for the
// shared rate/payment/approval firewall. A bare "you'd be at 7%" (no program context)
// stays and gets caught.
const PCT_TOKEN = /\b\d{1,2}(\.\d{1,3})?\s?(%|percent)/gi;
const PROGRAM_CTX = /(down|equity|\bl\.?t\.?v\.?\b|loan[-\s]?to[-\s]?value|mortgage insurance|\bmip\b|\bpmi\b|ufmip|premium|funding fee|guarantee fee|\bdti\b|debt[-\s]?to[-\s]?income|credit|score|\bvalue\b|appraised|purchase price|cancel|terminat|\breach|balance|financ|reserve|owners?|ownership|\bown\b|\bstake\b|self[-\s]?employ|business|gift|seasoned|closing cost|area median)/i;
const RATE_CTX = /(\brate\b|\bapr\b|interest rate|note rate|\bpoints?\b|percentage rate)/i;
function loViolates(reply: string): boolean {
  const scrubbed = reply.replace(PCT_TOKEN, (...a: unknown[]) => {
    const m = a[0] as string;
    const off = a[a.length - 2] as number;
    const str = a[a.length - 1] as string;
    const w = str.slice(Math.max(0, off - 45), off + m.length + 45).toLowerCase();
    return PROGRAM_CTX.test(w) && !RATE_CTX.test(w) ? " ratio " : m;
  });
  return markReplyViolates(scrubbed);
}

// The reply is SPOKEN by TTS — strip any markdown the model slips in (bold, headers,
// bullets, numbered lists) so ElevenLabs never reads "asterisk asterisk" out loud.
function toSpoken(s: string): string {
  return String(s || "")
    .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1").replace(/[#`>_*]/g, "")
    .replace(/^\s*[-•]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

// Parse the model's JSON. If it truncated at the token limit, salvage the reply
// text and the book/done flags so Penny still says something useful — never a dead
// "I didn't catch that" on a good, long answer that ran past max_tokens.
function parseLO(raw: string): { reply: string; book: boolean; done: boolean; topic: string | null } {
  try {
    const c = JSON.parse(raw);
    return { reply: String(c.reply || ""), book: !!c.book, done: !!c.done, topic: (c.topic ?? null) as string | null };
  } catch {
    const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const reply = m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\\\\/g, "\\") : "";
    return { reply, book: /"book"\s*:\s*true/.test(raw), done: /"done"\s*:\s*true/.test(raw), topic: null };
  }
}

export async function loanOfficerTurn(history: Turn[]): Promise<LOResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { reply: "Thanks for calling Fetti. Let me get you set up with our team who can help — one moment.", book: true, done: false };
  try {
    // Retrieve deep, verified detail for whatever they just asked about and inject
    // it as a one-turn reference note (keeps the base prompt lean, depth on demand).
    const lastUser = [...history].reverse().find((t) => t.role === "user")?.content || "";
    const kb = kbContextFor(lastUser, 3);
    const messages = [
      { role: "system", content: LO_SYSTEM },
      ...(kb ? [{ role: "system", content: kb }] : []),
      ...history.slice(-16),
    ];
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.6, max_tokens: 420,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json();
    const parsed = parseLO(j.choices?.[0]?.message?.content || "{}");
    let reply = toSpoken(parsed.reply) || "Sorry, could you say that again?";
    let book = parsed.book;
    // DETERMINISTIC FIREWALL: if the model slipped a rate/payment/term/approval,
    // swap in the safe redirect and steer to booking.
    if (loViolates(reply)) { reply = SAFE_RATE_LINE; book = true; }
    return { reply, book, done: parsed.done, topic: parsed.topic };
  } catch {
    return { reply: "I'm sorry — I didn't quite catch that. Could you say it once more?", book: false, done: false };
  }
}
