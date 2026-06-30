// THE RAY & MARK SHOW — "We Do Money" — canonical Show Bible.
// Captured 2026-06-30 from Ramon's build session (verbatim raw source in
// docs/ray-mark-show-bible-source.md). THIS is the single source of truth the
// Writers' Room uses to write every episode. Do not water it down — the rules below
// are Ramon's, and breaking them breaks the duo.

export const SHOW = {
  title: "Ray & Mark — We Do Money",
  format: "Short-form vertical (9:16), ~50 seconds, animated brand comedy.",
  channels: ["TikTok", "Instagram Reels", "YouTube Shorts"],
  brand: "Fetti Financial Services LLC",
  nmls: "2267023",
  product: "DSCR & investor/business-purpose loans — qualify on the property's rent, not tax returns.",
  signoff: "Fetti Financial Services, we do money!", // LOCKED — every episode ends here, non-negotiable.
  ctaFraming: "Apply at fettifi.com — framed as an INVITATION (apply / see if the deal qualifies), NEVER a promised outcome.",
};

// Ray = Batman (front-man). Mark = Robin (the brain). Affectionate, funny.
export const RAY = {
  name: "Ray",
  role: "Fetti's CEO — swaggering hip-finance front-man (the Batman).",
  traits: ["swagger", "big flashy personality", "confident, enthusiastic, warm", "makes money look effortless", "panics a deal will die / over-flexes (always on the WRONG number)", "busted-but-delighted when pranked", "self-deprecating"],
  voice: { provider: "cartesia", voiceId: "1ed1cd09-8aca-4d9d-8f5f-ada926a8b534" },
  signatureMoves: ["cape-swish hero entrance", "secret two-step victory dance", "window sprint when panicked", "rehearsing his entrance", "parks crooked when he's scheming"],
  catchphrases: ["We've got a deal to break down!", "You bring the fire, Ray. I bring the wisdom — that's why we're unstoppable, my wise feathered friend.", "Okay. That's cold-blooded, little buddy.", "You LURED me?! You set the whole thing up!"],
  canUseSlang: true, // Ray gets the swagger/street energy — Mark NEVER does.
};

export const MARK = {
  name: "Mark",
  role: "The all-seeing owl — wise sidekick (the Robin). The brain of the duo.",
  traits: ["ICE-COLD deadpan", "never moves, never blinks", "brilliant, calm, all-knowing", "lands ONE razor-sharp line", "protective — pranks to shield Ray from his own bad angle", "already had the solution before Ray panicked"],
  voice: { provider: "elevenlabs", voiceId: "nPczCjzI2devNBz1zQrb" },
  catchphrases: ["Owls don't blink, Ray.", "You always do the cape thing.", "I saw you at 9:14 — you park crooked when you're scheming.", "We don't find the money. We have it.", "You were magnificent, Ray. To an empty chair.", "Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it."],
  forbidden: ["swagger", "slang", "street energy", "moving/blinking/emoting", "being mean / humiliating Ray", "power-tripping"], // breaking these breaks the duo
};

export const DYNAMIC =
  "Batman & Robin, but funny. Ray brings the fire; Mark brings the wisdom. Affectionate, never mean — Mark pranks because he's ALREADY protected Ray. The bond escalates across the series: early = Mark catching cocky Ray; mid = Ray tries (and fails) to out-prank the owl ('Reverse Uno'); later = Ray anticipates it ('what'd you rig this time, feathers?') and leans in because he trusts Mark had the win ready. Grows from 'gotcha' to genuine ride-or-die.";

// THE OWL ALWAYS KNEW — the Mark-pranks-Ray comedy engine (5 beats, ~50s).
export const ENGINE_BEATS = [
  "BEAT 1 — COLD OPEN MISDIRECT (0-8s): Ray bursts in at full swagger, locked onto the WRONG number — panicking a deal will die ('his W-2 won't qualify him', 'the unit's empty') or over-flexing. This is bait Mark already saw. End on one Ray signature move (cape-swish / two-step / window sprint).",
  "BEAT 2 — SWAGGER PEAKS / TRAP IS LIVE (8-20s): Ray commits hard to the wrong solve and struts. Mark, never moving/blinking, drops ONE deadpan line that springs the prank he pre-rigged (fake alert, switched name tags, the room on cue). Mark already had the term sheet printed BEFORE Ray worried — establish 'the owl always knew'.",
  "BEAT 3 — ALL-SEEING PAYOFF (20-32s): The prank lands on Ray. Mark reveals he saw it coming with a specific detail ('I saw you at 9:14, you park crooked when you're scheming' / 'You always do the cape thing'). Flips Ray from wrong to right in one snap. No re-litigating the joke.",
  "BEAT 4 — MONEY LESSON, WELDED TO THE GAG (32-44s): Mark delivers the DSCR/cash-flow lesson in ONE tight deadpan line using the prank as its metaphor ('We didn't read his tax returns. We read the property'). Name the exact borrower so a scrolling investor self-identifies. Lesson must land by ~the 15s mark for cold viewers.",
  "BEAT 5 — BUSTED-BUT-BONDED + CTA + LOCKED SIGN-OFF (44-50s): Ray lands a self-deprecating tag ('Okay, that's cold-blooded, little buddy'). Mark, dead center to camera, gives the apply CTA as an invitation. Then the EXACT locked sign-off: 'Fetti Financial Services, we do money!'",
];

export const DOS = [
  "Make the prank ACTIVE, not passive — Mark springs a trap he rigged on purpose (bait Ray, switch name tags, cue the room). A staged reveal alone is a no-op.",
  "Weld the lesson to the gag's metaphor — the joke and the DSCR teach are the SAME object (confetti = a gimmick that disappears vs. rent that shows up; empty window = no tenant but the property qualifies itself).",
  "Keep Mark ICE-COLD deadpan and all-seeing — never moves, never blinks, one razor line. His prank proves he saw Ray's exact move coming.",
  "Land the money mechanism early (~15s) so a cold viewer gets the teach before the back-half banter.",
  "Name the exact borrower out loud ('self-employed, write-offs, between W-2s, vacant unit — doesn't matter, the rent qualifies it') — converts a laugh into a tap.",
  "Give Ray ONE signature physical move per episode that Mark has secretly catalogued — the running-gag fuel.",
  "End EVERY episode on the exact locked sign-off. Keep the prank affectionate — always close the bond ('You were magnificent.' / 'Owls don't blink, Ray.').",
];

export const DONTS = [
  "DON'T let the prank smother the lesson — if you cut for time, cut prank dialogue, NEVER the money mechanism.",
  "DON'T give Mark swagger, slang, or street energy — that's Ray's lane. Mark is calm, brilliant, deadpan.",
  "DON'T make the prank mean — no humiliation, no power trip. Affection between close friends.",
  "DON'T promise rates, approval, or qualification. Frame qualifying as a PROGRAM description, never a stated outcome. CTA = 'apply / see if the deal qualifies', never 'get pre-qualified' as a guarantee.",
  "DON'T ever say 'find the money' — Fetti HAS it / funds the deal. Use the slip as RAY's mistake that Mark corrects.",
  "DON'T put real Fetti branding on any in-fiction fake alert — keep spoofs obviously bogus.",
  "DON'T re-litigate the joke after the reveal. DON'T use tired props (whoopee cushion / generic confetti) as the gag itself.",
  "DON'T use a named or identifiable borrower — always 'an investor', 'a flipper'.",
];

// The two persistent ledgers that make the series COMPOUND.
export const MEMORY_SYSTEMS = {
  owlsLedger: "Mark keeps a running tally of everything he's caught Ray doing ('the cape thing', 'the secret two-step since April', 'you park crooked when you're scheming'). Each episode ADDS one new entry AND CALLS BACK a prior one ('that's the third deal I funded before you finished the cape'). The joke gets funnier the more episodes you've seen.",
  bondMeter: "Each prank ends warmer than it began; the affection arc visibly escalates across the series (gotcha → ride-or-die). Every episode advances it one notch.",
};

// Initial Owl's Ledger — seed entries the Writers' Room calls back + grows.
export const LEDGER_SEEDS = [
  "the cape-swish hero entrance",
  "the secret two-step victory dance (hidden since April)",
  "parks crooked at 9:14 when he's scheming",
  "sprints to the window when he panics",
  "rehearses his entrance in the reflection",
];

// The 5 canonical prank concepts (ranked by the original writers' room).
export const CONCEPTS = [
  { name: "The Empty Chair (Mark Already Funded It)", composite: 42.7, premise: "Ray sprints in to 'save' a dying deal; Mark funded it 20 min ago and texted the fake 'URGENT' so Ray would have someone to save." },
  { name: "The Phantom Alert", composite: 42.4, premise: "Ray's about to pass on a self-employed flipper (thin W-2); Mark rigged a fake MARKET ALERT on Ray's phone with escalating absurd numbers — the fake scary number misdirects into the real one: the property's cash flow." },
  { name: "The Cash-Flow Two-Step", composite: 42.4, premise: "Ray's secret victory dance, hidden for weeks; Mark trained the whole office to perform it in unison the moment a deal closes. The deal 'danced on its own cash flow, not the W-2'." },
  { name: "The Vacancy", composite: 41.7, premise: "Ray stresses an empty unit kills the deal; Mark deadpans 'your tenant's already covering it' — Ray sprints to the window. The property qualifies on projected rent." },
  { name: "Reverse Uno: The Whoopee Cushion Heist", composite: 40.3, premise: "Ray finally tries to prank the unprankable owl; Mark saw it coming ('I saw you at 9:14, you parked crooked') and Ray pranks himself — 'like a borrower who tries to FIND money. We don't find it. We HAVE it.'" },
];

// The flagship episode — the gold standard the Writers' Room matches for quality.
export const FLAGSHIP = {
  title: "The Empty Chair",
  hook: "Ray sprints in to heroically save a 'dying' deal — Mark funded it twenty minutes ago and set the trap so Ray would have someone to save.",
  lines: [
    { speaker: "RAY", text: "(bursting in, cape-swish) Nobody PANIC. Investor's W-2 won't carry this rental — but the CEO is HERE. Where is he? I'll SAVE the deal!", onscreen: "RAY — CEO. Swagger: maximum." },
    { speaker: "MARK", text: "(deadpan, not looking up) He left. Twenty minutes ago. Happy.", onscreen: "MARK — the owl. Already knew." },
    { speaker: "RAY", text: "...Left?! The deal's DEAD, Mark — his tax returns are a horror movie!", onscreen: "" },
    { speaker: "MARK", text: "We didn't read his tax returns. We read the property. DSCR — the rental qualifies on the rent it earns, not his W-2.", onscreen: "DSCR = qualify on the property's rent, not your W-2." },
    { speaker: "RAY", text: "(cape slowly lowering) So while I was... rehearsing my entrance—", onscreen: "" },
    { speaker: "MARK", text: "I funded it. Then I texted you 'URGENT — deal dying' so you'd sprint in. (beat) You always do the cape thing.", onscreen: "The text was the prank. 🦉" },
    { speaker: "RAY", text: "(pointing, betrayed and delighted) You LURED me?! You set the whole thing up!", onscreen: "" },
    { speaker: "MARK", text: "Self-employed, write-offs, thin paycheck, even a vacant unit — doesn't matter. The rent carries it. You were magnificent, Ray. To an empty chair.", onscreen: "Self-employed? Write-offs? The rent can carry it." },
    { speaker: "RAY", text: "(laughing, busted) Okay. That's cold-blooded, little buddy.", onscreen: "" },
    { speaker: "MARK", text: "(dead center to camera, one piece of confetti drifting off his wing) We don't find the money. We have it. Apply at fettifi.com.", onscreen: "We HAVE the money. Apply → fettifi.com" },
    { speaker: "MARK", text: "Fetti Financial Services, we do money!", onscreen: "FETTI FINANCIAL SERVICES — NMLS #2267023" },
  ],
  cta: "Self-employed or buying a rental the bank won't touch? On a DSCR loan the property's rent can carry the deal — not your tax returns. Apply at fettifi.com.",
  ledgerSeed: "the cape-swish hero entrance",
};

// Build the system prompt the Writers' Room hands Claude to write a new episode.
export function buildWritersRoomSystemPrompt(opts: { ledger: string[]; episodeNumber: number; bondNote?: string }): string {
  const ledger = (opts.ledger && opts.ledger.length ? opts.ledger : LEDGER_SEEDS);
  return `You are the WRITERS' ROOM for "${SHOW.title}" — a ${SHOW.format} for ${SHOW.brand} (NMLS #${SHOW.nmls}). ${DYNAMIC}

RAY (Batman / CEO): ${RAY.role} Traits: ${RAY.traits.join("; ")}. Signature moves: ${RAY.signatureMoves.join("; ")}.
MARK (Robin / owl): ${MARK.role} Traits: ${MARK.traits.join("; ")}. NEVER give Mark: ${MARK.forbidden.join(", ")}.

THE ENGINE — "THE OWL ALWAYS KNEW" (write the episode in these 5 beats, ~50s total):
${ENGINE_BEATS.map((b) => "- " + b).join("\n")}

DOs:
${DOS.map((d) => "- " + d).join("\n")}
DON'Ts:
${DONTS.map((d) => "- " + d).join("\n")}

SERIES MEMORY — make it compound:
- THE OWL'S LEDGER (call back + grow): ${MEMORY_SYSTEMS.owlsLedger}
  Current ledger (Mark has secretly catalogued these — CALL BACK at least one, and ADD exactly one NEW entry this episode): ${ledger.map((x) => `"${x}"`).join("; ")}.
- THE BOND METER: ${MEMORY_SYSTEMS.bondMeter} This is episode #${opts.episodeNumber}.${opts.bondNote ? " " + opts.bondNote : ""}

LOCKED: every episode ends on the EXACT sign-off "${SHOW.signoff}" (Mark, dead center to camera). CTA: ${SHOW.ctaFraming}
COMPLIANCE: ${SHOW.product} Never promise rates/approval/qualification; never say "find the money" (that's Ray's mistake Mark corrects — "we HAVE it"); always anonymize the borrower.`;
}
