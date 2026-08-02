// SENT BUT NEVER READ — the screen/document divergence detector.
//
// Ramon, 2026-08-02: "run the same override check on the other calculators."
//
// The audit found the SAME defect in two unrelated places, which is what makes it a shape rather
// than a bug:
//   - app/api/pricer/pdf/route.ts accepted `originationPct` from the screen and never passed it
//     to the engine, so the advisor saw one origination fee and the borrower's PDF showed another.
//   - app/api/compare/{pdf,email}/route.ts loaded the saved comparison by id and discarded the
//     entire posted body, so "save -> correct a rate -> email borrower" mailed the stale version.
//
// Neither errored. Both produced a confident, wrong, borrower-facing document. The signature is
// mechanical: a client sends a field, the receiving route never reads it.
//
// This scans every client fetch payload in the app and every field its target route actually
// reads, and reports the difference.
//
//   npx tsx scripts/verify-payloads.ts
//
// WHAT IT CATCHES: the pricer shape — a field arrives and the route never mentions it. Verified
// by re-introducing that exact bug: with `originationPct` removed from the PDF route, this fails.
//
// WHAT IT DOES NOT CATCH, stated plainly so nobody trusts it further than it goes: the COMPARE
// shape, where the route does mention the field but a branch throws the posted value away
// (`b.id ? await getComparison(b.id) : {...b}`). Every name is present, so a name-level check
// sees nothing wrong. Catching that needs the merge to be a shared function — which is why
// mergeComparison exists in lib/compareTypes.ts rather than being inlined twice.
//
// DELIBERATELY CONSERVATIVE. It only judges payloads it can parse with certainty, and it PRINTS
// the count it could not parse — a detector that quietly analyses 3 of 40 payloads and says PASS
// is the same lie it exists to catch.
import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const ROOT = process.cwd();
const sh = (c: string) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8" }); } catch { return ""; } };

// Fields that are legitimately consumed by something other than a `b.x` read, or are routing
// metadata rather than data. Each entry is a REASON, not a convenience.
const EXEMPT = new Set([
  "id",            // used for lookup, often via a helper
  "to",            // recipient plumbing
  "leadId", "loanFileId", "lead_id", "loan_file_id",
]);

type Payload = { file: string; line: number; endpoint: string; keys: string[] };
const payloads: Payload[] = [];
let unparsed = 0, unresolvedDynamic = 0;

const clientFiles = sh(`grep -rl 'JSON.stringify' --include=*.tsx --include=*.ts app components 2>/dev/null`).split("\n").filter(Boolean);

/** Top-level keys of a brace-balanced object literal.
 *
 *  A STATE MACHINE, not a regex sweep. The first version matched any identifier followed by a
 *  comma, so in `{ price: dealBasis, ratePct: effRate }` it reported the VALUES as keys and then
 *  "proved" the route ignored them. A detector whose findings are mostly its own parse errors
 *  gets switched off, and then it protects nothing — the exact failure it exists to catch. */
function topLevelKeys(src: string, openIdx: number): string[] | null {
  let depth = 0, out: string[] = [], quote: string | null = null, expectKey = true;
  for (let i = openIdx; i < src.length && i < openIdx + 6000; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") {
      if (depth === 1 && expectKey) {                      // a quoted key: "foo": v
        const m = /^(["'`])([^"'`]+)\1\s*:/.exec(src.slice(i));
        if (m) { out.push(m[2]); expectKey = false; i += m[0].length - 1; continue; }
      }
      quote = c; continue;
    }
    if (c === "{" || c === "[" || c === "(") { depth++; if (depth === 1) expectKey = true; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; if (depth === 0) return out; continue; }
    if (depth !== 1) continue;
    if (c === ",") { expectKey = true; continue; }
    if (/\s/.test(c)) continue;
    // A spread hides keys from us — refuse the payload rather than report a partial list as whole.
    if (src.startsWith("...", i)) return null;
    if (expectKey) {
      const m = /^([A-Za-z_$][\w$]*)\s*([:,}])/.exec(src.slice(i));
      if (!m) return null;                                 // computed key or something unparsed
      out.push(m[1]);
      expectKey = m[2] !== ":";                            // `k: v` -> skip the value; `k,` -> shorthand
      i += m[1].length - 1;
    }
    // inside a value: fall through, the depth/quote handling above skips it
  }
  return null;
}

for (const f of clientFiles) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  const re = /fetch\(\s*[`"']([^`"']+)[`"']/g;
  for (const m of src.matchAll(re)) {
    const endpoint = m[1].split("?")[0];
    if (!endpoint.startsWith("/api/")) continue;
    // A template-literal endpoint (/api/leads/${id}) cannot be resolved to one route file, and
    // shelling out with it unexpanded is how this script emitted raw sh syntax errors.
    if (endpoint.includes("${") || endpoint.includes("{")) { unresolvedDynamic++; continue; }
    // BOUND THE SEARCH TO THIS fetch(...) CALL. A fixed character window ran past the closing
    // paren into the NEXT fetch, so a payload was attributed to the wrong endpoint and the
    // mismatch it "found" was the detector's own bookkeeping. Walk to the matching paren.
    const open = src.indexOf("(", m.index!);
    let d = 0, end = -1;
    for (let i = open; i < src.length && i < open + 4000; i++) {
      const ch = src[i];
      if (ch === "(") d++;
      else if (ch === ")") { d--; if (d === 0) { end = i; break; } }
    }
    if (end === -1) { unparsed++; continue; }
    const after = src.slice(m.index!, end + 1);
    const bi = after.indexOf("JSON.stringify(");
    if (bi === -1) continue;                       // GET or FormData — nothing to compare
    const objStart = after.indexOf("{", bi);
    const callEnd = after.indexOf(")", bi + 15);
    if (objStart === -1 || (callEnd !== -1 && callEnd < objStart)) { unparsed++; continue; }
    const keys = topLevelKeys(after, objStart);
    if (!keys || !keys.length) { unparsed++; continue; }
    payloads.push({ file: f, line: src.slice(0, m.index!).split("\n").length, endpoint, keys });
  }
}

/** Resolve /api/foo/bar (and /api/foo/[id]/bar) to its route file. */
function routeFile(endpoint: string): string | null {
  const segs = endpoint.replace(/^\//, "").split("/");
  for (const cand of [segs.join("/"), segs.slice(0, -1).join("/")]) {
    const p = path.join("app", cand, "route.ts");
    try { readFileSync(path.join(ROOT, p), "utf8"); return p; } catch { /* keep looking */ }
  }
  // dynamic segment: swap any non-matching segment for a [param] directory
  const globbed = sh(`find app/${segs.slice(0, 2).join("/")} -name route.ts 2>/dev/null`).split("\n").filter(Boolean);
  if (globbed.length === 1) return globbed[0];
  const tail = segs[segs.length - 1];
  const match = globbed.filter((g) => g.includes(`/${tail}/route.ts`));
  return match.length === 1 ? match[0] : null;
}

const problems: string[] = [];
let checked = 0, unresolved = 0;
for (const p of payloads) {
  const rf = routeFile(p.endpoint);
  if (!rf) { unresolved++; continue; }
  const rsrc = readFileSync(path.join(ROOT, rf), "utf8");
  checked++;
  const missing = p.keys.filter((k) => {
    if (EXEMPT.has(k)) return false;
    // Any mention at all counts as read: b.k, body.k, destructuring, or a string key lookup.
    return !new RegExp(`(?<![\\w$])${k}(?![\\w$])`).test(rsrc);
  });
  if (missing.length) {
    problems.push(`${p.file}:${p.line} -> ${p.endpoint}\n     route ${rf} never reads: ${missing.join(", ")}`);
  }
}

console.log(`\nPAYLOAD REACH — ${payloads.length} client payloads parsed, ${checked} matched to a route`);
if (unparsed) console.log(`  (${unparsed} payload(s) not statically parseable — spread or computed; NOT checked)`);
if (unresolved) console.log(`  (${unresolved} endpoint(s) could not be resolved to a single route file; NOT checked)`);
if (unresolvedDynamic) console.log(`  (${unresolvedDynamic} template-literal endpoint(s) skipped; NOT checked)`);
console.log("");

if (!problems.length) {
  console.log(`PASS — every field a screen sends is read by the route it is sent to.\n`);
  process.exit(0);
}
console.error(`FAIL — ${problems.length} payload(s) send a field the route ignores:\n`);
for (const p of problems) console.error(`  ${p}\n`);
console.error("A field that is sent and never read means the screen and the document disagree, and");
console.error("nothing errors. If the field is genuinely not needed, STOP SENDING IT — an ignored");
console.error("field in a payload reads as wired to the next person who looks.\n");
process.exit(1);
