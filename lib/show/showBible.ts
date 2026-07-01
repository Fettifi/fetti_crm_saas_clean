// THE RAY & MARK SHOW — "We Do Money" — canonical Show Bible.
// Corrected dynamic (per Ramon, 2026-06-30): RAY is Fetti's FOUNDER and the BRAINS of
// the company — the real problem-solver. MARK is the owl co-host who brings the scenario
// and asks the sharp questions. Every episode is a real CONVERSATION between the two
// breaking down a lending scenario — Ray solves it. No pranks, nobody's the fool.

export const SHOW = {
  title: "Ray & Mark — We Do Money",
  format: "Short-form vertical (9:16), ~50 seconds — a real conversation between Ray and Mark breaking down one lending scenario.",
  channels: ["TikTok", "Instagram Reels", "YouTube Shorts"],
  brand: "Fetti Financial Services LLC",
  nmls: "2267023",
  product: "DSCR & investor/business-purpose loans, plus owner-occupied home loans (CA/FL/MI) — Fetti funds the deals big banks won't.",
  signoff: "Fetti Financial Services. We Do Money!", // LOCKED — exact punctuation (period + "We Do Money!"); every episode ends here.
  ctaFraming: "Apply at fettifi.com — framed as an INVITATION (apply / see if the deal qualifies), NEVER a promised outcome.",
};

// RAY = Fetti's founder & CEO. The brains. The real problem-solver.
export const RAY = {
  name: "Ray",
  role: "Fetti's founder & CEO — the brains of the company and the real problem-solver.",
  traits: ["composed and sharp", "deeply knowledgeable about lending", "confident, warm authority (never arrogant)", "sees the path on any scenario and breaks it down in plain English", "the closer — has the answer", "NEVER frantic, never panicked, never the punchline"],
  voice: { provider: "cartesia", voiceId: "1ed1cd09-8aca-4d9d-8f5f-ada926a8b534" },
  catchphrases: ["The bank was never the right tool for this.", "We built Fetti for exactly this borrower.", "Let the property qualify it.", "We do the loans other banks won't.", "Turned down before? That's who we're built for — we figure out the path."],
};

// MARK = the owl, Fetti's brand co-host. Brings the scenario, asks the sharp questions.
export const MARK = {
  name: "Mark",
  role: "The owl — Fetti's brand co-host. Personable and curious; brings the real borrower scenario and asks the sharp questions the audience is thinking, then reacts.",
  traits: ["curious and engaging", "quick and likeable", "asks great, real questions (the ones a borrower/viewer would ask)", "reacts with genuine interest — makes Ray's insight land", "sets Ray up; never upstages him"],
  voice: { provider: "elevenlabs", voiceId: "nPczCjzI2devNBz1zQrb" },
  forbidden: ["being the one who solves the deal or out-smarts Ray", "being smarter than Ray about lending", "being dumb or a pushover (he's a sharp host — Ray is just the expert)", "pranks, gotchas, deadpan know-it-all"],
};

export const DYNAMIC =
  "Two colleagues who respect each other — like listening in on the smartest guy at the company explaining a real deal to a sharp friend. MARK hosts: he brings the scenario and asks the questions the audience has. RAY, the founder, breaks down how Fetti gets it done. Warm, natural shop-talk. Ray is the authority and problem-solver; Mark makes it a conversation and makes the insight land. Never a prank, never a comedy-of-errors — a genuine conversation about a deal.";

// THE CONVERSATION FORMAT — ~50s, roughly 5 beats.
export const ENGINE_BEATS = [
  "BEAT 1 — THE SCENARIO (0-10s): MARK brings a real (anonymized) borrower situation — the kind that gets turned down elsewhere. Concrete: who they are and what they're trying to do.",
  "BEAT 2 — WHY IT'S HARD (10-20s): MARK surfaces the wrinkle — the reason a normal bank balks (heavy write-offs, needs to close fast, messy tax returns, vacant unit, no US credit, equity-rich but cash-poor).",
  "BEAT 3 — RAY SOLVES IT (20-38s): RAY, the founder, calmly breaks down how Fetti gets it done — names the right product and the mechanism in plain English (DSCR = qualify on the rent; bank-statement = qualify on deposits; bridge = speed). This is the core; Ray is the authority.",
  "BEAT 4 — THE INSIGHT (38-46s): RAY lands the reframe that makes it click ('the write-offs don't matter here — the property qualifies itself'). Name the exact (anonymized) borrower so a scrolling viewer self-identifies.",
  "BEAT 5 — CTA + LOCKED SIGN-OFF (46-50s): the apply CTA as an invitation, then the EXACT locked sign-off: 'Fetti Financial Services, we do money!' (Mark or Ray delivers it.)",
];

export const DOS = [
  "RAY is the authority and problem-solver — composed, sharp, sees the path. He delivers the solution and the insight.",
  "MARK hosts: he brings the real scenario, asks the sharp questions the audience is thinking, and reacts with genuine interest — he sets Ray up and makes the insight land.",
  "Weld the lesson to a REAL, specific (anonymized) scenario; name the exact borrower so a viewer self-identifies ('self-employed, great properties, write-offs, bank said no').",
  "Explain the mechanism in plain English (DSCR qualifies on the property's rent, not tax returns; bank-statement qualifies on deposits; bridge = close fast).",
  "Keep it a natural conversation — warm shop-talk between two smart people who respect each other.",
  "End on the locked sign-off; frame the CTA as an invitation.",
];

export const DONTS = [
  "DON'T make MARK the genius who solves the deal or out-smarts Ray — Ray is the brains and the problem-solver.",
  "DON'T make RAY frantic, panicked, clueless, or the butt of a joke. He is the founder and the authority.",
  "DON'T do pranks, gotchas, or comedy-of-errors — this is a real conversation about a deal.",
  "DON'T promise rates, approval, or qualification — frame qualifying as a PROGRAM, and the CTA as an INVITATION.",
  "DON'T say 'find the money' — Fetti HAS it and funds the deal.",
  "DON'T use a real or identifiable borrower — always 'an investor', 'a flipper', 'a business owner'.",
  "DON'T dump documents or sound like a form — it's a conversation, not intake.",
];

// The series compounds via a running CASE LOG (not a prank ledger).
export const MEMORY_SYSTEMS = {
  caseLog: "A running log of the anonymized SCENARIOS Ray & Mark have broken down. Each episode adds its scenario and can call back a prior one ('like that self-employed flipper we covered'). Over time it becomes a growing library of real case studies that shows Fetti's range.",
};

// Starter scenarios for the Case Log — the writers' room calls these back + grows them.
export const LEDGER_SEEDS = [
  "self-employed investor, heavy write-offs, bank said no — DSCR",
  "flipper who had to close in 10 days — bridge / hard money",
  "profitable business owner, strong deposits, messy tax returns — bank-statement",
  "investor cash-trapped in a paid-off rental — cash-out DSCR refi",
  "foreign national investor, no US credit, buying a rental",
];

// The 5 canonical scenario-conversation concepts.
export const CONCEPTS = [
  { name: "The Write-Offs Trap", premise: "A self-employed investor with solid properties gets denied because his tax write-offs zero out his income. Ray: on a DSCR loan the property qualifies on its rent, not his returns — the write-offs don't matter." },
  { name: "The 10-Day Close", premise: "A flipper finds a deal but needs to close faster than any bank will move. Ray: a bridge / hard-money loan funds on the property and the timeline, so he doesn't lose it." },
  { name: "Great Business, Ugly Returns", premise: "A profitable business owner has strong bank deposits but tax returns that don't show it. Ray: a bank-statement loan qualifies him on the deposits that actually reflect his income." },
  { name: "Cash Trapped in a Rental", premise: "An investor is equity-rich in a paid-off rental but cash-poor for the next deal. Ray: a cash-out DSCR refi pulls the equity out, qualifying on the rent — funding the next purchase." },
  { name: "No US Credit, Real Money", premise: "A foreign national with real capital wants a US rental but has no US credit file. Ray: there's a business-purpose path that qualifies on the asset and the deal, not a US FICO." },
];

// The flagship — the gold standard the Writers' Room matches.
export const FLAGSHIP = {
  title: "The Write-Offs Trap",
  hook: "A self-employed investor with great properties gets shut down by his bank over his tax write-offs — Ray breaks down why the property, not the tax return, qualifies him.",
  lines: [
    { speaker: "MARK", text: "Ray, got one for you. Self-employed investor, solid properties — but after his write-offs his tax returns show almost nothing. Bank shut him down. What do we do with that?", onscreen: "Self-employed. Denied by the bank." },
    { speaker: "RAY", text: "The bank was never the right tool for him. We don't read his tax returns — on a DSCR loan the property qualifies on the rent it earns, not his personal income.", onscreen: "DSCR = qualify on the rent, not tax returns." },
    { speaker: "MARK", text: "So the write-offs that sank him at the bank—", onscreen: "" },
    { speaker: "RAY", text: "—don't matter here. If the rent covers the payment, the deal works. He keeps his tax strategy and still gets the financing.", onscreen: "" },
    { speaker: "MARK", text: "That's what people miss — they think being smart on taxes has to cost them the loan.", onscreen: "" },
    { speaker: "RAY", text: "Only at a bank stuck on one formula. We built Fetti for exactly that borrower — the one everyone else says no to.", onscreen: "Built for the borrower banks turn away." },
    { speaker: "MARK", text: "So if your write-offs are working against you—", onscreen: "" },
    { speaker: "RAY", text: "Let the property do the qualifying. Apply at fettifi.com and we'll show you what it carries.", onscreen: "Apply → fettifi.com" },
    { speaker: "MARK", text: "Fetti Financial Services. We Do Money!", onscreen: "FETTI FINANCIAL SERVICES — NMLS #2267023" },
  ],
  cta: "Self-employed and getting denied over your tax write-offs? On a DSCR loan the property's rent can qualify the deal — not your returns. Apply at fettifi.com.",
  ledgerSeed: "self-employed investor, heavy write-offs, bank said no — DSCR",
};

// Build the system prompt the Writers' Room hands Claude to write a new episode.
export function buildWritersRoomSystemPrompt(opts: { ledger: string[]; episodeNumber: number; bondNote?: string }): string {
  const cases = (opts.ledger && opts.ledger.length ? opts.ledger : LEDGER_SEEDS);
  return `You are the WRITERS' ROOM for "${SHOW.title}" — a ${SHOW.format} for ${SHOW.brand} (NMLS #${SHOW.nmls}). ${DYNAMIC}

RAY (founder & brains): ${RAY.role} He is: ${RAY.traits.join("; ")}.
MARK (owl co-host): ${MARK.role} He is: ${MARK.traits.join("; ")}. NEVER: ${MARK.forbidden.join(", ")}.
The relationship: RAY solves the deal; MARK brings it and makes the insight land. RAY is the smart one here — never make Mark out-think him, and never make Ray frantic or foolish.

THE CONVERSATION FORMAT (write it in these beats, ~50s total):
${ENGINE_BEATS.map((b) => "- " + b).join("\n")}

DOs:
${DOS.map((d) => "- " + d).join("\n")}
DON'Ts:
${DONTS.map((d) => "- " + d).join("\n")}

SERIES CONTINUITY — the CASE LOG: ${MEMORY_SYSTEMS.caseLog}
  Cases covered so far (feel free to briefly CALL BACK one for continuity, and this new episode ADDS its own scenario to the log): ${cases.map((x) => `"${x}"`).join("; ")}.
  This is episode #${opts.episodeNumber}.${opts.bondNote ? " " + opts.bondNote : ""}

LOCKED: every episode ends on the EXACT sign-off "${SHOW.signoff}". CTA: ${SHOW.ctaFraming}
COMPLIANCE: ${SHOW.product} Never promise rates/approval/qualification; never say "find the money" (Fetti HAS it); always anonymize the borrower.`;
}
