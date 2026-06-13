// Ad Factory — auto-generates fresh Meta ad concepts in Mark's voice (hooks +
// voiceover script + copy + image direction). The creative ideation runs on a
// daily cron and on-demand; the final image/video render happens one-click in
// the Creative Studio (canvas render is browser-only, where fonts work).
import { MARK_PERSONA, MARK_SIGNOFF } from "@/lib/markPersona";

export type AdConcept = {
  product: string; headline: string; sub: string; cta: string;
  hooks: string[]; line: string; prompt: string;
};

export async function generateAdConcepts(n = 6): Promise<AdConcept[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const sys = `${MARK_PERSONA}

You write short-form Meta ad concepts for Fetti's mortgage products: DSCR purchase, DSCR cash-out, fix & flip, refinance, cash-out refi, bank-statement (self-employed), first-time buyer. Fetti is a DIRECT LENDER (we HAVE the money) and also a broker.

Return STRICT JSON: {"concepts":[ ... ]}. Each concept object:
- product: short label (e.g. "DSCR Purchase")
- headline: <= 5 words (Mark's speech-bubble line)
- sub: <= 12 words (shown on the image)
- cta: <= 4 words (button, e.g. "Apply in 2 min")
- hooks: array of EXACTLY 3 scroll-stopping openers, <= 6 words each (first-frame text)
- line: Mark's first-person voiceover, 10-15 seconds spoken, in his street-smart-but-polished mentor voice; MUST end with "${MARK_SIGNOFF}"
- prompt: a real-estate/finance photo description for the AI background (photorealistic, bright; NO text, NO logos, NO words)

Rules: vary the products across the ${n} concepts; compliant (NO rate or approval promises, no guarantees); Mark says "we've got the money"/"we fund it", NEVER "find your money".`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.9,
        messages: [{ role: "system", content: sys }, { role: "user", content: `Generate ${n} fresh, varied ad concepts as JSON now.` }],
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
      line: /Fetti\.?\s*We do money/i.test(String(c.line || "")) ? String(c.line) : `${String(c.line || "").trim()} ${MARK_SIGNOFF}`,
      prompt: String(c.prompt || "attractive American home exterior, bright daylight").slice(0, 240),
    })).filter((c) => c.headline && c.line && c.hooks.length === 3);
  } catch {
    return [];
  }
}
