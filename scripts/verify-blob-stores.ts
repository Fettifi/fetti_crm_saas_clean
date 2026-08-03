// BLOB STORES MUST NOT ERASE ON A FAILED READ.
//
// Ramon, 2026-08-02, round 3: "fix the remaining 120."
//
// Comparisons and scenarios each live in ONE JSON blob in app_settings, and every write is a
// read-modify-write. Both readers returned [] for a FAILED read and for "none exist" — the same
// value — so a transient database error made the next save write back an array containing only
// the new record, silently deleting every other comparison or scenario in the system. Nothing
// errored; the LO saw "Saved."
//
// This asserts the CONTRACT on the shipping modules: a failed or corrupt read throws, so the
// write cannot run.
//
//   npx tsx scripts/verify-blob-stores.ts
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

console.log(`\nBLOB STORES — a failed read must not become an empty list\n`);

for (const [name, file] of [["comparisons", "lib/compare.ts"], ["scenarios", "lib/scenarioStore.ts"]] as [string, string][]) {
  const src = readFileSync(file, "utf8");
  const reader = src.slice(src.indexOf("async function read"), src.indexOf("async function write"));
  chk(/if \(error\) throw/.test(reader), `${name}: a Supabase read error THROWS rather than returning []`);
  chk(/not valid JSON[\s\S]*?throw|throw[\s\S]{0,200}not valid JSON/.test(reader), `${name}: unparseable stored JSON throws rather than being overwritten`);
  chk(/is not an array[\s\S]{0,120}|throw new Error\([^)]*not an array/.test(reader), `${name}: a non-array blob throws rather than being treated as empty`);
  chk(!/catch\s*\{\s*return \[\]/.test(reader), `${name}: no bare "catch { return [] }" remains — that is the erasing shape`);
  const writer = src.slice(src.indexOf("async function write"));
  chk(/const \{ error \}[\s\S]{0,400}?if \(error\) throw/.test(writer), `${name}: a failed upsert THROWS instead of reporting success`);
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A store that returns [] on a read failure will erase the file the next time anyone saves.\n`); process.exit(1); }
console.log(`PASS — both blob stores refuse to write when they could not read.\n`);
