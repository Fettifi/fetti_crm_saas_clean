// AUTH GATE GUARD — every protected API must be listed TWICE, and forgetting the second list
// leaves it wide open.
//
// proxy.ts is the API gate (Next 16). A route named in `apiProtected` is only actually reached
// by that check if the middleware RUNS for it — and `config.matcher`'s catch-all EXCLUDES all
// /api paths, so each protected API must ALSO be listed explicitly in `config.matcher`.
//
// This already nearly shipped an open API once: /api/competitors was in apiProtected, absent
// from the matcher, and fully public until an adversarial review caught it. The route LOOKED
// protected — the same failure mode as a heartbeat that logs at invocation, a cap that reads
// null as 0, and a constant named MAX_DOCS that caps nothing. A list you have to remember to
// update twice will eventually be updated once.
//
// Runs in milliseconds with ZERO API calls. Pure static comparison of the two lists.
import { readFileSync } from "fs";
import path from "path";

const PROXY = path.join(process.cwd(), "proxy.ts");
const src = readFileSync(PROXY, "utf8");

/** Pull a string-array literal out of the source by its assignment/key name. */
function arrayAfter(marker: RegExp): string[] {
  const m = src.match(marker);
  if (!m) return [];
  const from = src.indexOf("[", m.index! + m[0].length - 1);
  if (from < 0) return [];
  const to = src.indexOf("]", from);
  if (to < 0) return [];
  return [...src.slice(from, to).matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

const protectedRoutes = arrayAfter(/const\s+apiProtected\s*=\s*/);
// The matcher holds page patterns too; only the /api ones are relevant here.
const matcher = arrayAfter(/matcher\s*:\s*/).filter((p) => p.startsWith("/api"));

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  ${d}` : ""}`); };

ck("proxy.ts apiProtected list parsed", protectedRoutes.length > 0, `${protectedRoutes.length} routes`);
ck("proxy.ts config.matcher /api entries parsed", matcher.length > 0, `${matcher.length} entries`);
if (!protectedRoutes.length || !matcher.length) {
  console.error("\nCould not read one of the lists — proxy.ts may have been restructured.");
  console.error("Do NOT ignore this: the guard silently passing is exactly the failure it exists to catch.");
  process.exit(1);
}

// A matcher entry like '/api/los/:path*' covers '/api/los'. Compare on the literal prefix.
const covered = new Set(matcher.map((m) => m.replace(/\/:path\*$/, "").replace(/\/\(\.\*\)$/, "")));
const unguarded = protectedRoutes.filter((r) => !covered.has(r));

ck(
  "every apiProtected route also appears in config.matcher",
  unguarded.length === 0,
  unguarded.length ? `${unguarded.length} OPEN` : `${protectedRoutes.length} routes double-listed`,
);

if (unguarded.length) {
  console.error("\n  THESE ROUTES ARE PUBLIC RIGHT NOW — they are in apiProtected but the");
  console.error("  middleware never runs for them, so the session check is never reached:\n");
  for (const r of unguarded) console.error(`      ${r}      → add '${r}/:path*' to config.matcher`);
}

// The reverse is not a security hole, but it is a sign the two lists have drifted apart, and
// drift is what produced the original incident.
const orphanMatchers = [...covered].filter((m) => !protectedRoutes.some((r) => m === r || m.startsWith(r)));
if (orphanMatchers.length) {
  console.log(`note: ${orphanMatchers.length} matcher entr${orphanMatchers.length === 1 ? "y is" : "ies are"} not in apiProtected (deliberate for public routes that still need middleware — check if unexpected): ${orphanMatchers.slice(0, 6).join(", ")}`);
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
