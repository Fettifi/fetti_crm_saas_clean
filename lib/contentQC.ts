// PRE-PUBLISH QC — the automated "final once-over" on every image before it posts.
// Two layers:
//   1. INTEGRITY (always, cheap, no API): the asset decodes, is a real image of the
//      expected size, and isn't blank/uniform. Catches corrupt/blank/wrong-size
//      renders even when the vision model can't run — so fail-open never ships a
//      structurally broken asset.
//   2. VISION (flagship model, when available): garbled / cut-off / tofu text, the
//      owl mascot sprouting HUMAN HANDS (he has wings), malformed anatomy, brand
//      misspellings, missing NMLS / Equal Housing, a quoted rate/payment/term.
// A failing render is HELD as needs_review instead of auto-posting. This is the net
// that should have caught the "Leverage: B[tofu] build wealth" font bug.
//
// FAIL-OPEN only past INTEGRITY: if the *vision* call can't run (no key, API hiccup),
// we don't freeze the pipeline — but the integrity layer has already run, so a broken
// asset is still caught. ran=false means "vision didn't run" (integrity still did).
import "server-only";
import sharp from "sharp";
import { cfg } from "@/lib/settings";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

export type QCResult = { pass: boolean; severity: "ok" | "warn" | "fail"; issues: string[]; notes: string; ran: boolean };
const ok = (notes: string): QCResult => ({ pass: true, severity: "ok", issues: [], notes, ran: false });
const fail = (issue: string, notes: string): QCResult => ({ pass: false, severity: "fail", issues: [issue], notes, ran: true });

// Structural integrity — no external call. Returns null when fine, else a reason.
async function integrity(raw: Buffer, minW = 300, minH = 300): Promise<string | null> {
  if (!raw || raw.length < 3000) return "image is empty or far too small";
  let meta: sharp.Metadata;
  try { meta = await sharp(raw).metadata(); } catch { return "image does not decode"; }
  if (!meta.format || !["jpeg", "jpg", "png", "webp"].includes(meta.format)) return `unexpected format ${meta.format}`;
  if (!meta.width || !meta.height || meta.width < minW || meta.height < minH) return `bad dimensions ${meta.width}x${meta.height}`;
  try {
    const st = await sharp(raw).stats();
    if (st.channels.slice(0, 3).every((c) => (c.stdev ?? 0) < 2)) return "image appears blank / uniform";
  } catch { /* stats optional */ }
  return null;
}

/** Cheap decode/size check with no vision call — for the publish-time belt. */
export async function integrityOk(url?: string, minW = 300, minH = 300): Promise<boolean> {
  try {
    if (!url) return false;
    const raw = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
    return (await integrity(raw, minW, minH)) === null;
  } catch { return false; }
}

function checklist(kind: string, expectText?: string): string {
  return `You are the FINAL pre-publish quality reviewer for Fetti Financial Services' social media (a licensed mortgage lender). Review this ${kind} image that is about to be posted PUBLICLY. Be strict and literal — your only job is to catch anything that would look broken, unprofessional, or non-compliant BEFORE it goes out.
${expectText ? `\nEXPECTED HEADLINE — the big headline text should read exactly: "${expectText}". Verify every single word is present, complete, correctly spelled, and legible, with NO missing letters, cut-off words, or replacement/tofu boxes.\n` : ""}
Report EVERY problem you can see:
1. TEXT: Any text cut off, overlapping, misspelled, or showing missing-glyph / tofu boxes (□ ▯ ◆ ♦ or garbage marks)? Is every word complete and legible?${expectText ? " Does the headline match the EXPECTED HEADLINE exactly?" : " (This card may legitimately have little or no text — only flag text that IS present and looks broken.)"}
2. MASCOT — Mark the owl: If a golden/yellow OWL character appears, does he have HUMAN HANDS, arms, or fingers? He is an owl and must have feathered WINGS ONLY — flag ANY human hand, arm, finger, or thumb on him. Also flag malformed anatomy (extra/missing limbs, distorted or melted face, wrong eyes).
3. BRAND: Wherever a brand name appears, is it spelled exactly "Fetti Financial Services" (never "Fetty", "Fetti Financial", etc.)? Is the Fetti emblem/logo present and undistorted?
4. COMPLIANCE: Does the image quote any SPECIFIC interest RATE, APR, monthly PAYMENT, or loan TERM/points (it must NOT)? If this card carries a disclosure footer, are "NMLS #2267023" and "Equal Housing Opportunity" present?
5. OVERALL: Does it look professional and on-brand, or broken / AI-glitched / "crazy"?

Respond with ONLY a JSON object:
{"pass": <boolean — true ONLY if there are no fail-level problems>, "severity": "ok" | "warn" | "fail", "issues": [<one short string per concrete problem>], "notes": "<one-line summary>"}
Set severity "fail" (pass=false) for ANY of: garbled/cut-off/tofu text, a headline that doesn't match the expected text, human hands/arms/fingers on the owl, malformed anatomy, a misspelled brand name, or a quoted specific rate/payment/term. Set "warn" (still pass=true) for minor cosmetic issues. Set "ok" if clean.`;
}

export async function reviewImage(opts: { url?: string; buffer?: Buffer; kind?: string; expectText?: string; minW?: number; minH?: number }): Promise<QCResult> {
  let raw: Buffer | null = opts.buffer || null;
  try {
    if (!raw && opts.url) raw = Buffer.from(await (await fetch(opts.url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
  } catch (e) { return fail("could not fetch composed image", "integrity: fetch " + (e instanceof Error ? e.message : "err")); }
  if (!raw) return fail("no image produced", "integrity: null asset");

  // Layer 1 — INTEGRITY (always runs, hard fail).
  const bad = await integrity(raw, opts.minW, opts.minH);
  if (bad) return fail(bad, "integrity: " + bad);

  // Layer 2 — VISION (fail-open past integrity).
  try {
    const key = ((await cfg("ANTHROPIC_API_KEY")) || "").trim();
    if (!key) return ok("integrity-ok; vision-skipped (no key)");
    const png = await sharp(raw).resize(820, 820, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 700,
        system: "You are a meticulous pre-publish QA reviewer. Respond with ONLY a valid JSON object.",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
          { type: "text", text: checklist(opts.kind || "social", opts.expectText) },
        ] }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await res.json();
    if (!res.ok) { console.warn("[contentQC] vision api:", j?.error?.type || res.status); return ok("integrity-ok; vision-skipped (api " + (j?.error?.type || res.status) + ")"); }
    const text = String((j?.content || []).map((c: { text?: string }) => c?.text || "").join("")).trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return ok("integrity-ok; vision-skipped (unparseable)");
    const c = JSON.parse(m[0]);
    const severity: QCResult["severity"] = c.severity === "fail" || c.severity === "warn" || c.severity === "ok"
      ? c.severity : (c.pass === false ? "fail" : "ok");
    return {
      pass: severity !== "fail",
      severity,
      issues: Array.isArray(c.issues) ? c.issues.map(String).slice(0, 12) : [],
      notes: String(c.notes || "").slice(0, 300),
      ran: true,
    };
  } catch (e) {
    console.warn("[contentQC] vision failed:", e instanceof Error ? e.message : e);
    return ok("integrity-ok; vision-skipped (" + (e instanceof Error ? e.message : "error") + ")");
  }
}
