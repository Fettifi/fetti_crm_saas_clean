// A PAGE MAY NOT ASK GOOGLE TO INDEX IT ON BORROWED WORDS.
//
// Ramon, 2026-08-07: "Google says our pages aren't indexing. Why not?" Nothing was blocking
// them. The /lending pages returned 200, carried no noindex, and had correct self-canonicals.
// Google was crawling them and declining to index, and the reason was measurable: 84 of the 92
// URLs were the same twelve products multiplied across states — 535 words each, 97.5% identical
// to their siblings, every differing run just the state name. That is the doorway pattern named
// in Google's own spam policy, and the result is not a penalty notice but silence.
//
// So a page earns a place in the index by having something of its own to say. This guard makes
// that enforceable rather than aspirational:
//   1. every indexable slug is real and carries its own DEEP_CONTENT
//   2. it clears MIN_INDEXABLE_WORDS of actual prose
//   3. no two indexable pages exceed MAX_PAIRWISE_SIMILARITY
//   4. the page emits robots.index from the allow-list, and the sitemap lists only those
//
//   npm run verify:seo
import { readFileSync } from "fs";
import { INDEXABLE_LENDING_SLUGS, MIN_INDEXABLE_WORDS, MAX_PAIRWISE_SIMILARITY } from "../lib/seoIndexable";
import { PRODUCTS } from "../lib/lendingProducts";
import { deepContentFor } from "../lib/lendingDeepContent";
import { stateLabel, allowedStates, lendingSlugs } from "../lib/lendingMatrix";

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };

function parse(slug: string) {
  for (const p of Object.keys(PRODUCTS)) {
    if (slug.startsWith(p + "-")) {
      const st = slug.slice(p.length + 1);
      if (stateLabel(st) && allowedStates(p).includes(st)) return { product: p, state: st };
    }
  }
  return null;
}

/** The visible prose of a page, composed exactly as app/lending/[slug]/page.tsx renders it. */
function pageText(slug: string): string {
  const parsed = parse(slug);
  if (!parsed) return "";
  const prod = PRODUCTS[parsed.product];
  const state = stateLabel(parsed.state)!;
  const deep = deepContentFor(slug);
  const parts: string[] = [
    prod.label, deep?.lede || prod.intro,
    ...prod.bullets, ...prod.requirements,
    ...(deep ? deep.sections.flatMap((s) => [s.h, ...s.body]) : []),
    ...[...prod.faqs, ...(deep?.faqs ?? [])].flatMap((f) => [f.q, f.a]),
  ];
  return parts.join(" ").replace(/\{state\}/g, state);
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** Jaccard over 3-word shingles — the standard near-duplicate measure. Unigrams are too
 *  forgiving here: two pages can share every word and still differ, or share none and read
 *  identically. Shingles compare phrasing, which is what a doorway page copies. */
function similarity(a: string, b: string): number {
  const sh = (t: string) => {
    const w = words(t); const s = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) s.add(w[i] + " " + w[i + 1] + " " + w[i + 2]);
    return s;
  };
  const A = sh(a), B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

console.log("\nSEO — indexable pages must earn it\n");

// 0. PROVE THE DETECTOR DETECTS. With a single indexable page there are no pairs to compare,
//    so the similarity check below would pass while measuring nothing. Point it at two pages
//    known to be near-identical siblings first: if it cannot see THAT, its silence is worthless.
const siblings = lendingSlugs().filter((s) => s.startsWith("home-purchase-loans-") && !deepContentFor(s));
if (siblings.length >= 2) {
  // The bar is the ceiling this guard enforces, not a number picked out of the air: a detector
  // that cannot see a known duplicate as EXCEEDING its own ceiling is not enforcing anything.
  // (First run of this self-test read 87.3% against an arbitrary 90% bar and failed — the
  // detector was right and the bar was invented. Shingle Jaccard runs below the 97.5%
  // character-level figure because the state name perturbs every shingle it appears in.)
  const sim = similarity(pageText(siblings[0]), pageText(siblings[1]));
  chk(sim > MAX_PAIRWISE_SIMILARITY,
    `the duplicate detector sees a known doorway pair as over the ceiling — ${siblings[0]} vs ${siblings[1]} = ${(sim * 100).toFixed(1)}% > ${(MAX_PAIRWISE_SIMILARITY * 100).toFixed(0)}%`);
} else {
  chk(false, "could not find two templated sibling pages to self-test the detector against");
}

// 1. Every indexable slug must be a real page carrying its own copy.
for (const slug of INDEXABLE_LENDING_SLUGS) {
  chk(!!parse(slug), `${slug} resolves to a real product x state page`);
  chk(!!deepContentFor(slug), `${slug} has its own substantive copy in DEEP_CONTENT`);
}

// 2. Word floor — measured on the composed prose the page actually renders.
for (const slug of INDEXABLE_LENDING_SLUGS) {
  const n = words(pageText(slug)).length;
  chk(n >= MIN_INDEXABLE_WORDS, `${slug} carries ${n} words of prose (floor ${MIN_INDEXABLE_WORDS})`);
}

// 3. Doorway ceiling between the pages we DO put forward.
let pairs = 0;
for (let i = 0; i < INDEXABLE_LENDING_SLUGS.length; i++) {
  for (let j = i + 1; j < INDEXABLE_LENDING_SLUGS.length; j++) {
    pairs++;
    const a = INDEXABLE_LENDING_SLUGS[i], b = INDEXABLE_LENDING_SLUGS[j];
    const sim = similarity(pageText(a), pageText(b));
    chk(sim <= MAX_PAIRWISE_SIMILARITY, `${a} vs ${b} = ${(sim * 100).toFixed(1)}% (ceiling ${(MAX_PAIRWISE_SIMILARITY * 100).toFixed(0)}%)`);
  }
}
console.log(`        ${pairs} indexable pair(s) compared${pairs === 0 ? " — only one page is indexable today; the self-test above is what keeps this honest" : ""}`);

// 4. The wiring itself. A rule nothing calls is the bug this whole file exists to prevent.
const page = readFileSync("app/lending/[slug]/page.tsx", "utf8");
chk(/robots:\s*\{\s*index:\s*isIndexableLendingSlug\(slug\)/.test(page),
  "the page emits robots.index straight from the allow-list");
const sitemap = readFileSync("app/sitemap.ts", "utf8");
chk(/lendingSlugs\(\)\.filter\(isIndexableLendingSlug\)/.test(sitemap),
  "the sitemap lists only the pages we ask Google to index");

// 5. And the two must AGREE — a noindex page in the sitemap is a contradiction.
const listed = lendingSlugs().filter((s) => INDEXABLE_LENDING_SLUGS.includes(s));
const noindexed = lendingSlugs().filter((s) => !INDEXABLE_LENDING_SLUGS.includes(s));
chk(listed.length === INDEXABLE_LENDING_SLUGS.length && noindexed.length > 0,
  `${listed.length} page(s) submitted for indexing, ${noindexed.length} served as noindex,follow`);

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
