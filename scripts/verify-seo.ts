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
import { stateLabel, allowedStates, lendingSlugs, STATES } from "../lib/lendingMatrix";

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

// 6. In-prose internal links. Body copy may carry [label](/path); app/lending/[slug]/page.tsx
//    renders those as real <Link>s. A typo'd slug there is a 404 shipped inside the copy of the
//    only pages we ask Google to rank, and nothing else would catch it — the string compiles, the
//    page renders, and the link just dies. Every /lending/ target must be a slug that exists.
const allSlugs = new Set(lendingSlugs());
const linkRe = /\[[^\]]+\]\((\/[^)\s]*)\)/g;
let links = 0;
let badLinks: string[] = [];
for (const slug of INDEXABLE_LENDING_SLUGS) {
  const deep = deepContentFor(slug);
  if (!deep) continue;
  const prose = [deep.lede, ...deep.sections.flatMap((s) => s.body), ...deep.faqs.map((f) => f.a)].join(" ");
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(prose))) {
    links++;
    const target = m[1];
    if (!target.startsWith("/lending/")) continue;
    const t = target.slice("/lending/".length);
    if (!allSlugs.has(t)) badLinks.push(`${slug} → ${target}`);
  }
}
chk(badLinks.length === 0,
  badLinks.length ? `in-prose link(s) point at a slug that does not exist: ${badLinks.join(", ")}`
                  : `all ${links} in-prose internal link(s) resolve to a real page`);

// 7. The money pages must link to each other WHERE A REAL HANDOFF EXISTS. They shipped with zero
//    contextual links between them, so no equity moved among the only pages that can rank.
//
//    Scoped to same-state siblings on purpose. The honest handoffs are same-state ones — a Florida
//    investor reading about DSCR hits the five-unit line and needs the Florida commercial page.
//    Requiring a link from dscr-loans-california to a Florida page would be link-building for its
//    own sake: bad for the reader, and exactly the manipulation this file exists to prevent. A page
//    with no same-state sibling is reported, not failed; it stops being exempt the moment one ships.
const stateOf = (slug: string) => slug.slice(slug.lastIndexOf("-") + 1);
const proseOf = (slug: string) => {
  const d = deepContentFor(slug);
  return d ? [d.lede, ...d.sections.flatMap((s) => s.body), ...d.faqs.map((f) => f.a)].join(" ") : "";
};
const withSiblings = INDEXABLE_LENDING_SLUGS.filter((s) =>
  INDEXABLE_LENDING_SLUGS.some((o) => o !== s && stateOf(o) === stateOf(s))
);
const isolated = INDEXABLE_LENDING_SLUGS.filter((s) => !withSiblings.includes(s));
const unlinked = withSiblings.filter(
  (s) => !INDEXABLE_LENDING_SLUGS.some((o) => o !== s && stateOf(o) === stateOf(s) && proseOf(s).includes(`/lending/${o}`))
);
chk(unlinked.length === 0,
  unlinked.length ? `page(s) with a same-state sibling that link to none of them: ${unlinked.join(", ")}`
                  : `all ${withSiblings.length} page(s) with a same-state sibling link to one`);
if (isolated.length) console.log(`        note: ${isolated.join(", ")} has no same-state sibling yet — exempt until one ships`);

// 8. Every indexable page must carry its OWN title and description, and they must fit what Google
//    shows. All four shipped on the template at first: 30 of ~60 characters spent on the brand,
//    no promise, and — on the commercial page — no way to say "business", the word in four of the
//    five queries it targets. A page we ask Google to rank is a page worth writing a title for.
const noOwnMeta = INDEXABLE_LENDING_SLUGS.filter((slug) => {
  const d = deepContentFor(slug);
  return !d?.title || !d?.description;
});
chk(noOwnMeta.length === 0,
  noOwnMeta.length ? `indexable page(s) still on the templated title/description: ${noOwnMeta.join(", ")}`
                   : `all ${INDEXABLE_LENDING_SLUGS.length} indexable pages carry their own title and description`);

const tooLong = INDEXABLE_LENDING_SLUGS.flatMap((slug) => {
  const d = deepContentFor(slug);
  const out: string[] = [];
  if (d?.title && d.title.length > 60) out.push(`${slug} title ${d.title.length} chars`);
  if (d?.description && d.description.length > 155) out.push(`${slug} description ${d.description.length} chars`);
  return out;
});
chk(tooLong.length === 0,
  tooLong.length ? `over-long metadata: ${tooLong.join(", ")}` : "custom titles ≤60 chars, descriptions ≤155");

// 9. Two indexable pages may not open their description with the same construction. A shared
//    opener across state pages is the state-swap tell in the one snippet a searcher actually reads.
//
//    The state name MUST be stripped before comparing. A first cut compared the raw opening words
//    and proved useless the moment it was attacked: "Qualify a Florida rental on its rent…" and
//    "Qualify a California rental on its rent…" diverge at the third word, so the check passed on
//    the exact duplication it exists to catch. Normalising away the state is the whole point —
//    what is being detected is one sentence wearing two state names.
const STATE_WORDS = new Set(Object.values(STATES).map((v) => v.toLowerCase()).concat(["usa", "u.s.", "the"]));
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STATE_WORDS.has(w));
const openers = new Map<string, string>();
const dupeOpeners: string[] = [];
for (const slug of INDEXABLE_LENDING_SLUGS) {
  const d = deepContentFor(slug);
  if (!d?.description) continue;
  const key = normalize(d.description).slice(0, 6).join(" ");
  const prior = openers.get(key);
  if (prior) dupeOpeners.push(`${prior} / ${slug}`);
  else openers.set(key, slug);
}
chk(dupeOpeners.length === 0,
  dupeOpeners.length ? `description(s) share their opening six words (state name ignored): ${dupeOpeners.join(", ")}`
                     : "no two descriptions open the same way");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
