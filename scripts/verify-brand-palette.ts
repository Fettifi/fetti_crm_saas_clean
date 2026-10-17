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

// ── 2. the public pages
const PUBLIC_PAGES = [
  "app/home/page.tsx",
  "components/SiteHeader.tsx",
  "components/SiteFooter.tsx",
];

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
