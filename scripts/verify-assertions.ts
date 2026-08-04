// THE GUARD THAT CHECKS THE GUARDS.
//
// Ramon, 2026-08-04: "No longer make assumption or assertions ever. Validate and verify every
// decision, every action so that they make sense. Add that to the rules."
//
// He said it after the seventh assertion of mine in a single day passed without checking
// anything. Every one of them printed "ok" while the defect it was written for sat untouched:
//
//   1. matched an `import` line instead of the call site
//   2. filtered the corpus on the very flag it was testing
//   3. built its input from a SUMMARY instead of the real record — passed with and without the fix
//   4. same, second time
//   5. `chk(message, condition)` reversed — a non-empty string is truthy, so all four printed "ok true"
//   6. matched a useEffect DEPENDENCY ARRAY instead of the object being built
//   7. a browser check that could not discriminate between pass and fail at all
//
// A written rule does not stop this; I have to remember it at the moment I write the assertion,
// which is exactly the moment I am confident and wrong. So the rule becomes a gate.
//
// WHAT THIS FILE CHECKS — and what it does not:
//
//   ✔ every scripts/verify-*.ts is REACHABLE (an npm script) or explicitly declared manual
//   ✔ every guard EXITS NON-ZERO on failure — one that reports FAIL and exits 0 is decoration
//   ✔ no reversed chk(message, condition), derived from each file's OWN helper signature
//   ✔ no source assertion that only matches an import line or a dependency array
//   ✔ no regex that matches the empty string
//
//   ✘ it cannot prove a guard was ever made to FAIL. That is still mine to do by hand: break the
//     thing, watch it go red, restore. This file catches the mechanical shapes, not the discipline.
//
//   npx tsx scripts/verify-assertions.ts
import { readFileSync, readdirSync, existsSync } from "fs";

let bad = 0;
const fail = (m: string) => { console.log(`  FAIL  ${m}`); bad++; };
const ok = (m: string) => console.log(`  ok    ${m}`);

// Blank out comments and string/template literals while PRESERVING every offset, so reported
// line numbers stay true. Without this the scan reads its own prose: the first run flagged six
// call sites that were really a `function check(...)` definition, the text "check(s) failed"
// inside a template string, and a comment in this very file. A checker that cannot tell code
// from commentary is the same failure it exists to catch.
const stripNonCode = (s: string) => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") { out += " "; i++; } out += "\n"; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); const stop = e < 0 ? s.length : e + 2;
      for (; i < stop; i++) out += s[i] === "\n" ? "\n" : " "; i--; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      for (; i < s.length; i++) {
        if (s[i] === "\\") { out += "  "; i++; continue; }
        if (s[i] === c) { out += c; break; }
        out += s[i] === "\n" ? "\n" : " ";
      }
      continue;
    }
    out += c;
  }
  return out;
};

// ── every verify-* file is classified ────────────────────────────────────────────────────────
// A guard nobody can run is not a guard. Anything not wired to an npm script must be declared
// here WITH A REASON, so a new one cannot drift into the directory unnoticed.
const DECLARED: Record<string, string> = {
  "verify-api": "dev smoke script, not a guard — posts a MOCK request at /api/chat and logs; catches and continues",
  "verify-imports": "dev smoke script, not a guard — import-resolution check, logs failures and exits 0",
  "verify-db": "dev smoke script, not a guard — one-off check that the conversations table exists",
};

console.log("\nTHE GUARDS THEMSELVES\n");

const files = readdirSync("scripts").filter((f) => /^verify-.*\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, "")).sort();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const wired = new Map<string, string>();
for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
  const m = cmd.match(/scripts\/(verify-[a-z0-9-]+)\.ts/);
  if (m) wired.set(m[1], name);
}

console.log("every guard is reachable:");
const orphans = files.filter((f) => !wired.has(f) && !(f in DECLARED));
if (orphans.length) for (const o of orphans) fail(`scripts/${o}.ts has NO npm script and is not declared — nothing can run it`);
else ok(`all ${files.length} verify-* files are wired to npm or declared manual`);
for (const d of Object.keys(DECLARED)) if (!files.includes(d)) fail(`DECLARED lists ${d}, which no longer exists — stale declaration`);

// ── a guard must be able to fail the build ───────────────────────────────────────────────────
console.log("\nevery guard exits non-zero when it fails:");
let softExit = 0;
for (const f of files) {
  if (f in DECLARED) continue;
  const src = readFileSync(`scripts/${f}.ts`, "utf8");
  const exits = /process\.exit\(\s*(?!0\s*\))/.test(src) || /process\.exitCode\s*=/.test(src);
  if (!exits) { fail(`scripts/${f}.ts never exits non-zero — it can print FAIL and still let the commit through`); softExit++; }
}
if (!softExit) ok("every wired guard has a failing exit path");

// ── the helper's own argument order ──────────────────────────────────────────────────────────
// `const chk = (c: boolean, m: string)` called as chk("message", cond) passes a non-empty string
// as the condition. It is always truthy. Four checks printed "ok true" this way today.
console.log("\nno assertion helper is called with its arguments reversed:");
let reversed = 0;
for (const f of files) {
  const raw = readFileSync(`scripts/${f}.ts`, "utf8");
  const src = stripNonCode(raw);
  const defs = [...src.matchAll(/(?:const|function)\s+(chk|ck|check|assert|expect|t)\s*=?\s*(?:\()([^)]*)\)/g)];
  for (const d of defs) {
    const [, helper, params] = d;
    const first = (params.split(",")[0] || "").trim();
    if (!first) continue;
    const msgFirst = /:\s*string/.test(first) || /^(m|msg|message|label|name|what|title)\b/.test(first);
    const condFirst = /:\s*(boolean|unknown|any)/.test(first) || /^(c|cond|ok|pass|got|actual)\b/.test(first);
    if (!msgFirst && !condFirst) continue;
    const defEnd = d.index! + d[0].length;
    const calls = [...src.matchAll(new RegExp(`(?<![\\w.])${helper}\\(\\s*(.)`, "g"))];
    for (const c of calls) {
      if (c.index! >= d.index! && c.index! < defEnd) continue; // the definition is not a call site
      // The condition is blanked to spaces if it was a string literal, so read the RAW char.
      const startsWithString = [ '"', "'", "`" ].includes(raw[c.index! + c[0].length - 1]);
      const line = src.slice(0, c.index!).split("\n").length;
      if (condFirst && startsWithString) {
        fail(`scripts/${f}.ts:${line} — ${helper}(condition, message) called message-first; a non-empty string is always truthy`);
        reversed++;
      } else if (msgFirst && !startsWithString) {
        fail(`scripts/${f}.ts:${line} — ${helper}(message, …) called without a message first; the condition is in the message slot`);
        reversed++;
      }
    }
  }
}
if (!reversed) ok("every helper is called in the order its own signature declares");

// ── a source assertion must land on the code, not its scaffolding ────────────────────────────
// Most guards read a file into a variable and assert regexes against it. An `import` line, a
// useEffect dependency array, and a type declaration all satisfy a bare-identifier regex — so
// the guard stays green after the real call site is deleted. Both happened today.
console.log("\nno source assertion matches only an import line or a dependency array:");
const RX_BIND = /const\s+(\w+)\s*(?::\s*\w+\s*)?=\s*(?:code|src|read|readFile)?\(?\s*(?:readFileSync\s*\()?\s*["'`]([^"'`]+\.(?:ts|tsx|js|jsx|sql|json|sh))["'`]/g;
const RX_TEST = /\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/([gimsuy]*)\s*\.test\(\s*(\w+)\s*\)/g;
const isImport = (l: string) => /^\s*(?:import|export)\s+.*\bfrom\b/.test(l) || /^\s*import\s+["'`]/.test(l);
const isDepArray = (l: string) => /\}\s*,\s*\[[^\]]*\]\s*\)\s*;?\s*$/.test(l) || /^\s*\[[^\]]*\]\s*\)\s*;?\s*$/.test(l);

let vacuous = 0, examined = 0;
for (const f of files) {
  if (f in DECLARED) continue;
  const src = readFileSync(`scripts/${f}.ts`, "utf8");
  const binds = new Map<string, string>();
  for (const b of src.matchAll(RX_BIND)) if (existsSync(b[2])) binds.set(b[1], b[2]);
  if (!binds.size) continue;

  for (const t of src.matchAll(RX_TEST)) {
    const [, pattern, flags, varName] = t;
    const target = binds.get(varName);
    if (!target) continue;
    const line = src.slice(0, t.index!).split("\n").length;
    const where = `scripts/${f}.ts:${line}`;

    let re: RegExp;
    try { re = new RegExp(pattern, flags.replace(/[gy]/g, "")); } catch { continue; }
    examined++;

    if (re.test("")) { fail(`${where} — /${pattern}/ matches the EMPTY STRING; it can never fail`); vacuous++; continue; }

    const lines = readFileSync(target, "utf8").split("\n");
    const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => re.test(l));
    if (!hits.length) continue; // the guard is simply red; that is its job, not this file's problem
    // A pattern that spells out `]` `)` is DELIBERATELY asserting on a dependency array — e.g.
    // proving a persist effect re-fires when a value changes. That is a real assertion about
    // real code, not scaffolding. The vacuous shape is a bare identifier that HAPPENS to land
    // in the array; this one could not match anywhere else.
    const targetsArray = /\\\]/.test(pattern);
    const real = hits.filter(({ l }) => !isImport(l) && (targetsArray || !isDepArray(l)));
    if (!real.length) {
      const kind = hits.every(({ l }) => isImport(l)) ? "an import line" : "a dependency array";
      fail(`${where} — /${pattern}/ matches ONLY ${kind} in ${target}; delete the real call site and this still passes`);
      vacuous++;
    }
  }
}
if (!vacuous) ok(`all ${examined} source assertions land on real code, not on imports or dependency arrays`);

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). An assertion that cannot fail is worse than no assertion: it reports safety that is not there.\n`);
  process.exit(1);
}
console.log(`PASS — ${files.length} guards, all reachable, all able to fail the build, all asserting on real code.`);
console.log("       This file cannot prove any of them was ever MADE to fail. Break it, watch it go red, restore.\n");
