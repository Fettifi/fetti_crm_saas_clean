// ONE SETTING MUST MOVE EVERY MODEL, INCLUDING THE ONE THE BORROWER TALKS TO.
//
// highest-model-always is one of Ramon's hard rules, and the whole point of an env knob is that
// honouring it is one change. On 2026-09-19 it was not: 19 call sites read ANTHROPIC_MODEL, but
// lib/aiFallback.ts hardcoded the id with no env read at all — and that file is the Mark chat, the
// first-touch nurture and the hot-lead reply — while lib/contentQC.ts read a different variable name.
// Setting ANTHROPIC_MODEL in Vercel would have moved 19 paths and silently left the borrower-facing
// one on the old model. Nothing said so.
//
// This asserts every Anthropic call site resolves its model from ANTHROPIC_MODEL. It deliberately does
// NOT assert which model id is current — an id written into a guard expires exactly the way an id
// written into a memory does.
//
//   npm run verify:model-pin
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`); };
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules" || f === ".next" || f.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};

console.log("\nMODEL PIN — one setting moves every Anthropic call site\n");

const files = [...walk("lib"), ...walk("app"), ...walk("scripts")];
const offenders: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/api\.anthropic\.com/.test(src)) continue;        // only files that actually call Anthropic
  const body = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  // Every model literal in such a file must sit behind ANTHROPIC_MODEL.
  const literals = [...body.matchAll(/["'](claude-[a-z0-9.-]+)["']/g)].map((m) => m[1]);
  if (!literals.length) continue;
  if (!/process\.env\.ANTHROPIC_MODEL/.test(body))
    offenders.push(`${f} calls Anthropic with ${literals[0]} but never reads ANTHROPIC_MODEL`);
}
ck(`every file that calls api.anthropic.com resolves its model from ANTHROPIC_MODEL (${files.length} files scanned)`,
  offenders.length === 0, offenders.join("\n       "));

// The borrower-facing chain by name — the one that went stale — so a future refactor has to argue.
for (const f of ["lib/aiFallback.ts", "lib/contentQC.ts"]) {
  const src = readFileSync(f, "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  ck(`${f} reads ANTHROPIC_MODEL`, /process\.env\.ANTHROPIC_MODEL/.test(src));
}

// WHICH MODEL IS ACTUALLY IN FORCE? A WIRED KNOB NOBODY TURNED IS STILL THE OLD MODEL.
//
// Everything above proves the knob reaches every call site. Nothing proved it was ever SET — and on
// 2026-10-11 it was not, in any of the 41 production env names. So every one of those correctly
// wired `process.env.ANTHROPIC_MODEL || "<literal>"` expressions fell through to its literal, and
// the whole app — income extraction, condition parsing, underwriting, the borrower-facing chat —
// ran a previous-generation model while this guard printed ALL PASS. highest-model-always was
// being violated by the thing built to enforce it, silently, because the default was invisible.
//
// The comment at the top is still right that an ID DOES NOT BELONG IN A GUARD: it expires. So this
// does not assert which id is correct. It PRINTS the id that will actually be used, and it fails if
// the call sites disagree with each other — drift between literals is the shape that let
// lib/aiFallback.ts sit on a stale model while nineteen other paths moved.
// Make the invisible visible and let the human judge it. [[prove-it-dont-announce]]
const fallbacks = new Map<string, string[]>();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/api\.anthropic\.com/.test(src)) continue;
  const body = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  // THE LITERAL NEED NOT SIT NEXT TO THE ENV READ, AND THE ONE FILE THAT DRIFTED IS THE PROOF.
  // The first cut required `ANTHROPIC_MODEL || "<literal>"` adjacently. lib/contentQC.ts:22 reads
  // `process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || "claude-opus-4-8"` — a second env
  // name in between — so the check could not see it, and lib/contentQC.ts is the very file this
  // block's own comment names as having sat on a stale model. A guard blind at exactly the place
  // that broke before is worse than no guard: it reports ALL PASS over the gap. Allow any chain of
  // further `process.env.X ||` terms before the literal. [[a-red-guard-is-a-hypothesis]]
  for (const m of body.matchAll(/process\.env\.ANTHROPIC_MODEL\s*(?:\|\|\s*process\.env\.[A-Z0-9_]+\s*)*\|\|\s*["'](claude-[a-z0-9.-]+)["']/g)) {
    if (!fallbacks.has(m[1])) fallbacks.set(m[1], []);
    fallbacks.get(m[1])!.push(f);
  }
}
const env = process.env.ANTHROPIC_MODEL;
const ids = [...fallbacks.keys()].sort();
console.log("");
console.log(`  model actually in force here: ${env ? `${env}  (from ANTHROPIC_MODEL)` : `${ids[0] ?? "unknown"}  (ANTHROPIC_MODEL is UNSET — the literal fallback is what runs)`}`);
if (!env)
  console.log(`       ANTHROPIC_MODEL is not set in this environment, so the knob is wired but not turned.\n` +
              `       Confirm it is set in Vercel production too, or the deployed app runs the literal.`);
// A FLOOR, BECAUSE `<= 1` IS ALSO TRUE AT ZERO. Written as `ids.length <= 1` this printed
// "✅ all 0 call site(s) share ONE fallback id" and "model actually in force here: unknown" — green,
// while seeing nothing at all. Centralise model resolution into one helper (a likely refactor, and
// the right one) and the regex stops matching anywhere: the check would go green on the day it went
// blind. Require EXACTLY ONE id, and say so when there are none.
// [[assertions-inside-a-branch-go-vacuous]] · [[things-that-look-like-they-work]]
ck(`all ${[...fallbacks.values()].flat().length} call site(s) share ONE fallback id`, fallbacks.size === 1,
   fallbacks.size === 0
     ? `found NO "ANTHROPIC_MODEL || <literal>" fallback in any file that calls api.anthropic.com. ` +
       `This check has gone blind — either the pattern moved (a shared helper?) or the call sites did. ` +
       `Find where the model id now comes from and point this at it.`
     : ids.map((i) => `${i} <- ${fallbacks.get(i)!.length} file(s), e.g. ${fallbacks.get(i)![0]}`).join("\n       "));

console.log(fail ? `\n❌ ${fail} check(s) failed — a model knob that misses a call site is not a knob\n`
                 : `\n✅ ALL PASS — one ANTHROPIC_MODEL setting moves every Anthropic call site\n`);
process.exit(fail ? 1 : 0);
