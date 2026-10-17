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
// THE ENTRY POINTS ARE DISCOVERED, NOT LISTED — and the hand-listed version is why this guard
// reported green over 85 stock utilities on 2026-10-17.
//
// It named three files: app/home/page.tsx and the two shared chrome components. Everything else a
// visitor can reach was invisible to it. Measured when the walk was finally run:
//   /apply/form 40 · /calculator 17 · /lending 11 · /quote 11 · /about 4 · /privacy 2
// including `bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent` on
// /calculator — the gradient-clipped headline this guard exists to catch, on a page it never
// looked at — and a `font-mono text-xs uppercase tracking-widest` kicker on /lending that had
// already been RECOLOURED to a brand token, so a hue check would have passed it while the device
// survived. That is this guard's own documented trap, reproduced because the roster was a list.
//
// A hand-maintained list of what to check is a promise that somebody will remember. The surface
// here is enumerable — public routes have page.tsx files — so it is enumerated. A new public page
// is covered the moment it exists.
//
// SCOPE: public routes only. The authenticated surfaces (the LOS, admin, the underwriter desk) are
// internal tools and are deliberately out of scope — they are not what a borrower sees, and
// dragging them in would make this permanently red for no brand reason.
// EVERY PUBLIC PAGE MUST BE CLASSIFIED. Discovery alone was not enough: walking app/ for page.tsx
// found 91 files and 586 stock utilities, because it swept in the internal loan-officer tools —
// /pricer, /scenarios, /deal-analyzer, /preapprovals, /settings, /messages, /lookup — which are
// not what a borrower sees and which would make this guard permanently red for no brand reason.
//
// But a hand-listed MARKETING set is the same defect that caused this in the first place. So both:
// the pages are DISCOVERED, and each one must be classified as borrower-facing or internal. Add a
// new page and the guard fails until you say which it is. The classification is the registry; the
// filesystem is the surface. [[a-registry-must-enumerate-its-own-surface]]
const MARKETING = [
  "home", "lending", "about", "quote", "calculator", "apply", "privacy", "terms",
  "start", "lp", "refer", "rsvp", "share-your-win", "optin", "file", "letter", "links",
];
// Internal tools. Each needs a reason a stranger could evaluate — "it is not borrower-facing" is
// the whole bar, but it has to be SAID, so nobody parks a marketing page here to quiet the guard.
const INTERNAL: Record<string, string> = {
  api: "route handlers, no markup", los: "loan origination desk, staff only",
  admin: "staff only", underwriter: "staff only", studio: "internal content tooling",
  dashboard: "staff only", scout: "internal prospecting", photos: "internal upload tool",
  sign: "token-gated signing surface", "card-auth": "token-gated payment surface",
  esign: "token-gated signing surface", portal: "token-gated borrower portal, not marketing",
  "update-password": "auth surface", login: "auth surface", "reset-password": "auth surface",
  pricer: "internal pricing desk", pricing: "internal pricing desk",
  scenarios: "internal scenario desk", income: "internal income analysis",
  "deal-analyzer": "internal underwriting tool", preapprovals: "internal pre-approval desk",
  settings: "staff settings", messages: "internal inbox", lookup: "internal CRM lookup",
  competitors: "internal market research", content: "internal content desk",
  funnel: "internal funnel analytics", growth: "internal growth desk",
  doctor: "internal diagnostics", realtors: "internal partner desk",
  partners: "internal partner desk", agents: "internal agent desk",
  rupee: "internal AI staff console", show: "internal studio",
  "tiktok-today": "internal content prompt", go: "redirect shim, no markup",
  underwrite: "internal underwriting desk", tv: "internal display",
  ads: "internal ad desk", automations: "internal automation desk", command: "internal command centre",
  compare: "internal comparison tool", connect: "internal integrations", conversations: "internal inbox",
  leads: "internal lead desk", pipeline: "internal pipeline", requests: "internal request queue",
  roadmap: "internal roadmap", security: "internal security settings", "task-list": "internal task list",
  team: "internal team admin", "page.tsx": "app/page.tsx re-exports the internal dashboard",
  training: "internal training", proof: "internal proof desk",
};

function publicEntryPoints(dir = "app", out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) publicEntryPoints(full, out);
    else if (e === "page.tsx") out.push(full);
  }
  return out;
}

const ALL_PAGES = publicEntryPoints();
const topSeg = (f: string) => f.split("/")[1] ?? "";
const UNCLASSIFIED = [...new Set(ALL_PAGES.map(topSeg))]
  .filter((seg) => seg && !MARKETING.includes(seg) && !(seg in INTERNAL));
const MARKETING_PAGES = ALL_PAGES.filter((f) => MARKETING.includes(topSeg(f)));

const ENTRY_POINTS = [
  ...MARKETING_PAGES,
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
ck(`every public route is classified as borrower-facing or internal (${ALL_PAGES.length} page(s))`,
   UNCLASSIFIED.length === 0,
   UNCLASSIFIED.length ? `unclassified: ${UNCLASSIFIED.join(", ")} — add to MARKETING or to INTERNAL with a reason` : "");
for (const [seg, why] of Object.entries(INTERNAL)) {
  if (!why.trim()) { ck(`INTERNAL["${seg}"] carries a reason`, false); }
}

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
