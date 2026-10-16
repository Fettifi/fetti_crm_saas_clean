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
// THE LIST WAS THE HOLE, TWICE OVER — 2026-10-15.
//
// `app_settings` was not in PROTECTED below, and it is the single most sensitive table in the
// project: it is the runtime credential store. Measured with the service role on 2026-10-15,
// 1,501 rows, and these key names are among them — META_APP_SECRET, MS_GRAPH_CLIENT_SECRET,
// ANTHROPIC_API_KEY, CARTESIA_API_KEY, GEMINI_API_KEY, TIKTOK_CLIENT_SECRET,
// TIKTOK_REFRESH_TOKEN, META_ACCESS_TOKEN, VOICE_INGEST_TOKEN, PRICING_FEED_TOKEN,
// EMAIL_INBOUND_SECRET, OUTLOOK_ADDIN_KEY. One permissive policy on it hands a browser the
// mailbox, the ad accounts and the model keys at once. `rate_limits` joins it: its primary key is
// the throttle key, and the throttle keys in production are literally `apply:<borrower IP>` and
// `otp-send:<borrower email>` (read 2026-10-15), so the table is a log of who applied from where.
//
// MEASURED AGAINST LIVE BEFORE ANY CHANGE, with the TRUE row count beside the anon read, because
// a zero-row anon read on an empty table proves nothing [[a-private-company-had-a-public-repo]]:
//
//     table            service-role TRUE rows    anon rows
//     app_settings     1501                      0
//     rate_limits      3279                      0
//     activity_log     26370                     0
//     loan_documents   809                       0
//     leads            216                       0
//     messages         170                       0
//     loan_files       43                        0
//     conversations    13                        0
//     rupee_memory     1                         0
//
// So production is NOT leaking: 9 of the 12 listed tables exist here, every one of them holds
// rows, and anon reads nothing from any of them. The defect was the guard's blind spot, not the
// database — exactly the shape of both previous lockdowns.
//
// AND THE LIVE CHECK COULD NOT RUN AT ALL. It read process.env only, which nothing in this repo
// populates: `npm run verify:rls -- --live` printed "--live needs NEXT_PUBLIC_SUPABASE_URL …" and
// exited 2, every time, since the day it was written. The one check that can see a dashboard
// toggle nobody commits was dormant. It now reads .env.local the way verify-storage-private.ts
// does, and it asks the service role for the TRUE count so a zero-row anon read on an EMPTY table
// is reported as proving nothing instead of passing. [[a-clamp-erases-the-error-it-should-raise]]
//
//   npm run verify:rls            # static: no permissive anon policy survives the migrations
//   npm run verify:rls-live       # also proves the LIVE anon key reads zero rows (~3s, 2 fetches/table)
//
// Exit 0 = locked down. Exit 1 = a hole. Exit 2 = could not check (never "clean").
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIG = "supabase/migrations";
// Tables that hold borrower or business data, machine credentials, or a record of who contacted
// us. storage.objects policies are deliberately out of scope here — the bucket has its own model
// and its own migration (20261016030000_storage_bucket_lockdown.sql).
const PROTECTED = ["leads", "applications", "conversations", "messages", "rupee_memory",
                   "activity_log", "loan_documents", "loan_files", "radar_parcels",
                   "radar_events", "radar_lists", "radar_contacts",
                   // the credential store and the throttle ledger — see the note above
                   "app_settings", "rate_limits"];

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
// PARSED. Measured 2026-10-15: 20 creates and 17 drops across 13 migrations, 0 surviving.
// (It read 19/15 across 11 when written; the storage-bucket and rate-limiter migrations followed.
// The figures in a comment are a reading, not a constant — the assertion is `parsedCreates > 0`.)
ck(`the migration replay actually parsed policies (${parsedCreates} create, ${parsedDrops} drop) — not a vacuous pass`,
   parsedCreates > 0,
   parsedCreates === 0 ? "zero `create policy` statements parsed — the regex is broken, not the schema" : "");

// --- live: the anon key must read zero rows ---------------------------------------------------
// ASYNC IIFE, NOT TOP-LEVEL AWAIT. tsx compiles this repo's scripts to CJS, where top-level await
// is a hard transform error — the script does not run at all, which a hook or CI reads as a
// failure with nothing useful in it. Every other verify:* script here is sync for the same reason.
// .env.local, not process.env. Next.js loads .env.local for the app; a bare `npx tsx` does not,
// and nothing in package.json or the hook exports these. Reading the file is what makes --live a
// check that can actually run — see the note at the top of this file.
function envLocal(k: string): string {
  try {
    const f = readFileSync(".env.local", "utf8");
    const l = f.split("\n").find((x) => x.startsWith(k + "="));
    return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const env = (k: string) => process.env[k] || envLocal(k);

async function main() {
if (process.argv.includes("--live")) {
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  // The service role is not optional here. An anon read of ZERO rows is the same answer whether
  // RLS is doing its job or the table is simply empty, so the only way this check means anything
  // is to read the TRUE count beside it. The repo has been burned by that exact equivalence.
  const srv = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !srv) {
    console.error("\n  --live needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and" +
                  "\n  SUPABASE_SERVICE_ROLE_KEY, in the environment or in .env.local.");
    process.exit(2);
  }
  const head = async (t: string, key: string) => {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
    });
    const total = Number((r.headers.get("content-range") || "").split("/")[1]);
    return { status: r.status, ok: r.ok, total: Number.isFinite(total) ? total : null, r };
  };
  const readable: string[] = [];   // anon got rows back — a live hole
  const proved: string[] = [];     // anon got nothing AND the table demonstrably holds rows
  const hollow: string[] = [];     // anon got nothing but the table is empty — proves nothing
  for (const t of PROTECTED) {
    const s = await head(t, srv);
    if (s.status === 404) continue;              // table does not exist in this project
    const a = await head(t, anon);
    if (a.status === 404) continue;
    if (a.ok) {
      const rows = await (await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      })).json();
      if (Array.isArray(rows) && rows.length) { readable.push(t); continue; }
    }
    // 401/403, or 200 with an empty body: anon reached nothing. Whether that is RLS or an empty
    // table is decided by the service-role count, NOT by the anon answer.
    if (s.total && s.total > 0) proved.push(`${t} (${s.total} rows)`); else hollow.push(t);
  }
  if (!proved.length && !readable.length) {
    console.error("\n  --live reached no table that holds a single row — a zero-row anon read on an" +
                  "\n  empty table is not evidence of anything. Refusing to report this as locked down." +
                  (hollow.length ? `\n  empty or unreadable: ${hollow.join(", ")}` : ""));
    process.exit(2);
  }
  ck(`the live anon key reads zero rows from ${proved.length} protected table(s) that PROVABLY hold rows`,
     readable.length === 0, readable.length ? `ANON CAN READ: ${readable.join(", ")}` : proved.join(", "));
  if (hollow.length) console.log(`       (empty here, so they prove nothing either way: ${hollow.join(", ")})`);
}

console.log(fail
  ? `\n❌ ${fail} check(s) failed — the anon key is in every browser; treat this as live exposure\n`
  : `\n✅ ALL PASS — no permissive anon policy in the repo${process.argv.includes("--live") ? ", and none in production" : " (run with --live to prove production too)"}\n`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(`\n  could not complete: ${e?.message || e}`); process.exit(2); });
