// THE ANON KEY SHIPS TO EVERY BROWSER. NO TABLE MAY BE READABLE WITH IT.
//
// 20260713153000_portal_rls_lockdown.sql exists because permissive `using (true)` policies on
// `leads` and `applications` let anyone holding the public anon key read and modify borrower PII.
// That hole was closed in the dashboard, was never in version control, and the migration was
// written so a `supabase db reset` could not silently re-open it.
//
// It covered two tables. On 2026-10-11 three more were still permissive IN THE REPO —
// `conversations`, `messages`, `rupee_memory` — while production had been hardened out-of-band
// again. Nothing was broken, so nothing prompted a fix, and the damage was aimed squarely at
// whoever next rebuilt from migrations. A one-off lockdown is not a property of the system.
//
//   npm run verify:rls            # static: no permissive anon policy survives the migrations
//   npm run verify:rls -- --live  # also proves the LIVE anon key reads zero rows
//
// Exit 0 = locked down. Exit 1 = a hole. Exit 2 = could not check (never "clean").
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIG = "supabase/migrations";
// Tables that hold borrower or business data. storage.objects policies are deliberately out of
// scope here — the bucket has its own model and its own migration.
const PROTECTED = ["leads", "applications", "conversations", "messages", "rupee_memory",
                   "activity_log", "loan_documents", "loan_files", "radar_parcels",
                   "radar_events", "radar_lists", "radar_contacts"];

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`); };

console.log("\nRLS LOCKDOWN — the public anon key must reach nothing\n");

// --- static: replay the migrations in order and see what policies SURVIVE -------------------
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
if (files.length < 5) {
  console.error(`only ${files.length} migration(s) found in ${MIG} — this check would be vacuous.`);
  process.exit(2);
}
// key = `${table}::${policy}` -> permissive?
const live = new Map<string, { table: string; policy: string; permissive: boolean; from: string }>();
let parsedCreates = 0, parsedDrops = 0;
for (const f of files) {
  const sql = readFileSync(join(MIG, f), "utf8");
  // create policy "NAME" on TABLE for X using (...) with check (...)
  for (const m of sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+([A-Za-z0-9_.]+)([\s\S]*?);/gi)) {
    const [, policy, tableRaw, tail] = m;
    const table = tableRaw.replace(/^public\./, "");
    const permissive = /using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)/i.test(tail);
    parsedCreates++;
    live.set(`${table}::${policy}`, { table, policy, permissive, from: f });
  }
  for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+([A-Za-z0-9_.]+)/gi)) {
    const [, policy, tableRaw] = m;
    parsedDrops++;
    live.delete(`${tableRaw.replace(/^public\./, "")}::${policy}`);
  }
}
const holes = [...live.values()].filter((p) => p.permissive && PROTECTED.includes(p.table));
ck(`no permissive anon policy survives the migrations (${files.length} replayed, ${live.size} policies live)`,
   holes.length === 0,
   holes.map((h) => `"${h.policy}" on ${h.table} — created in ${h.from}, never dropped`).join("\n       "));

// THE GUARD MUST BE ABLE TO SEE A HOLE. If the replay ever stops finding ANY policy, this check
// would pass over nothing — the vacuous shape. Assert the parser actually parsed.
// ANTI-VACUOUS, AND I GOT IT WRONG THE FIRST TIME. The check above is satisfied when NOTHING
// permissive survives — and "nothing survives" is also what a broken regex produces. So it needs a
// companion. My first version asserted `live.size > 0`, i.e. that some policy SURVIVES, which is
// the opposite of the goal: a fully locked-down repo legitimately ends with zero surviving
// policies, and the guard failed on a correct schema. The thing that must be non-zero is what was
// PARSED. Measured here: 19 creates and 15 drops across 11 migrations, 0 surviving.
ck(`the migration replay actually parsed policies (${parsedCreates} create, ${parsedDrops} drop) — not a vacuous pass`,
   parsedCreates > 0,
   parsedCreates === 0 ? "zero `create policy` statements parsed — the regex is broken, not the schema" : "");

// --- live: the anon key must read zero rows ---------------------------------------------------
// ASYNC IIFE, NOT TOP-LEVEL AWAIT. tsx compiles this repo's scripts to CJS, where top-level await
// is a hard transform error — the script does not run at all, which a hook or CI reads as a
// failure with nothing useful in it. Every other verify:* script here is sync for the same reason.
async function main() {
if (process.argv.includes("--live")) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("\n  --live needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
    process.exit(2);
  }
  const readable: string[] = [];
  let checked = 0;
  for (const t of PROTECTED) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    if (r.status === 404) continue;              // table does not exist in this project
    if (!r.ok) { checked++; continue; }          // 401/403 is the posture we want
    checked++;
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) readable.push(t);
  }
  // Zero tables checked would make "nothing readable" meaningless.
  if (!checked) { console.error("\n  --live reached no tables at all — refusing to report that as locked down."); process.exit(2); }
  ck(`the live anon key reads zero rows from all ${checked} protected table(s) that exist`,
     readable.length === 0, readable.length ? `ANON CAN READ: ${readable.join(", ")}` : "");
}

console.log(fail
  ? `\n❌ ${fail} check(s) failed — the anon key is in every browser; treat this as live exposure\n`
  : `\n✅ ALL PASS — no permissive anon policy in the repo${process.argv.includes("--live") ? ", and none in production" : " (run with --live to prove production too)"}\n`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(`\n  could not complete: ${e?.message || e}`); process.exit(2); });
