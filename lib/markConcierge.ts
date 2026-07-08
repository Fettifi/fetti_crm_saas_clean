// Mark — the SMS concierge. Turns one-way nurture drips into REAL two-way
// conversations: when a lead texts back, Mark (Fetti's compliant spokesperson AI)
// reads the whole thread + their context and replies like a sharp, helpful person,
// driving them toward finishing their application. Same persona + hard compliance
// rules as the website chat (/api/mark), tuned for SMS. Best-effort: never throws,
// returns ok:false (caller falls back to a human task) if anything goes wrong.
import { MARK_PERSONA, MARK_CONVERSATION } from "@/lib/markPersona";

const MODEL = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

export type ChatTurn = { role: "user" | "assistant"; content: string };

// Owner-occupied HOME loans are licensed only in CA/FL/MI (investor/business-purpose
// is nationwide). These keywords are consumer/owner-occupied-only products.
const OWNER_OCC_STATES = new Set(["CA", "FL", "MI"]);
const OWNER_OCC_KEYWORDS = /\b(fha|va loan|va mortgage|usda|reverse mortgage|hecm|primary residence|owner[- ]occupied)\b/i;
// Hard-forbidden in a licensed lender's outbound: a specific rate/APR/%, or an
// approval guarantee. Plain talk of "rates depend on your scenario" is fine (no number).
// A percentage is only a RATE QUOTE when tied to offer language ("your rate",
// "we can get you", "today's", "as low as", or "X% rate/APR"). Bare program
// mechanics ("3.5% down", "up to 3.5% of the price", "1% simple interest",
// "0.55%/yr MIP") are TEACHING and must pass — the old any-percent regex
// deferred every expert answer into the generic fallback (fixed 2026-07-08).
const RATE_PROMISE = /(\b(your|you'?d|you can lock|we (can|could|will) (get|offer|do|lock)|today'?s|current(ly)?|as low as|starting at|quote you)\b[^.!?\n]{0,28}\d{1,2}(\.\d{1,3})?\s?%)|(\d{1,2}(\.\d{1,3})?\s?%\s?(apr|rate\b|interest rate))|\bapr\b/i;
const APPROVAL_PROMISE = /\b(guarantee|guaranteed)\b|\byou(?:'?re| are)\s+(pre-?)?approved\b|\bguaranteed approval\b|\b100%\s+approv/i;
// A specific monthly PAYMENT quote (implies a rate) — also forbidden.
const PAYMENT_PROMISE = /(\$\s?\d[\d,]*(\.\d+)?\s*(\/\s?mo\b|per month|a month|monthly|\bmo\b))|((monthly payment|your payment|the payment|payment would|payment could|principal and interest)[^.!?\n]{0,40}\$\s?\d[\d,]*)/i;

// Deterministic post-generation safety net — runs regardless of model temperature.
// Returns a SAFE deferral (no numbers, drives to the secure app + a human follow-up)
// if the draft promises rates/approvals or offers an out-of-area home loan, and forces
// the CA SB 1001 AI disclosure on the first reply.
function complianceGate(reply: string, ctx: { firstAiReply: boolean; state?: string | null; fileLink?: string | null; appLink?: string | null; calendlyUrl?: string | null }): { reply: string; flagged: boolean } {
  const stateOk = ctx.state ? OWNER_OCC_STATES.has(String(ctx.state).toUpperCase().trim()) : true;
  const offersOwnerOccOutOfArea = !stateOk && OWNER_OCC_KEYWORDS.test(reply);
  if (RATE_PROMISE.test(reply) || APPROVAL_PROMISE.test(reply) || PAYMENT_PROMISE.test(reply) || offersOwnerOccOutOfArea) {
    // Prefer the PRE-FILLED application link in the safe deferral — it's the converting CTA.
    const link = ctx.appLink ? ` ${ctx.appLink}` : ctx.fileLink ? ` ${ctx.fileLink}` : "";
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

export const MARK_EXPERTISE: Record<string, string> = {
  "dpa": "California's flagship is CalHFA MyHome: up to 3.5% of the purchase price with an FHA first (3% with conventional) as a deferred junior lien at 1% simple interest \u2014 no monthly payment, repaid only at sale, refinance, or payoff; 'first-time buyer' means no ownership interest in the last 3 years, ALL borrowers must occupy, and county income limits plus a short online homebuyer course apply. So when a parent asks for a child: the child is the borrower \u2014 a non-occupant parent can't go on a CalHFA loan, but can supply gift funds with a one-page gift letter, or co-sign a plain FHA loan instead (FHA allows non-occupant co-borrowers). Florida has FL Assist (up to $10K, 0%, deferred) plus Hometown Heroes for eligible workers; Michigan's MSHDA MI 10K is a $10K, 0%, deferred second. Key reframe: most DPA is real money at closing that's deferred \u2014 not a monthly bill \u2014 and the buyer still credit-qualifies for the first mortgage like any other loan.",
  "fha_firsttime": "FHA takes 3.5% down at a 580+ score (10% down at 500\u2013579), and you do NOT have to be a first-time buyer \u2014 the most common myth. The entire down payment can be gift funds from family with a signed gift letter, a parent can strengthen the file as a non-occupant co-borrower, sellers can credit up to 6% toward closing costs, and DTI can stretch past 50% with automated-underwriting approval. Tradeoff to teach honestly: 1.75% upfront mortgage insurance financed into the loan plus roughly 0.55%/yr monthly MIP, which at minimum down stays for the life of the loan \u2014 the standard exit is refinancing to conventional once you're near 20% equity.",
  "dscr": "A DSCR loan qualifies the PROPERTY, not you: the appraiser's market-rent report (form 1007) divided by the full payment (principal, interest, taxes, insurance, HOA) at roughly 1.0+ gets the best terms \u2014 no tax returns, no W-2s, no personal DTI, and some programs go below 1.0 (even no-ratio) with more down. Typical shape: 20\u201325% down, LLC vesting is fine, a vacant unit still works because market rent is what counts, short-term-rental income counts on many programs, and there's no cap on financed properties \u2014 this is how investors scale past conventional's 10-loan limit. Flag early: most DSCR loans carry a 3-year step-down prepayment penalty (3-2-1) that can be bought down or out if they plan to sell or refi soon.",
  "bank_statement": "Bank-statement loans qualify self-employed borrowers on 12\u201324 months of deposits instead of tax returns \u2014 the write-offs that shrink taxable income stop shrinking buying power, which is usually the whole point. Business accounts typically get credit for about 50% of gross deposits as income (higher with a CPA-prepared expense letter); personal accounts count near 100% of qualifying deposits once transfers are backed out. Usually needs about 2 years of self-employment and roughly 10% minimum down with strong credit, and the pricing runs a notch above agency loans \u2014 name that tradeoff up front.",
  "fix_flip": "Fix & flip money is priced off the deal, not personal DTI: typically up to ~85\u201390% of the purchase price plus 100% of the rehab budget, capped around 70\u201375% of the after-repair value (ARV). It runs 12\u201318 months interest-only, rehab funds sit in escrow and release in draws as inspections confirm work, and many programs charge interest only on funds actually drawn. First-timers can still get funded \u2014 documented completed flips just improve leverage and pricing. The number that makes or kills the deal is the ARV, so the comps conversation is the real first step, and the exit plan (sell, or refi into a DSCR loan) is part of the approval.",
  "heloc": "A HELOC sits in second position BEHIND the existing mortgage, so the low first-mortgage rate stays completely untouched \u2014 that's the whole reason it beats a cash-out refi for most people right now. Typical structure: up to ~85\u201390% combined loan-to-value depending on credit, a ~10-year draw period at interest-only minimums, and a variable rate tied to Prime plus a margin \u2014 worth naming so nobody's surprised. You only pay interest on what you actually draw, so an untapped line costs essentially nothing beyond a small annual fee, and interest may be tax-deductible when the funds substantially improve the home (their CPA confirms).",
  "va": "VA is 0% down with NO monthly mortgage insurance \u2014 and with full entitlement there's no loan limit. The cost is a one-time funding fee (2.15% first use at zero down, 3.3% after) that can be financed into the loan and is fully waived for veterans with a service-connected disability rating. Qualifying leans on residual income rather than a hard DTI cap, so VA often approves files conventional turns down; sellers can pay all closing costs, and VA loans are assumable \u2014 a genuine asset when they sell later.",
  "credit_challenged": "FHA works down to a 580 score at 3.5% down (500\u2013579 with 10% down), and the score a lender pulls is a mortgage FICO \u2014 often different from the Credit Karma number, so get the real one before assuming anything. The highest-leverage levers are paying revolving cards below ~30% of their limits (ideally under 10%) before the statement date and a lender rapid rescore once paid \u2014 never promise a specific score gain or timeline. Recent events carry real waiting periods (FHA: about 2 years after Chapter 7, 3 after foreclosure \u2014 sometimes shorter with documented extenuating circumstances), and non-QM options can go sooner with more down. Get the actual score and the actual event before prescribing \u2014 the plan at 550 is different from the plan at 620.",
  "rates_question": "Never quote or promise a rate or payment by text \u2014 instead, teach what actually sets THEIR rate: credit band (720 vs 680 is real money), loan-to-value, occupancy (an investment property prices higher than a primary), property type, program, and whether they buy points. Rates move daily, so any number quoted without those inputs is a guess someone else will beat with a teaser. The honest path to a real number is the pre-filled application \u2014 about two minutes \u2014 which lets us price their actual file; if they have a lock deadline or a competitor's quote in hand, that pages the owner immediately.",
  "third_party_inquiry": "When someone asks for a daughter, parent, or friend: help the helper \u2014 teach the mechanism that applies to the actual borrower and be clear about roles. The buyer is the borrower; the helper's paths are gift funds (signed gift letter, no repayment \u2014 FHA allows a 100% gifted down payment), non-occupant co-borrower (FHA and conventional allow it, so their income can strengthen ratios), or co-signing \u2014 but occupancy-restricted programs like CalHFA require every borrower to live in the home, so a parent helps beside a CalHFA loan, not on it. Never collect personal financial details about a third party from the texter; the natural next step is looping the actual borrower in \u2014 forward the link or start a group text \u2014 because the application has to be theirs."
};

// Pick the expertise entries relevant to THIS lead + THIS message (purpose-based
// plus keyword scan of the latest inbound) — injected as EXPERTISE CONTEXT.
export function expertiseFor(lead: any, lastInbound: string): string[] {
  const p = String(lead?.loan_purpose || "").toLowerCase();
  const t = String(lastInbound || "").toLowerCase();
  const keys = new Set<string>();
  if (/dscr|rental|invest|multi/.test(p)) keys.add("dscr");
  if (/flip|bridge|rehab|hard/.test(p)) keys.add("fix_flip");
  if (/bank ?statement|self/.test(p)) keys.add("bank_statement");
  if (/heloc|equity/.test(p)) keys.add("heloc");
  if (/\bva\b/.test(p)) keys.add("va");
  if (/fha|first|purchase|homebuyer|down payment/.test(p)) keys.add("fha_firsttime");
  if (/down ?payment|dpa|assistance|calhfa|grant/.test(t + " " + p)) keys.add("dpa");
  if (/rate|apr|interest|percent|points?\b/.test(t)) keys.add("rates_question");
  if (/credit|score|fico|bankrupt|foreclos|collection/.test(t + " " + p)) keys.add("credit_challenged");
  if (/(my|for) (daughter|son|mom|mother|dad|father|wife|husband|sister|brother|friend|kid)/.test(t)) keys.add("third_party_inquiry");
  if (/self.?employ|1099|business owner|write.?off|tax return/.test(t)) keys.add("bank_statement");
  if (!keys.size) keys.add(/invest|dscr/.test(p) ? "dscr" : "fha_firsttime");
  return [...keys].slice(0, 3).map((k) => MARK_EXPERTISE[k]).filter(Boolean);
}

function systemPrompt(lead: any, fileLink?: string | null, firstAiReply?: boolean, calendlyUrl?: string | null, appLink?: string | null, missingDocs?: string[], knownFacts?: string[], expertise?: string[]): string {
  const name = (lead?.first_name || lead?.full_name || "").split(" ")[0] || "there";
  const ctx = [
    name ? `Their first name: ${name}.` : "",
    lead?.loan_purpose ? `What they came in for: ${lead.loan_purpose}. They TOLD us this — never ask what they're looking to do or whether they're interested; talk about THEIR deal.` : "",
    lead?.state ? `State: ${lead.state}.` : "",
    appLink ? `Their PRE-FILLED application link (everything they gave us is already typed in; ~3 minutes to finish, no credit pull). This is THE next step — share it whenever they show any forward intent: ${appLink}` : "",
    fileLink ? `Their secure document-upload/file-status link (for sending docs once the app is in): ${fileLink}` : (!appLink ? `If they're ready to start, point them to ${APP_URL}/apply.` : ""),
    calendlyUrl ? `Booking link — if they'd rather talk to a person, are stalling on the form, ask a question best answered live, or ask for a human, offer to book a quick call here: ${calendlyUrl}` : "",
    missingDocs && missingDocs.length ? `Their file is STILL MISSING these required documents: ${missingDocs.slice(0, 8).join("; ")}. When docs come up, be SPECIFIC — name exactly what's open, note easy workarounds, and reassure about the rest. Never say "if you need help gathering documents" generically.` : "",
    knownFacts && knownFacts.length ? `THINGS THEY'VE TOLD US in earlier conversations (reference naturally, NEVER re-ask): ${knownFacts.slice(0, 12).join(" | ")}` : "",
  ].filter(Boolean).join(" ");

  return `${MARK_PERSONA}

${MARK_CONVERSATION}

YOU ARE TEXTING (SMS) a lead/borrower of Fetti Financial Services LLC (NMLS #2267023), a NONBANK mortgage lender that funds the deals big banks won't. This is a real back-and-forth text conversation.

STYLE: SMS-short. 1–3 sentences chatting, up to 5 when teaching. Warm, plain-English, ONE idea per text. No emojis, no sign-off on every message, no walls of text, NO markdown — links go as bare URLs. Talk like a sharp, helpful person — not a script.

DISCLOSURE: You are Mark, Fetti's AI assistant — NOT a human.${firstAiReply ? " Because this is your first reply in this conversation, make clear early and naturally that you're Fetti's AI assistant (e.g. \"It's Mark, Fetti's AI assistant\")." : " If they ask whether you're a bot/human, say plainly you're Fetti's AI assistant."} Any time they want a person, offer to connect them with the team.

REMEMBER: this person came TO US and told us what they're working on — you already know their deal, so act like it. Answer what they actually asked, add one genuinely useful point about THEIR scenario, and keep the momentum: any sign of forward intent ("how do I…", "what's next", "ok", a question about numbers/timing) gets the pre-filled application link or the booking link from CONTEXT as the natural next step. Never re-ask things we know, never ask if they're interested, never open with document demands — but don't bury the next step behind small talk either.

CONTEXT: ${ctx}

EXPERTISE CONTEXT (teach from THESE specifics — mechanisms, numbers, rules; pick what fits their question):
${(expertise || []).map((e) => "• " + e).join("\n")}

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
  appLink?: string | null;   // magic pre-filled application link (the conversion CTA)
  firstAiReply?: boolean;
  calendlyUrl?: string | null;
  missingDocs?: string[];    // the file's open required docs — lets Mark answer "what's left?" precisely
  knownFacts?: string[];     // persisted conversation memory (lead.raw.concierge_facts)
  expertise?: string[];      // topic-matched teaching nuggets (expertiseFor)
}): Promise<{ ok: boolean; reply?: string; flagged?: boolean; detail: string }> {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, detail: "no OPENAI_API_KEY" };
    const history = (opts.history || [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-14)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
    if (!history.length || history[history.length - 1].role !== "user") return { ok: false, detail: "no inbound to answer" };

    const messages = [{ role: "system", content: systemPrompt(opts.lead, opts.fileLink, opts.firstAiReply, opts.calendlyUrl, opts.appLink, opts.missingDocs, opts.knownFacts, opts.expertise) }, ...history];
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: 320, messages }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, detail: j?.error?.message || `OpenAI ${res.status}` };
    let reply = String(j.choices?.[0]?.message?.content || "").trim();
    if (!reply) return { ok: false, detail: "empty reply" };
    // Deterministic compliance gate (never trust a temp>0 model with rate/approval/
    // licensing rules): swap in a safe deferral if needed + force first-reply disclosure.
    const gate = complianceGate(reply, { firstAiReply: !!opts.firstAiReply, state: opts.lead?.state, fileLink: opts.fileLink, appLink: opts.appLink, calendlyUrl: opts.calendlyUrl });
    reply = gate.reply;
    // SMS hygiene: cap length (~2 segments) and ensure a compliant opt-out cue.
    reply = reply.replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, "$2"); // SMS: bare URLs, never markdown
    if (reply.length > 750) reply = reply.slice(0, 740).replace(/\s+\S*$/, "") + "…";
    if (!/\bstop\b/i.test(reply)) reply = `${reply} (Reply STOP to opt out.)`;
    return { ok: true, reply, flagged: gate.flagged, detail: gate.flagged ? "compliance-deferred" : "ok" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}


// ---------------------------------------------------------------------------
// CONVERSATION MEMORY: after an exchange, extract durable facts the borrower
// revealed (city/property, who's buying, timeline, obstacles, preferences) and
// merge into the persisted list — so Mark never re-asks across days.
// ---------------------------------------------------------------------------
export async function extractConversationFacts(history: ChatTurn[], prior: string[]): Promise<string[]> {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key || !history.length) return prior;
    const convo = history.slice(-8).map((m) => `${m.role === "user" ? "THEM" : "MARK"}: ${m.content.slice(0, 300)}`).join("\n");
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", temperature: 0, max_tokens: 250, response_format: { type: "json_object" }, messages: [
        { role: "system", content: 'Extract durable FACTS about the borrower from this SMS conversation — location/property, who is actually buying, timeline, income situation, obstacles/concerns, stated preferences. Short phrases, no speculation, no PII beyond what they said. Merge with the PRIOR list (dedupe, keep newest phrasing). Return JSON {"facts": string[]} with AT MOST 12 items.' },
        { role: "user", content: `PRIOR: ${JSON.stringify(prior)}\nCONVERSATION:\n${convo}` }] }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    const f = JSON.parse(j.choices?.[0]?.message?.content || "{}").facts;
    return Array.isArray(f) ? f.map((x: any) => String(x).slice(0, 120)).slice(0, 12) : prior;
  } catch { return prior; }
}

// HANDOFF SIGNALS: inbound messages that should page the owner IMMEDIATELY (the
// AI still replies; the human gets looped in in parallel).
export function handoffSignal(inbound: string): string | null {
  const t = String(inbound || "").toLowerCase();
  if (/\b(real person|human|actual person|someone real|talk to (a |the )?(person|agent|someone)|call me)\b/.test(t)) return "asked for a human";
  if (/\b(under contract|in escrow|accepted offer|close (by|in)|closing date|deadline|locked?|lock (my|the) rate|another (lender|quote)|better (rate|offer|quote)|competing)\b/.test(t)) return "live deal / time-sensitive";
  if (/\b(lawyer|attorney|sue|complaint|report you|scam|fraud|bbb|cfpb|discriminat)\b/.test(t)) return "complaint or legal language";
  if (/\b(bankruptcy|foreclosure|itin|foreign national|1099 only|no ssn)\b/.test(t)) return "complex scenario";
  return null;
}