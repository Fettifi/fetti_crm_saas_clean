// THE PUBLIC SITE MUST WEAR RAMON'S BRAND, NOT TAILWIND'S DEFAULTS.
//
// 2026-10-17. Ramon: "the website looks like AI designed it... like a cheap AI built website."
// He was right, and the root cause was measurable rather than a matter of taste:
//
//   · Tailwind's stock `emerald-###` appeared 90 times across the marketing pages.
//   · The real brand green #309C30 — sampled from his own emblem and already on every Fetti PDF,
//     the letterhead and the business card — appeared ZERO times.
//   · The hero's headline gradient ran emerald -> teal-500. TEAL IS NOT A FETTI COLOUR.
//   · tailwind.config.ts declared `fetti.green = #00ff99`, a neon mint that exists nowhere in the
//     brand, so even the token that claimed to be the brand was wrong.
//
// A site built from a framework's default accent looks like every other site built from that
// framework's default accent. That is the whole of the "AI built this" impression, and no amount
// of re-wording fixes it.
//
// WHAT THIS ASSERTS — the principle, not one layout:
//   1. The brand hexes in tailwind.config.ts match the emblem-sampled values exactly.
//   2. Public marketing pages do not dress themselves in stock emerald/teal brand colour.
//   3. The hero does not use the gradient-clipped-text device, which is the single most
//      recognisable template signature of the era.
//   4. The existing emblem is referenced, never a generated substitute.
//
// Deliberately NOT asserted: fonts, spacing, section order, or anything else that is taste. Taste
// is Ramon's ([[visual-design-is-ramons]]). This guards the brand's identity, not its art direction.
//
//   npm run verify:brand-palette
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nBRAND PALETTE — is the public site wearing Fetti's brand or Tailwind's?\n");

// ── 1. the tokens themselves, sampled from the emblem
//
// STRIP COMMENTS FIRST — and this caught my own bug on the first run. tailwind.config.ts now
// DOCUMENTS the wrong values it replaced ("fetti.green = #00ff99 (neon mint…)") so the next reader
// knows why they are gone. Grepping the raw file then reported the impostor as still present and
// failed a config that was in fact correct. A guard that fires on its own documentation teaches
// people to delete the documentation.
const cfgRaw = readFileSync("tailwind.config.ts", "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const cfg = strip(cfgRaw);
const EMBLEM = { green: "#309C30", deep: "#23842B", gold: "#FCC054", wash: "#EFF7EF" };
for (const [name, hex] of Object.entries(EMBLEM)) {
  ck(`tailwind declares the emblem-sampled ${name} ${hex}`, new RegExp(hex, "i").test(cfg));
}
ck("the neon-mint impostor #00ff99 is not a live value", !/#00ff99/i.test(cfg));
ck("the wrong gold #ffcc33 is not a live value", !/#ffcc33/i.test(cfg));
ck("…and the config still EXPLAINS what it replaced, so nobody reintroduces it",
   /#00ff99/i.test(cfgRaw) && /emblem/i.test(cfgRaw));

// ── 2. the public pages — AND EVERYTHING THEY RENDER.
//
// THIS GUARD GAVE A FALSE GREEN ON ITS FIRST DAY, and the lesson is the familiar one: I guarded
// three hand-listed FILES instead of the thing a visitor actually sees. app/home/page.tsx measured
// 0 emerald, 0 slate, 0 pills — genuinely clean — while four components it renders did not:
//   HeroCapture 11 emerald / 9 slate / 4 pills · SocialProofWall 2 / 11 / 1
//   CediBubble   4 /  1 / 1              · CediVoice       3 / 0 / 1
// Worse, SocialProofWall lines 51 and 83 still rendered
//   font-mono text-xs uppercase tracking-widest text-emerald-600
// — the EXACT eyebrow this redesign exists to delete — on the homepage, while the guard reported
// the homepage clean. A near-monochrome ruled document with 2021-SaaS pill widgets dropped into it
// reads WORSE than the original, because the inconsistency is legible.
//
// So the roster is now DERIVED: start at the public entry points and follow local imports one hop,
// which is where rendered components live. A file added to the page is covered automatically.
const ENTRY_POINTS = [
  "app/home/page.tsx",
  "components/SiteHeader.tsx",
  "components/SiteFooter.tsx",
];

function localImportsOf(file: string): string[] {
  let src: string;
  try { src = readFileSync(file, "utf8"); } catch { return []; }
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
    const base = m[1];
    for (const ext of [".tsx", ".ts"]) {
      for (const cand of [`${base}${ext}`, `${base}/index${ext}`]) {
        try { if (statSync(cand).isFile()) { out.push(cand); } } catch { /* not this one */ }
      }
    }
  }
  return out;
}

// TWO hops, not one — and the second hop is the whole lesson of 2026-10-17.
//
// The roster was widened from three hand-listed files to "entry points plus what they render",
// which caught HeroCapture, SocialProofWall, CediBubble and CediVoice. It still reported GREEN over
// `components/TrustBadgeRow.tsx`, which renders UNCONDITIONALLY on the homepage in four
// `rounded-full` pills wearing eleven stock `emerald-*`/`slate-*` utilities — because it is reached
// THROUGH SocialProofWall, which is one hop further than the roster walked.
//
// So the identical false green recurred one level down from the fix for it: TrustBadgeRow 11,
// TestimonialCard 11, ReferShare 8, StarRating 1. Depth-limiting a reachability check is the same
// defect as hand-listing it, just with a bigger list. The limit is now 2, which covers every
// rendered component on the public pages today; lib/ still carries no class names, so the noise
// argument for stopping is unchanged.
//
// If a THIRD hop ever appears, this number is the thing to raise — not the roster to hand-edit.
const HOPS = 2;
const PUBLIC_PAGES = (() => {
  const seen = new Set<string>(ENTRY_POINTS);
  let frontier = ENTRY_POINTS;
  for (let i = 0; i < HOPS; i++) {
    const next = frontier.flatMap(localImportsOf).filter((f) => f.startsWith("components/") && !seen.has(f));
    next.forEach((f) => seen.add(f));
    frontier = next;
    if (!next.length) break;
  }
  return [...seen];
})();
console.log(`  (roster: ${PUBLIC_PAGES.length} file(s) — entry points plus what they render)\n`);

let stockHits = 0;
const offenders: string[] = [];
for (const f of PUBLIC_PAGES) {
  let src: string;
  try { src = strip(readFileSync(f, "utf8")); } catch { continue; }
  // Brand-coloured stock utilities. Neutral greys are fine; it is the ACCENT that must be ours.
  const hits = src.match(/\b(?:text|bg|border|from|via|to|ring|shadow|fill|stroke|decoration|outline|accent|divide)-(?:emerald|teal)-\d{2,3}\b/g) || [];
  if (hits.length) { stockHits += hits.length; offenders.push(`${f}: ${hits.length}`); }
}
ck("no stock emerald/teal brand colour on the public pages", stockHits === 0,
   stockHits ? `${stockHits} use(s) — ${offenders.join(" · ")}` : "");

// ── 3. the gradient-clipped-text tell
let gradientText = 0;
for (const f of PUBLIC_PAGES) {
  let src: string;
  try { src = strip(readFileSync(f, "utf8")); } catch { continue; }
  // bg-clip-text + text-transparent is the device; either alone is harmless.
  for (const cls of src.match(/className="[^"]*"/g) || []) {
    if (/bg-clip-text/.test(cls) && /text-transparent/.test(cls)) gradientText++;
  }
}
ck("no gradient-clipped headline text (the template signature)", gradientText === 0,
   gradientText ? `${gradientText} occurrence(s)` : "");

// ── 3b. THE EYEBROW, which is a DEVICE and not a colour — and this check exists because the guard
// went green over it once already. After the redesign I recoloured
//   font-mono text-xs uppercase tracking-widest text-emerald-600   ->   ...text-fetti-deep
// and the colour check passed while the tiny-caps mono kicker — the single clearest template tell,
// repeated seven times on the old page — was still rendering on the homepage via SocialProofWall.
// Guarding the hue of a defect is not guarding the defect.
//
// THE MONO LAW this enforces: IBM Plex Mono carries only a number, a code, a jurisdiction, an index
// or a unit. It is never a section kicker and never a sentence. That rule is what structurally
// denies the eyebrow anywhere to live. Mono data labels are short and are NOT caught by this,
// because the pattern requires the full tiny-caps-kicker stack.
let eyebrows = 0;
const eyebrowFiles: string[] = [];
for (const f of PUBLIC_PAGES) {
  let src: string;
  try { src = strip(readFileSync(f, "utf8")); } catch { continue; }
  let n = 0;
  for (const cls of src.match(/className="[^"]*"/g) || []) {
    const isMono = /\bfont-mono\b/.test(cls);
    const isTiny = /\btext-(xs|\[1[0-2]px\])\b/.test(cls);
    const isCaps = /\buppercase\b/.test(cls);
    const isTracked = /\btracking-(widest|wider)\b/.test(cls);
    if (isMono && isTiny && isCaps && isTracked) n++;
  }
  if (n) { eyebrows += n; eyebrowFiles.push(`${f}: ${n}`); }
}
ck("no tiny-caps mono eyebrow kickers (the device, not the colour)", eyebrows === 0,
   eyebrows ? `${eyebrows} — ${eyebrowFiles.join(" · ")}` : "");

// ── 4. his mark, never a generated one
const home = (() => { try { return readFileSync("app/home/page.tsx", "utf8"); } catch { return ""; } })();
ck("the hero uses Ramon's existing mark on disk", /\/fetti-(logo|emblem)\.png/.test(home));
for (const asset of ["public/fetti-emblem.png", "public/fetti-logo.png"]) {
  let ok = false;
  try { ok = statSync(asset).size > 0; } catch { /* missing */ }
  ck(`${asset} exists and is non-empty`, ok);
}

console.log(fail ? `\n❌ verify:brand-palette — ${fail} check(s) failed\n`
                 : `\n✅ verify:brand-palette — the public site wears Fetti's own brand\n`);
process.exit(fail ? 1 : 0);
