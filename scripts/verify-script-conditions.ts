// A SCRIPT THAT IMPORTS `server-only` MUST BE RUN WITH --conditions=react-server.
//
// `import "server-only"` throws the moment it is loaded outside a React Server Component:
//
//     Error: This module cannot be imported from a Client Component module.
//
// Under `npx tsx` that is exactly what happens. `--conditions=react-server` makes the resolver
// pick server-only/empty.js instead, and the script runs.
//
// 2026-09-09: the Fetti scan agent had been dead on arrival and nobody knew. Commit 7dea3f9
// ("E-sign: auto-compress oversized PDFs") added `import "server-only"` to lib/pdfCompress.ts.
// scripts/scan-agent.ts reaches it through lib/scanFile.ts. Both Desktop launchers and both
// npm scripts ran plain `npx tsx`, so double-clicking "Fetti Scanner Agent" opened a window,
// crashed instantly, and the CRM's Scan buttons had nothing on 127.0.0.1 to talk to.
//
// The failure is invisible from the CRM side — the browser just sees a dead port — and the
// launcher window closes on a keypress. Nothing pointed at the cause.
//
// This walks the ACTUAL import graph of every npm script rather than grepping for a list of
// known-bad modules: the next module to gain a `server-only` import will be caught the same day.
//
//   npm run verify:script-conditions
import { readFileSync, existsSync, statSync } from "fs";
import path from "path";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = path.normalize(path.join(path.dirname(from), spec));
  else return null;                        // node_modules — not ours to walk
  for (const e of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (isFile(base + e)) return base + e;
  return null;
}
const IMPORT = /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
const SERVER_ONLY = /^\s*import\s+["']server-only["']/m;

/** The file that pulls in server-only, or null. Returns the culprit so the message can name it. */
function serverOnlyVia(entry: string): string | null {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (!f || seen.has(f) || !isFile(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    if (SERVER_ONLY.test(src)) return f;
    for (const m of src.matchAll(IMPORT)) {
      const r = resolveSpec(m[1] || m[2], f);
      if (r) stack.push(r);
    }
  }
  return null;
}

(async () => {
  console.log("\nSCRIPT RUNTIME CONDITIONS — server-only needs --conditions=react-server\n");

  const scripts: Record<string, string> = JSON.parse(readFileSync("package.json", "utf8")).scripts || {};
  const offenders: string[] = [];
  let reached = 0;

  for (const [name, cmd] of Object.entries(scripts)) {
    const m = String(cmd).match(/scripts\/([\w.\-]+)\.ts/);
    if (!m) continue;
    const entry = `scripts/${m[1]}.ts`;
    if (!isFile(entry)) continue;
    const via = serverOnlyVia(entry);
    if (!via) continue;
    reached++;
    if (!/--conditions=react-server/.test(String(cmd))) offenders.push(`npm run ${name} → ${entry} (server-only via ${via})`);
  }

  console.log(`  ${reached} npm script(s) reach a server-only import`);
  for (const o of offenders) console.log(`     ↳ ${o}`);
  ck("every npm script that reaches server-only passes --conditions=react-server",
     offenders.length === 0, `${offenders.length} would crash on launch`);
  // A guard that finds nothing to check is not passing, it is idle.
  ck("…and the check is not vacuous — at least one script does reach it", reached > 0);

  console.log("\n── the double-clickable launchers on the Desktop ──");
  // These are what Ramon actually uses; a correct package.json does not help if the .command
  // file beside it still runs plain `npx tsx`.
  for (const f of ["/Users/fetti/Desktop/Fetti Scanner Agent.command", "/Users/fetti/Desktop/Fetti Scanner.command"]) {
    if (!existsSync(f)) { console.log(`  (absent: ${path.basename(f)})`); continue; }
    const src = readFileSync(f, "utf8");
    const runs = [...src.matchAll(/npx\s+tsx\s+([^\n]*?)scripts\/([\w.\-]+)\.ts/g)];
    for (const r of runs) {
      const entry = `scripts/${r[2]}.ts`;
      const via = serverOnlyVia(entry);
      if (!via) continue;
      ck(`${path.basename(f)} runs ${entry} with the flag`, /--conditions=react-server/.test(r[1]),
         "double-clicking it opens a window and crashes instantly");
    }
  }

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — nothing launches into an instant server-only crash\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(1); });
