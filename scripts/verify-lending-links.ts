/**
 * GUARD: every /lending link the marketing pages emit must resolve to a real route.
 *
 * The defect this exists to prevent, found live on fettifi.com 2026-10-17 by opening the site and
 * reading the network log: FOUR 404s on the homepage.
 *
 *   /lending/dscr-loans/usa          404
 *   /lending/fix-and-flip-loans/usa  404
 *   /lending/hard-money-loans/usa    404
 *   /lending/business-loans/usa      404
 *
 * app/home/page.tsx built its programme hrefs as `/lending/${slug}/${state}` — a SLASH. The
 * canonical lending slug is `${product}-${state}`, ONE path segment joined by a HYPHEN
 * (lib/lendingMatrix.ts, lendingSlugs()), and app/lending/[slug] is a single dynamic segment. So
 * every Investment and Business programme link on the most-visited page of the site landed a
 * customer on a bare, unstyled Next.js 404 — while the real pages existed and were good.
 *
 * Nothing caught it. The pages built, the routes were fine, the homepage rendered, the brand guard
 * was green. A link is only wrong at the moment someone follows it, which is the worst possible
 * place for the first check to happen.
 *
 *   npm run verify:lending-links
 *
 * Exit 1 = a marketing page links to a /lending URL that no route can serve.
 */
import { lendingSlugs } from "@/lib/lendingMatrix";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond || !detail ? "" : `\n      ${detail}`}`);
  if (!cond) failures++;
};

const VALID = new Set(lendingSlugs());

/** Walk the marketing surface. Deliberately NOT the whole app: the CRM is behind auth. */
const ROOTS = ["app/home", "app/lending", "app/quote", "app/start", "components/site", "components"];
function files(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// TEMPLATE LINKS ARE THE ONES THAT BITE, because a literal href is visible when you read the file
// and a template is assembled at render. So both shapes are extracted: a literal `/lending/foo`
// and the SHAPE of a template, which is checked for the number of path segments rather than the
// slug (the slug is only known at runtime).
const LITERAL = /["'`]\/lending\/([a-z0-9-]+)["'`\s)]/g;
const TEMPLATE = /`\/lending\/\$\{[^}]+\}([^`]*)`/g;

const scanned = ROOTS.flatMap((r) => files(r));
ok("the marketing surface was found", scanned.length > 0, `${scanned.length} file(s)`);

const badLiterals: string[] = [];
const badTemplates: string[] = [];
for (const f of scanned) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(LITERAL)) {
    if (!VALID.has(m[1])) badLiterals.push(`${f}: /lending/${m[1]}`);
  }
  for (const m of src.matchAll(TEMPLATE)) {
    // Whatever follows the first interpolation must not introduce another path segment.
    // `/lending/${slug}`        -> tail ""        OK
    // `/lending/${slug}-${st}`  -> tail "-${st}"  OK (still one segment)
    // `/lending/${slug}/${st}`  -> tail "/${st}"  WRONG — two segments, no route
    if (m[1].includes("/")) badTemplates.push(`${f}: \`/lending/\${…}${m[1]}\``);
  }
}

ok("no marketing page links to an unknown /lending slug", badLiterals.length === 0,
   badLiterals.join("\n      "));
ok("no /lending link is built with TWO path segments — app/lending/[slug] is one",
   badTemplates.length === 0,
   badTemplates.length ? badTemplates.join("\n      ") +
     "\n      The canonical slug is `${product}-${state}` (lendingMatrix.lendingSlugs()). A slash\n" +
     "      here renders a live 404 for a customer and nothing else will catch it." : "");

// NOT VACUOUS. Every check above passes if the scanner simply finds nothing — which is exactly how
// a guard like this rots when a directory is renamed. So prove the matchers fire on known input.
const probe = (src: string) => {
  const lits = [...src.matchAll(LITERAL)].map((m) => m[1]);
  const tmpl = [...src.matchAll(TEMPLATE)].map((m) => m[1]);
  return { lits, tmpl };
};
const p1 = probe('<a href="/lending/dscr-loans-usa">x</a>');
ok("the literal matcher fires on a good link", p1.lits.length === 1 && VALID.has(p1.lits[0]));
const p2 = probe('<a href="/lending/not-a-real-slug">x</a>');
ok("…and a bogus slug is NOT in the valid set", p2.lits.length === 1 && !VALID.has(p2.lits[0]));
const p3 = probe("href={`/lending/${it.slug}/${c.state}`}");
ok("THE REGRESSION: the two-segment template shape is detected",
   p3.tmpl.length === 1 && p3.tmpl[0].includes("/"));
const p4 = probe("href={`/lending/${it.slug}-${c.state}`}");
ok("…and the correct hyphen shape is not flagged",
   p4.tmpl.length === 1 && !p4.tmpl[0].includes("/"));
ok("the valid slug set is populated", VALID.size > 50, `${VALID.size} slugs`);
ok("…and includes the four that 404'd", ["dscr-loans-usa", "fix-and-flip-loans-usa",
   "hard-money-loans-usa", "business-loans-usa"].every((s) => VALID.has(s)));

console.log(failures ? `\n❌ verify:lending-links — ${failures} failure(s)\n`
                     : `\n✅ verify:lending-links — every /lending link resolves (${VALID.size} valid slugs, ${scanned.length} files)\n`);
process.exit(failures ? 1 : 0);
