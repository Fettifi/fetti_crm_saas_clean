// THE THROTTLE EVERY PUBLIC ROUTE DEPENDS ON MUST EXIST IN VERSION CONTROL.
//
// 2026-10-15. lib/rateLimit.ts calls the Postgres RPC `rate_limit_hit`. A repo-wide grep for that
// name returned two hits: the call itself and a comment in app/api/sms/inbound/route.ts. The
// function and its rate_limits table existed only inside the production database — so a new
// project, a preview branch or `supabase db reset` came up with no throttle at all, and
// lib/rateLimit.ts is fail-OPEN by design, which means nothing complains.
//
// The cost is not "requests go a bit faster". app/api/sms/inbound/route.ts uses the same RPC as the
// IDEMPOTENCY gate in front of every side effect in that route, and the OTP routes use it
// failClosed, where an absent limiter locks a borrower out of her own document portal.
//
// 20261016050000_rate_limiter.sql captures the table and the function. Its definition was
// RECONSTRUCTED from the call site plus behaviour measured against production, because there is no
// psql, no Supabase CLI and no exec-SQL RPC on this machine to read pg_get_functiondef with. This
// guard is what keeps "reconstructed" from quietly becoming "guessed":
//
//   1. static    — a migration defines the function and the table, with the signature the call site
//                  actually uses and a primary key for the atomic upsert
//   2. offline   — lib/rateLimit.ts is run with the RPC genuinely unreachable, and must still obey
//                  its documented contract (fail open by default, fail CLOSED when asked)
//   3. live      — the measured allow/deny sequence is replayed against the real function, so a
//                  divergence between the migration and production shows up here and nowhere else
//
//   npm run verify:rate-limiter
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

const MIG = "supabase/migrations";
const read = (p: string) => readFileSync(p, "utf8");
const decomment = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`); };

console.log("\nRATE LIMITER — the throttle must exist in version control and behave as documented\n");

// ── 1. STATIC: the call site and the migration must describe the same function ────────────────
// Read the RPC name and the parameter names out of lib/rateLimit.ts rather than hard-coding them,
// so a rename on either side is a mismatch instead of a silent 404 at runtime (PGRST202, which is
// what a wrong parameter name actually produces — measured).
// STRIP TS COMMENTS BEFORE PARSING THE CALL SITE. This matched the raw source, so an ordinary
// `//` comment INSIDE the parameter object — which is exactly where a reader most wants one —
// made the whole .rpc(...) match fail and the guard reported "lost its subject" on a correct
// call site. It fired that way the moment the key was wrapped in rateLimitKey() with a note
// explaining why. decomment() was already applied to the SQL and not to the TypeScript.
const rl = read("lib/rateLimit.ts").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const callM = rl.match(/\.rpc\(\s*"([a-z0-9_]+)"\s*,\s*\{([^}]*)\}/i);
ck("lib/rateLimit.ts still calls a Postgres RPC with a named-parameter object",
   !!callM, callM ? "" : "could not find the .rpc(\"name\", { … }) call — this guard has lost its subject");
const rpcName = callM?.[1] || "";
const callParams = (callM?.[2] || "").split(",").map((s) => s.split(":")[0].trim()).filter(Boolean).sort();

// Every .sql in the migrations directory, decommented, so prose about the function cannot satisfy a
// check about the function. (A guard matching its own commentary has happened in this repo.)
const sqls = readdirSync(MIG).filter((f) => f.endsWith(".sql")).map((f) => ({ f, sql: decomment(read(join(MIG, f))) }));
ck(`the migrations directory is readable (${sqls.length} file(s))`, sqls.length > 0);

const defining = sqls.filter((x) => new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${rpcName}\\s*\\(`, "i").test(x.sql));
ck(`${rpcName || "the RPC"} is DEFINED by a migration, not only by the live database`,
   defining.length > 0,
   defining.length ? defining.map((d) => d.f).join(", ")
                   : `no migration in ${MIG} contains "create function ${rpcName}" — a fresh environment has NO throttle, and lib/rateLimit.ts fails OPEN`);

const defSql = defining.map((d) => d.sql).join("\n");
// The declared parameter names must match the keys the call site sends. PostgREST resolves an RPC
// by parameter NAME; p_limit vs limit is a 404, not a type error.
const sigM = defSql.match(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${rpcName}\\s*\\(([^)]*)\\)`, "i"));
const sigParams = (sigM?.[1] || "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).sort();
ck("the migration declares exactly the parameter names the call site sends",
   sigParams.length > 0 && JSON.stringify(sigParams) === JSON.stringify(callParams),
   `call site sends [${callParams.join(", ")}] · migration declares [${sigParams.join(", ")}]`);
ck("…and returns boolean, which is what lib/rateLimit.ts compares against true",
   /returns\s+boolean/i.test(defSql), "a non-boolean return makes `data === true` false for every caller — a throttle that denies everything");

// The table, and the primary key the atomic upsert depends on. ON CONFLICT (key) is the whole
// reason this is usable as an idempotency gate; without a unique constraint it is a syntax error at
// runtime and, with a SELECT-then-UPDATE instead, a race that lets two deliveries both win.
const tblFile = sqls.find((x) => /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?rate_limits\b/i.test(x.sql));
ck("the rate_limits table is created by a migration too", !!tblFile,
   tblFile ? tblFile.f : "the function has nothing to write to on a rebuild");
const tblSql = tblFile?.sql || "";
ck("rate_limits.key is a PRIMARY KEY (ON CONFLICT (key) is what makes the counter atomic)",
   /key\s+text\s+primary\s+key/i.test(tblSql));
for (const col of ["count", "reset_at"]) {
  ck(`rate_limits.${col} exists — the live table has key, count, reset_at (read 2026-10-15)`,
     new RegExp(`\\b${col}\\b`).test(tblSql));
}
ck("the counter is one atomic statement (insert … on conflict … do update), not select-then-update",
   /insert\s+into\s+(?:public\.)?rate_limits[\s\S]*?on\s+conflict\s*\(\s*key\s*\)\s*do\s+update/i.test(defSql),
   "a SELECT then UPDATE lets two concurrent deliveries of the same MessageSid both come back true");

// A rebuild must not hand the browser key the ability to burn our counters. Measured on production
// 2026-10-15: the anon key CAN call this RPC there today (200 true, row written), which is why the
// migration revokes it. The repo at least must describe the tight shape.
ck("the migration does NOT grant execute on the RPC to anon or authenticated",
   !new RegExp(`grant\\s+execute[^;]*${rpcName}[^;]*to[^;]*\\b(anon|authenticated)\\b`, "i").test(defSql),
   "anyone holding the public key could exhaust otp-send:<a borrower's email> and lock her out of her portal");
ck("…and revokes it from anon explicitly",
   new RegExp(`revoke[^;]*${rpcName}[^;]*from[^;]*\\banon\\b`, "i").test(defSql));

// ── 2. OFFLINE BEHAVIOUR: what a fresh environment actually does ──────────────────────────────
// This is the half of the finding that is not about SQL. Run the REAL module with the Supabase
// environment stripped, so supabaseAdmin falls back to its mock client (which has no .rpc at all)
// and the RPC is genuinely unreachable — the exact condition a fresh environment is in. The
// contract documented in lib/rateLimit.ts must hold, in both directions.
// `tsx -e` compiles to CJS here, where top-level await is a hard transform error, so the probe is
// an async IIFE. (Same reason scripts/verify-rls-lockdown.ts wraps its live check in one.)
const PROBE = `
import { rateLimit } from "@/lib/rateLimit";
(async () => {
  const open = await rateLimit("verify-rate-limiter:unreachable", 1, 60);
  const closed = await rateLimit("verify-rate-limiter:unreachable", 1, 60, { failClosed: true });
  console.log("RESULT " + JSON.stringify({ open, closed }));
})();`;
let offline: { open?: boolean; closed?: boolean } = {};
try {
  const out = execFileSync("npx", ["tsx", "-e", PROBE], {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_URL: "" },
  });
  const m = out.match(/RESULT (\{.*\})/);
  if (m) offline = JSON.parse(m[1]);
} catch (e: any) {
  console.log(`       (offline probe could not run: ${String(e?.message || e).slice(0, 120)})`);
}
ck("with the RPC unreachable, rateLimit() still answers — it does not throw into the route",
   typeof offline.open === "boolean" && typeof offline.closed === "boolean",
   JSON.stringify(offline));
ck("…and the default is fail-OPEN (allowed=true): a limiter hiccup must never block a borrower's submission",
   offline.open === true, `got ${offline.open}`);
ck("…and failClosed:true DENIES (allowed=false): the OTP brute-force throttle must not silently disable itself",
   offline.closed === false, `got ${offline.closed} — the portal OTP routes would lose their throttle entirely`);

// ── 3. LIVE BEHAVIOUR: does production match the definition we just captured? ─────────────────
// The migration's semantics were reconstructed from these exact observations. Replaying them is the
// only thing that can catch the live function having been something else all along.
function envLocal(k: string): string {
  try {
    const l = read(".env.local").split("\n").find((x) => x.startsWith(k + "="));
    return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const env = (k: string) => process.env[k] || envLocal(k);

async function live() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
  const srv = env("SUPABASE_SERVICE_ROLE_KEY");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  if (!url || !srv) {
    console.log("\n  · live replay SKIPPED — no Supabase credentials in .env.local or the environment.");
    console.log("    The static and offline checks above still ran; this one needs the real function.");
    return;
  }
  console.log("\n  the measured sequence, replayed against the live function:");
  const H = { apikey: srv, Authorization: `Bearer ${srv}`, "Content-Type": "application/json" };
  const base = `verify-rate-limiter:${Date.now()}`;
  const hit = async (key: string, limit: number, win: number) => {
    const r = await fetch(`${url}/rest/v1/rpc/${rpcName}`, { method: "POST", headers: H, body: JSON.stringify({ p_key: key, p_limit: limit, p_window: win }) });
    if (!r.ok) return `HTTP ${r.status}`;
    return await r.json();
  };
  try {
    const k1 = `${base}:a`, k2 = `${base}:b`;
    const seq = [await hit(k1, 2, 60), await hit(k1, 2, 60), await hit(k1, 2, 60)];
    ck("p_limit=2 on a fresh key allows exactly two calls then denies (true, true, false)",
       JSON.stringify(seq) === JSON.stringify([true, true, false]), `got ${JSON.stringify(seq)}`);
    ck("an independent key is unaffected by the first key's exhaustion (per-KEY, not global)",
       (await hit(k2, 2, 60)) === true);
    const denied = await hit(k1, 2, 1);          // a shorter window must not re-open a live one
    ck("a later call with a SHORTER p_window cannot re-open a window already in progress",
       denied === false, `got ${JSON.stringify(denied)} — the window must be fixed when it opens`);
    const rowRes = await fetch(`${url}/rest/v1/rate_limits?select=key,count,reset_at&key=eq.${encodeURIComponent(k1)}`, { headers: H });
    const rows = await rowRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    ck("the counter increments on DENIED calls too (4 calls on a limit of 2 leave count = 4)",
       !!row && Number(row.count) === 4, `row = ${JSON.stringify(row)}`);
    ck("the row's reset_at is in the future — the window is real, not a no-op",
       !!row && new Date(row.reset_at).getTime() > Date.now(), row ? `reset_at = ${row.reset_at}` : "");

    // REPORTED, NOT ENFORCED. The anon key can execute this RPC on production right now (measured
    // 2026-10-15: 200 true, row written). The migration revokes it, but a migration file is not the
    // live database, and failing every commit over something only a SQL run can fix is how a guard
    // gets switched off. Turn this into a ck() the day the revoke is applied.
    if (anon) {
      const ar = await fetch(`${url}/rest/v1/rpc/${rpcName}`, {
        method: "POST", headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_key: `${base}:anon`, p_limit: 1, p_window: 60 }),
      });
      if (ar.ok) {
        console.log("  ⚠️  THE PUBLIC ANON KEY CAN STILL EXECUTE THIS RPC ON PRODUCTION (HTTP " + ar.status + ").");
        console.log("      Six requests to otp-send:<a borrower's email> lock her out of her own portal.");
        console.log("      20261016050000_rate_limiter.sql revokes it; until that migration is applied, run:");
        console.log(`        revoke all on function public.${rpcName}(text, integer, integer) from public, anon, authenticated;`);
        console.log(`        grant execute on function public.${rpcName}(text, integer, integer) to service_role;`);
      } else {
        console.log(`  ✅ the public anon key can no longer execute the RPC (HTTP ${ar.status}) — the revoke is live.`);
      }
    }
    // Leave nothing behind. These rows are keyed by timestamp, so a failed cleanup is visible.
    await fetch(`${url}/rest/v1/rate_limits?key=like.${encodeURIComponent(base + "%")}`, { method: "DELETE", headers: H });
    const leftRes = await fetch(`${url}/rest/v1/rate_limits?select=key&key=like.${encodeURIComponent(base + "%")}`, { headers: H });
    const left = await leftRes.json();
    ck("the probe cleaned up after itself", Array.isArray(left) && left.length === 0, JSON.stringify(left));
  } catch (e: any) {
    ck("the live replay completed", false, String(e?.message || e).slice(0, 160));
  }
}

live().then(() => {
  console.log(fail
    ? `\n❌ ${fail} check(s) failed — a fresh environment with no throttle fails OPEN and says nothing\n`
    : "\n✅ ALL PASS — the limiter is in version control, and production behaves the way the migration says\n");
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(`\n  could not complete: ${e?.message || e}`); process.exit(2); });
