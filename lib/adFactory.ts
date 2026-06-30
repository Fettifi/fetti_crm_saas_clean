// Ad Factory — auto-generates fresh INFORMATIONAL short-video concepts in Mark's
// voice (hook + teach-one-thing voiceover + on-screen copy + image direction).
// The creative ideation runs on a daily cron and on-demand; the final
// image/video render happens one-click in the Creative Studio (with Mark's
// voiceover via TTS). NMLS #2267023 disclosure is baked into every render.
import { MARK_PERSONA, MARK_INFORMATIONAL, MARK_COMPANY_SIGNOFF } from "@/lib/markPersona";

export type AdConcept = {
  product: string; headline: string; sub: string; cta: string;
  hooks: string[]; line: string; prompt: string;
};

// A storyboard for a multi-scene ANIMATED cartoon short: each beat is its own
// illustrated cartoon scene with Mark's spoken line, an on-screen caption, an
// optional punchy "bigText" to animate, and a cartoon-scene image prompt.
export type StoryBeat = { kind: "hook" | "teach" | "cta"; vo: string; caption: string; bigText?: string; bgPrompt: string };
export type Storyboard = { title: string; product: string; beats: StoryBeat[] };

export async function generateStoryboard(topic = "", nBeats = 5): Promise<Storyboard | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const n = Math.min(Math.max(nBeats, 3), 7);
  const sys = `${MARK_PERSONA}

${MARK_INFORMATIONAL}

You are storyboarding a SHORT, FUN, EDUCATIONAL animated cartoon (9:16 vertical, ~25-40 seconds) starring MARK the golden owl. It must be genuinely entertaining to watch AND teach one real mortgage concept so the viewer wants to apply. Think top-tier fintech "explainer short": a scroll-stopping hook, 2-3 quick teaching beats with a vivid cartoon scene each, then a direct call to apply.

Return STRICT JSON: {"title": "...", "product": "...", "beats": [ ... ]} with EXACTLY ${n} beats.
- beats[0].kind = "hook"; the last beat.kind = "cta"; the middle beats.kind = "teach".
Each beat object:
- kind: "hook" | "teach" | "cta"
- vo: Mark's first-person spoken line for THIS scene only (1-2 short sentences, ~3-7 seconds spoken). Conversational, energetic, accurate.
- caption: <= 6 words, the on-screen kinetic text for this scene (punchy).
- bigText: OPTIONAL short punchy number/phrase to animate big on screen (e.g. "0% income docs", "1.0 DSCR", "2 min"). Omit if not useful.
- bgPrompt: a CARTOON SCENE illustration description for THIS beat — vibrant flat-vector cartoon, bold clean outlines, bright colors, depicting the concept (e.g. "a cheerful cartoon rental house with green dollar arrows flowing in", "a cartoon bank vault opening", "a happy cartoon investor holding keys"). NO text, NO words, NO logos in the image.

Rules: the LAST beat's vo MUST end with "${MARK_COMPANY_SIGNOFF}" and its caption MUST be a direct apply CTA (e.g. "Apply in 2 minutes"). Teach accurately; compliant (NO rate or approval promises, no guarantees); Mark says "we've got the money"/"we fund it", NEVER "find your money". Topic focus: ${topic || "pick one high-interest mortgage topic (DSCR, bank-statement, fix & flip, cash-out refi, first-time buyer myths)"}.`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.85,
        messages: [{ role: "system", content: sys }, { role: "user", content: `Storyboard one ${n}-beat animated Mark short as JSON now${topic ? ` about: ${topic}` : ""}.` }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    let beats: StoryBeat[] = Array.isArray(parsed.beats) ? parsed.beats : [];
    beats = beats.slice(0, n).map((bt: any, i: number) => ({
      kind: (i === 0 ? "hook" : i === beats.length - 1 ? "cta" : "teach") as StoryBeat["kind"],
      vo: String(bt.vo || "").slice(0, 320),
      caption: String(bt.caption || "").slice(0, 60),
      bigText: bt.bigText ? String(bt.bigText).slice(0, 28) : undefined,
      bgPrompt: String(bt.bgPrompt || "vibrant flat-vector cartoon scene of a friendly neighborhood house, bright colors").slice(0, 240),
    })).filter((bt) => bt.vo && bt.caption);
    if (beats.length < 3) return null;
    // enforce the company sign-off on the final spoken line
    const last = beats[beats.length - 1];
    last.vo = `${last.vo.replace(/\s*Fetti[^.!?]*we do money[.!?]*\s*$/i, "").trim()} ${MARK_COMPANY_SIGNOFF}`.trim();
    return { title: String(parsed.title || topic || "Mark Short").slice(0, 80), product: String(parsed.product || topic || "Fetti Loan").slice(0, 48), beats };
  } catch {
    return null;
  }
}

export async function generateAdConcepts(n = 6): Promise<AdConcept[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const sys = `${MARK_PERSONA}

${MARK_INFORMATIONAL}

You write short-form INFORMATIONAL-THAT-CONVERTS video concepts for Fetti: teach how to USE a product for the viewer's goal so they APPLY on the spot. Topics: how DSCR loans work, qualifying on rental income, no-tax-return options, fix & flip basics, refinance & cash-out, bank-statement loans for the self-employed, first-time-buyer myths, closing in an LLC. Fetti is a DIRECT LENDER (we HAVE the money) and also a broker.

Return STRICT JSON: {"concepts":[ ... ]}. Each concept object:
- product: short topic label (e.g. "DSCR, explained")
- headline: <= 5 words — the teaching point (Mark's on-screen line)
- sub: <= 12 words — the one-line takeaway shown on screen
- cta: <= 4 words — a DIRECT apply action (e.g. "Apply in 2 min", "Get pre-qualified", "Start your file")
- hooks: array of EXACTLY 3 curiosity openers tied to a goal, <= 6 words each (first-frame text, e.g. "No tax returns?")
- line: Mark's first-person voiceover, ~15-30 seconds spoken — teach how the product works AND how THEY'd use it for their situation, then a DIRECT call to apply now ("Tap the link and get pre-qualified today — no credit pull to start."); MUST end with "${MARK_COMPANY_SIGNOFF}"
- prompt: a real-estate/finance photo description for the AI background (photorealistic, bright; NO text, NO logos, NO words)

Rules: vary the topics across the ${n} concepts; teach accurately so the how-to is real; drive an application now (not "let's talk later"); compliant (NO rate or approval promises, no guarantees); Mark says "we've got the money"/"we fund it", NEVER "find your money".`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.9,
        messages: [{ role: "system", content: sys }, { role: "user", content: `Generate ${n} fresh, varied informational short-video concepts as JSON now.` }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return [];
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    const list: AdConcept[] = Array.isArray(parsed.concepts) ? parsed.concepts : [];
    // sanitize + enforce the sign-off
    return list.slice(0, n).map((c) => ({
      product: String(c.product || "Fetti Loan").slice(0, 40),
      headline: String(c.headline || "").slice(0, 60),
      sub: String(c.sub || "").slice(0, 140),
      cta: String(c.cta || "Apply now").slice(0, 30),
      hooks: (Array.isArray(c.hooks) ? c.hooks : []).slice(0, 3).map((h) => String(h).slice(0, 60)),
      line: `${String(c.line || "").replace(/\s*Fetti[^.!?]*we do money[.!?]*\s*$/i, "").trim()} ${MARK_COMPANY_SIGNOFF}`.trim(),
      prompt: String(c.prompt || "attractive American home exterior, bright daylight").slice(0, 240),
    })).filter((c) => c.headline && c.line && c.hooks.length === 3);
  } catch {
    return [];
  }
}
