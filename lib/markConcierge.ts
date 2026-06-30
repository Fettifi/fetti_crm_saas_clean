// Mark — the SMS concierge. Turns one-way nurture drips into REAL two-way
// conversations: when a lead texts back, Mark (Fetti's compliant spokesperson AI)
// reads the whole thread + their context and replies like a sharp, helpful person,
// driving them toward finishing their application. Same persona + hard compliance
// rules as the website chat (/api/mark), tuned for SMS. Best-effort: never throws,
// returns ok:false (caller falls back to a human task) if anything goes wrong.
import { MARK_PERSONA } from "@/lib/markPersona";

const MODEL = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export type ChatTurn = { role: "user" | "assistant"; content: string };

// Owner-occupied HOME loans are licensed only in CA/FL/MI (investor/business-purpose
// is nationwide). These keywords are consumer/owner-occupied-only products.
const OWNER_OCC_STATES = new Set(["CA", "FL", "MI"]);
const OWNER_OCC_KEYWORDS = /\b(fha|va loan|va mortgage|usda|reverse mortgage|hecm|primary residence|owner[- ]occupied)\b/i;
// Hard-forbidden in a licensed lender's outbound: a specific rate/APR/%, or an
// approval guarantee. Plain talk of "rates depend on your scenario" is fine (no number).
const RATE_PROMISE = /(\b\d{1,2}(\.\d{1,3})?\s?%)|\bapr\b|\b\d(\.\d+)?\s?percent\b/i;
const APPROVAL_PROMISE = /\b(guarantee|guaranteed)\b|\byou(?:'?re| are)\s+(pre-?)?approved\b|\bguaranteed approval\b|\b100%\s+approv/i;

// Deterministic post-generation safety net — runs regardless of model temperature.
// Returns a SAFE deferral (no numbers, drives to the secure app + a human follow-up)
// if the draft promises rates/approvals or offers an out-of-area home loan, and forces
// the CA SB 1001 AI disclosure on the first reply.
function complianceGate(reply: string, ctx: { firstAiReply: boolean; state?: string | null; fileLink?: string | null; calendlyUrl?: string | null }): { reply: string; flagged: boolean } {
  const stateOk = ctx.state ? OWNER_OCC_STATES.has(String(ctx.state).toUpperCase().trim()) : true;
  const offersOwnerOccOutOfArea = !stateOk && OWNER_OCC_KEYWORDS.test(reply);
  if (RATE_PROMISE.test(reply) || APPROVAL_PROMISE.test(reply) || offersOwnerOccOutOfArea) {
    const link = ctx.fileLink ? ` ${ctx.fileLink}` : "";
    // Safe deferral always offers BOTH paths: finish the secure app, OR book a call.
    const book = ctx.calendlyUrl ? ` Prefer to talk it through? Grab a time with us: ${ctx.calendlyUrl}` : ` I'll have a Fetti specialist follow up too.`;
    return {
      reply: `It's Mark, Fetti's AI assistant. Your exact numbers depend on your scenario, so I won't quote something off — the fastest way to real options is to finish your secure application (about 2 minutes, no credit pull):${link}${book}`,
      flagged: true,
    };
  }
  if (ctx.firstAiReply && !/\b(ai assistant|fetti'?s ai|i'?m mark|it'?s mark|a bot)\b/i.test(reply)) {
    return { reply: `It's Mark, Fetti's AI assistant — ${reply}`, flagged: false };
  }
  return { reply, flagged: false };
}

function systemPrompt(lead: any, fileLink?: string | null, firstAiReply?: boolean, calendlyUrl?: string | null): string {
  const name = (lead?.first_name || lead?.full_name || "").split(" ")[0] || "there";
  const ctx = [
    name ? `Their first name: ${name}.` : "",
    lead?.loan_purpose ? `What they came in for: ${lead.loan_purpose}.` : "",
    lead?.state ? `State: ${lead.state}.` : "",
    fileLink ? `Their secure file/application link (share it when it helps them move forward): ${fileLink}` : `If they're ready to start, point them to ${APP_URL}/apply.`,
    calendlyUrl ? `Booking link — if they'd rather talk to a person, are stalling on the form, ask a question best answered live, or ask for a human, offer to book a quick call here: ${calendlyUrl}` : "",
  ].filter(Boolean).join(" ");

  return `${MARK_PERSONA}

YOU ARE TEXTING (SMS) a lead/borrower of Fetti Financial Services LLC (NMLS #2267023), a NONBANK mortgage lender that funds the deals big banks won't. This is a real back-and-forth text conversation — they replied to one of our follow-ups.

STYLE: SMS-short. 1–3 sentences, warm, plain-English, ONE idea per text. No emojis, no sign-off on every message, no walls of text. Talk like a sharp, helpful person — not a script.

DISCLOSURE: You are Mark, Fetti's AI assistant — NOT a human.${firstAiReply ? " Because this is your first reply in this conversation, make clear early and naturally that you're Fetti's AI assistant (e.g. \"It's Mark, Fetti's AI assistant\")." : " If they ask whether you're a bot/human, say plainly you're Fetti's AI assistant."} Any time they want a person, offer to connect them with the team.

YOUR JOB: re-engage and help them move forward — answer their question simply, build confidence ("we fund the deals banks won't," "turned down before? that's exactly who we're built for"), then drive to ONE of two next steps, whichever fits them: (A) finish their secure application (about two minutes, no credit pull to start), or (B) book a quick call using the booking link above. Read the signal: if they're ready/DIY, push the app; if they're hesitant, have questions best answered live, or ask to "talk to someone / a human," offer to book the call. Always give a clear next step. Don't be pushy; don't give up; lower friction.

CONTEXT: ${ctx}

HARD COMPLIANCE (licensed lender — never break these):
- NEVER promise/quote a specific rate, APR, payment, or approval; NEVER guarantee an outcome. If asked for a rate, say it depends on their scenario and offer to get real numbers by finishing the application.
- No legal, tax, or investment advice.
- NEVER ask for a full SSN, full account numbers, or passwords over text — those belong only in the secure application.
- Equal Housing Opportunity. This is an advertisement, not a commitment to lend.
- WHAT FETTI DOES (don't invent products): owner-occupied home loans (Conventional/FHA/VA/USDA/Jumbo/HELOC/Reverse) in CA, FL, MI; investor & business-purpose (DSCR, bank-statement, fix & flip, bridge, hard money) NATIONWIDE.
- If they clearly want to STOP/opt out, don't argue — a separate system handles opt-outs.`;
}

/**
 * Generate Mark's next SMS reply for a lead, given the prior conversation.
 * `history` is oldest→newest, the lead's latest inbound text LAST (role:"user").
 */
export async function markConciergeReply(opts: {
  lead: any;
  history: ChatTurn[];
  fileLink?: string | null;
  firstAiReply?: boolean;
  calendlyUrl?: string | null;
}): Promise<{ ok: boolean; reply?: string; flagged?: boolean; detail: string }> {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, detail: "no OPENAI_API_KEY" };
    const history = (opts.history || [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-14)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
    if (!history.length || history[history.length - 1].role !== "user") return { ok: false, detail: "no inbound to answer" };

    const messages = [{ role: "system", content: systemPrompt(opts.lead, opts.fileLink, opts.firstAiReply, opts.calendlyUrl) }, ...history];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: 200, messages }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, detail: j?.error?.message || `OpenAI ${res.status}` };
    let reply = String(j.choices?.[0]?.message?.content || "").trim();
    if (!reply) return { ok: false, detail: "empty reply" };
    // Deterministic compliance gate (never trust a temp>0 model with rate/approval/
    // licensing rules): swap in a safe deferral if needed + force first-reply disclosure.
    const gate = complianceGate(reply, { firstAiReply: !!opts.firstAiReply, state: opts.lead?.state, fileLink: opts.fileLink, calendlyUrl: opts.calendlyUrl });
    reply = gate.reply;
    // SMS hygiene: cap length (~2 segments) and ensure a compliant opt-out cue.
    if (reply.length > 600) reply = reply.slice(0, 590).replace(/\s+\S*$/, "") + "…";
    if (!/\bstop\b/i.test(reply)) reply = `${reply} (Reply STOP to opt out.)`;
    return { ok: true, reply, flagged: gate.flagged, detail: gate.flagged ? "compliance-deferred" : "ok" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}
