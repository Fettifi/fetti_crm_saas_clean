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

console.log(fail ? `\n❌ ${fail} check(s) failed — a model knob that misses a call site is not a knob\n`
                 : `\n✅ ALL PASS — one ANTHROPIC_MODEL setting moves every Anthropic call site\n`);
process.exit(fail ? 1 : 0);
