// EVERY IMPORT MUST RESOLVE TO A FILE GIT ACTUALLY HAS.
//
// 2026-08-04. Three commits of real fixes — the FHA ratios, the settled income on the letter,
// the credit pull that would not persist — sat on main for hours reaching nobody. I told Ramon
// the cause was a Vercel SAML block on the deploy token. That was wrong, and I never checked it.
//
// The real cause: `lib/officerIdentity.ts` existed in my working tree and was never committed.
// Three commits imported it. Locally everything was green — tsc passed, `npm run build` passed,
// every guard passed — because the file was right there on disk. On Vercel, which only has what
// git has, the build died at 26 seconds:
//
//     Module not found: Can't resolve '@/lib/officerIdentity'
//
// Nothing local can see this. tsc reads the disk. The build reads the disk. Only git knows the
// difference between "a file I have" and "a file I shipped", so the check has to ask git.
//
// The gap between what my machine can see and what the build can see is where this hides, and it
// hid for the better part of a day while I reported a cause I had not verified.
//
//   npx tsx scripts/verify-tracked-imports.ts
import { execSync } from "child_process";
import { readFileSync } from "fs";

const tracked = new Set(
  execSync("git ls-files", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\n").filter(Boolean),
);

// Source that Next actually compiles. Scripts are excluded: they run through tsx on a machine
// that has the file, and they never reach a Vercel build.
const sources = [...tracked].filter((f) => /^(app|components|lib|hooks|middleware|proxy)[./]/.test(f) && /\.(ts|tsx)$/.test(f));

const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css",
             "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

const resolves = (base: string) => EXT.some((e) => tracked.has(base + e));

let bad = 0;
const missing: string[] = [];

for (const f of sources) {
  const src = readFileSync(f, "utf8");
  // static imports, re-exports, and dynamic import()
  const specs = [
    ...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s+["']([^"']+)["']/g),
    ...src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);

  for (const spec of new Set(specs)) {
    let base: string | null = null;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith("./") || spec.startsWith("../")) {
      const dir = f.split("/").slice(0, -1);
      const parts = spec.split("/");
      const out = [...dir];
      for (const p of parts) { if (p === ".") continue; else if (p === "..") out.pop(); else out.push(p); }
      base = out.join("/");
    }
    if (!base) continue;                     // a package from node_modules
    if (resolves(base)) continue;
    missing.push(`${f}\n      imports "${spec}" → ${base}.* is NOT tracked by git`);
    bad++;
  }
}

console.log("\nEVERY IMPORT RESOLVES TO A FILE GIT HAS\n");
console.log(`  scanned ${sources.length} tracked source files`);

if (bad) {
  console.log("");
  for (const m of missing) console.log(`  FAIL  ${m}`);
  console.error(`\nFAIL — ${bad} import(s) resolve only on this machine. The build has no such file and will die at "Module not found".`);
  console.error(`Fix: git add the file(s). A local build passing proves nothing about a build that only has what git has.\n`);
  process.exit(1);
}
console.log(`  ok    every @/ and relative import resolves to a committed file\n`);
console.log("PASS — nothing here builds only because of something sitting untracked on this disk.\n");
