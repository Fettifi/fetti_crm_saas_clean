#!/usr/bin/env node
// A COMMIT MUST NOT DEPEND ON A FILE THE COMMIT DOES NOT CONTAIN.
//
// 2026-10-04. The working tree held nine files git had never been told about, and two of them were
// load-bearing: `lib/vaPropertyTax.ts`, imported by `lib/pricer.ts` and
// `app/api/pricer/closing-costs/route.ts`, and `supabase/migrations/20260927210000_data_api_grants.sql`.
// Checked properly, `main` was NOT broken — the committed `lib/pricer.ts` does not import it yet, so
// the committed state is self-consistent. That is precisely what makes it dangerous: nothing is red,
// and the next commit that stages `lib/pricer.ts` without staging `lib/vaPropertyTax.ts` ships a tree
// whose own imports do not resolve. Vercel builds from the commit, not from this Mac.
//
// The pricer is not a cosmetic surface: it owns PITIA, mortgage insurance and the disabled-veteran
// property tax exemption — the hook's own words for that one are "silent money" — and the figure it
// prints goes to a borrower. A build that fails is the GOOD outcome here; the bad one is a module
// resolving to something stale.
//
// WHY A GUARD AND NOT A HABIT: `git status` already showed those files. It showed them as nine
// ordinary `??` lines among eighteen modified ones, which is to say it did not show them at all —
// the first read of it in this session truncated at twenty lines and missed seven of the nine.
// "Remember to check untracked files" is the kind of rule that works until the day it matters.
// [[an-untracked-file-makes-the-tree-lie]] [[lessons-must-execute]] [[write≠run]]
//
// WHAT IT DOES NOT DO: it says nothing about files that are merely untracked. Scratch scripts and
// one-off backfills are allowed to sit outside git forever — that is a working directory, not a
// defect. It fires only when something being COMMITTED needs something that is not.
//
//   node scripts/verify-import-integrity.mjs            # checks the staged commit
//   node scripts/verify-import-integrity.mjs --worktree # checks every tracked file as it stands
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WORKTREE = process.argv.includes("--worktree");
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const ROOT = git("rev-parse", "--show-toplevel").trim();
process.chdir(ROOT);

const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const tracked = new Set(lines(git("ls-files")));
const staged = new Set(lines(git("diff", "--cached", "--name-only", "--diff-filter=ACMR")));

// The set under test, and the set that will EXIST once this commit lands.
const subject = WORKTREE ? [...tracked] : [...staged];
const willExist = WORKTREE ? tracked : new Set([...tracked, ...staged]);

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json",
              "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

// Resolve a specifier the way the bundler will, and report the candidate paths tried so a failure
// is debuggable rather than just red.
function resolve(spec, fromFile) {
  const base = spec.startsWith("@/") ? spec.slice(2)
    : path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, fromFile)), spec));
  const tried = EXTS.map((e) => base + e);
  return { hit: tried.find((p) => willExist.has(p)), tried, base };
}

// Strip comments and strings-that-are-not-specifiers cheaply. A commented-out import that names a
// deleted file must not fail the commit — the guard that cries wolf is the guard that gets bypassed
// with --no-verify, and then it protects nothing. [[a-redaction-guard-that-blocks-real-work]]
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SPEC_RE = /(?:import|export)[\s\S]{0,400}?from\s*["'](\.{1,2}\/[^"']+|@\/[^"']+)["']|(?:import|require)\s*\(\s*["'](\.{1,2}\/[^"']+|@\/[^"']+)["']\s*\)|import\s+["'](\.{1,2}\/[^"']+|@\/[^"']+)["']/g;

const problems = [];

// ---------------------------------------------------------------------------------------------
// THE FILE EXISTING IN GIT IS NOT THE SYMBOL EXISTING IN GIT.
//
// 2026-10-08, and it cost thirteen days of production. `scripts/verify-comms-runway.ts` was
// committed importing { balanceVerdict, Burn } from ../lib/commsHealth. The lib was tracked, so
// the check above was green — but the COMMITTED lib/commsHealth.ts had no such export; it existed
// only in the working tree, at line 72. Every local check passed because every local check reads
// the disk. Vercel reads the commit, and failed four production builds with:
//
//     Module '"../lib/commsHealth"' has no exported member 'balanceVerdict'
//
// Nothing surfaced it. The last Ready production deployment was 2026-09-25; the continuity fix,
// Penny's errand feature, the pricer VA prompt and the DV engine all sat in git unserved while
// each push reported success. A failed build only emails; nothing in the repo asks "did the
// deploy land?"
//
// So: read the TARGET'S CONTENT FROM GIT — the index for a staged file, HEAD otherwise — and
// confirm it actually exports every name being imported.
//
// Deliberately conservative. It skips anything it cannot parse confidently (a target with
// `export *`, a namespace or default import, a .json or .d.ts target), because a false positive
// here blocks real commits and gets the whole guard bypassed with --no-verify.
// [[a-redaction-guard-that-blocks-real-work]] [[things-that-look-like-they-work]]
const gitShow = (p) => {
  for (const ref of (staged.has(p) && !WORKTREE ? [`:${p}`, `HEAD:${p}`] : [`HEAD:${p}`, `:${p}`])) {
    try { return git("show", ref); } catch { /* try the next ref */ }
  }
  return null;
};

function exportsOf(src) {
  // `export *` re-exports an unknown set — refuse to judge rather than guess.
  if (/^\s*export\s+\*/m.test(src)) return null;
  const names = new Set();
  for (const m of src.matchAll(/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm))
    names.add(m[1]);
  // export { a, b as c }  /  export type { T }  /  export { x, type T } from "./y"
  // The inline `type` modifier must be STRIPPED PER SPECIFIER, not only after `export`. Leaving it
  // on recorded the export as the literal name "type Continuity", so lib/heartbeat.ts line 10 —
  // `export { CRON_EXPECTED, computeContinuity, classifyContinuity, type Continuity }` — read as
  // not exporting Continuity, and the guard reported a breakage in committed, working code.
  for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm))
    for (const part of m[1].split(",")) {
      const n = part.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n);
    }
  if (/^\s*export\s+default\b/m.test(src)) names.add("default");
  return names;
}

// The target's export set, read from GIT'S content and cached per path.
//
// CACHED BECAUSE THE FIRST VERSION TOOK 21 SECONDS. It called `git show` once per import EDGE —
// thousands of subprocess spawns — and a pre-commit check that slow is one that gets skipped with
// --no-verify, at which point it protects nothing. For a file that is not dirty, the disk content
// IS the committed content, so no git process is needed at all.
//
// Returns: a Set of names, null for "cannot judge" (`export *`), undefined for "unreadable".
const exportsCache = new Map();
function exportsOfPath(p) {
  if (exportsCache.has(p)) return exportsCache.get(p);
  const src = dirty.has(p)
    ? gitShow(p)                                         // modified/staged — only git has the truth
    : (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : gitShow(p));
  const v = src == null ? undefined : exportsOf(src);
  exportsCache.set(p, v);
  return v;
}

function checkNamedExports(fromFile, spec, targetPath, importStmt) {
  if (!CODE.test(targetPath) || /\.d\.ts$/.test(targetPath)) return;
  // TRIM TO THE STATEMENT THAT ACTUALLY NAMES THIS SPECIFIER. SPEC_RE is lazy over up to 400
  // characters, so its match can begin at an EARLIER import and swallow whole statements:
  //     import { readFileSync } from "fs";
  //     import { isIndexable } from "../lib/seoIndexable";
  // matches as one blob, and reading the FIRST brace group blames lib/seoIndexable for not
  // exporting readFileSync. The first version of this check did exactly that and produced four
  // confident wrong findings — caught only by running --worktree over the whole repo before
  // trusting it. Start at the last import/export keyword in the match.
  // [[guard-matched-its-own-comment]] [[a-red-guard-is-a-hypothesis]]
  const k = Math.max(importStmt.lastIndexOf("import"), importStmt.lastIndexOf("export"));
  const stmt = k >= 0 ? importStmt.slice(k) : importStmt;

  // Only `import { … } from` / `export { … } from` carry named bindings we can verify.
  const braces = /^(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from/s.exec(stmt);
  if (!braces) return;                                   // default / namespace / side-effect import
  const wanted = braces[1].split(",")
    .map((s) => s.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0].trim())
    .filter((s) => s && /^[A-Za-z_$][\w$]*$/.test(s));
  if (!wanted.length) return;

  const have = exportsOfPath(targetPath);
  if (have === undefined) return;                        // unreadable from git — the check above owns that
  if (have === null) return;                             // `export *` — cannot judge
  const missing = wanted.filter((w) => !have.has(w));
  if (!missing.length) return;

  const where = staged.has(targetPath) && !WORKTREE ? "the staged version" : "the COMMITTED version";
  const onDisk = fs.existsSync(targetPath) ? exportsOf(fs.readFileSync(targetPath, "utf8")) : null;
  const localOnly = onDisk ? missing.filter((w) => onDisk.has(w)) : [];
  problems.push({
    f: fromFile,
    spec: `${spec} → ${missing.map((s) => `{ ${s} }`).join(", ")}`,
    why: localOnly.length
      ? `${where} of ${targetPath} does NOT export ${localOnly.join(", ")} — it exists ONLY IN YOUR WORKING TREE. ` +
        (WORKTREE
          ? `Nothing is red today because HEAD is self-consistent; the moment this importer is ` +
            `committed without ${targetPath}, the production build dies and every local check still passes.`
          : `tsc and npm run build pass here and the production build will fail.`)
      : `${where} of ${targetPath} does not export ${missing.join(", ")}`,
    onDisk: localOnly.length ? targetPath : null,
  });
}

for (const f of subject) {
  if (!CODE.test(f) || !fs.existsSync(f)) continue;
  // DECLARATION FILES DESCRIBE THE BUILD, NOT THE SOURCE TREE. `next-env.d.ts` is generated by
  // Next and legitimately references `./.next/types/routes.d.ts`, which is build output and
  // correctly gitignored. Flagging it is a false positive, and a guard with a standing false
  // positive teaches people to read past it. [[a-redaction-guard-that-blocks-real-work]]
  if (/\.d\.ts$/.test(f)) continue;
  const raw = fs.readFileSync(f, "utf8");
  const src = strip(raw);
  // Line index, so a match can be located — and so an import that only exists INSIDE A STRING can
  // be excluded. `scripts/verify-income-engine-diff.ts` builds a throwaway project to prove that
  // `@/` resolution works, and writes `import { CANARY } from "@/lib/income/__canary"` as a
  // TEMPLATE LITERAL for that scratch tree. It is not this repo's dependency, and the first
  // version of this guard reported it as a missing module — a confident wrong finding about a file
  // whose whole purpose is testing imports. Any match on a line carrying a backtick is code that
  // GENERATES an import, not code that has one. [[a-red-guard-is-a-hypothesis]]
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  const lineOf = (idx) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  const srcLines = src.split("\n");
  const seen = new Set();
  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || seen.has(spec)) continue;
    const ln = lineOf(m.index);
    if (srcLines[ln]?.includes("`")) continue;          // an import being WRITTEN, not performed
    seen.add(spec);
    const { hit, base } = resolve(spec, f);
    if (hit) continue;
    // On disk but not in git is the whole point of this check; genuinely absent is a different
    // (and louder) bug, so say which it is.
    const onDisk = EXTS.map((e) => base + e).find((p) => fs.existsSync(p));
    problems.push({ f, spec, why: onDisk ? `EXISTS ON DISK BUT NOT IN GIT: ${onDisk}` : "does not exist at all", onDisk });
  }
}

// ---------------------------------------------------------------------------------------------
// SECOND PASS — THE SYMBOL CHECK, OVER THE COMMIT AS IT WILL ACTUALLY EXIST.
//
// It cannot reuse the loop above, and finding out why exposed a second hole. That loop's subject
// is the STAGED files, so it reads the imports OF what you are committing. The 2026-10-08 break
// was the other shape: `scripts/verify-comms-runway.ts` was staged and `lib/commsHealth.ts` was
// not, so the importer WAS in subject — fine. But the mirror case is invisible to it: stage a lib
// that REMOVES an export a long-committed file depends on, and nothing looks at that file at all.
// Both directions break production identically.
//
// So this pass takes every file that will exist and reads it AS IT WILL BE COMMITTED — the index
// for a staged file, HEAD otherwise — never from disk. Reading from disk is the entire defect
// class: tsc, npm run build and the whole pre-commit suite all passed on content Vercel does not
// have. [[fix-one-branch-check-its-sibling]] [[things-that-look-like-they-work]]
// For an UNMODIFIED tracked file, the disk content IS the committed content — so only dirty files
// need a `git show`. Without this the pass spawns one git process per tracked file (~630) and the
// pre-commit hook gets slow enough that someone starts reaching for --no-verify, which costs more
// than the check saves. [[harden-the-path-that-runs-most]]
const dirty = new Set([
  ...lines(git("diff", "--name-only", "HEAD")),
  ...staged,
  ...lines(git("ls-files", "--others", "--exclude-standard")),
]);
const contentCache = new Map();
const contentOf = (p) => {
  if (contentCache.has(p)) return contentCache.get(p);
  const v = WORKTREE || !dirty.has(p)
    ? (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : gitShow(p))
    : gitShow(p);
  contentCache.set(p, v);
  return v;
};

for (const f of [...willExist]) {
  if (!CODE.test(f) || /\.d\.ts$/.test(f)) continue;
  const raw = contentOf(f);
  if (raw == null) continue;
  const src = strip(raw);
  const srcLines = src.split("\n");
  const starts2 = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts2.push(i + 1);
  const lineOf2 = (idx) => { let lo = 0, hi = starts2.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts2[mid] <= idx) lo = mid; else hi = mid - 1; } return lo; };
  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (srcLines[lineOf2(m.index)]?.includes("`")) continue;
    const { hit } = resolve(spec, f);
    if (hit) checkNamedExports(f, spec, hit, m[0]);
  }
}

// The same failure in package.json: a script entry pointing at a file git will not have. This is how
// `verify:va-property-tax` came to be wired to an untracked guard — a hook branch that cannot run.
// [[guard-in-package-json-only-never-runs]]
if (willExist.has("package.json") && (WORKTREE || staged.has("package.json"))) {
  const sc = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {};
  for (const [name, cmd] of Object.entries(sc)) {
    for (const m of String(cmd).matchAll(/(?:^|[\s"'])((?:scripts|lib|app)\/[\w./[\]-]+\.(?:ts|tsx|mjs|cjs|js))/g)) {
      const p = m[1];
      if (willExist.has(p)) continue;
      problems.push({ f: "package.json", spec: `${name} → ${p}`, why: fs.existsSync(p) ? `EXISTS ON DISK BUT NOT IN GIT: ${p}` : "does not exist at all", onDisk: fs.existsSync(p) ? p : null });
    }
  }
}

const scope = WORKTREE ? `${subject.length} tracked file(s)` : `${staged.size} staged file(s)`;
if (!problems.length) {
  console.log(`  ok    import integrity — ${scope}, every relative/@ import resolves to something git has`);
  process.exit(0);
}

console.error(`\nFAIL — ${problems.length} dependency/dependencies would not exist in the commit:\n`);
for (const p of problems) console.error(`  ${p.f}\n      imports ${p.spec}\n      ${p.why}`);
const fixable = [...new Set(problems.filter((p) => p.onDisk).map((p) => p.onDisk))];
if (fixable.length) {
  console.error(`\nThese are on disk and simply never added. If they belong in the build:\n`);
  console.error(`  git add ${fixable.map((f) => JSON.stringify(f)).join(" ")}\n`);
  console.error(`If one of them is scratch work, move it out of the import graph instead — do not`);
  console.error(`commit a file that reaches for it. \`--no-verify\` would ship a tree that cannot build.\n`);
}
process.exit(1);
