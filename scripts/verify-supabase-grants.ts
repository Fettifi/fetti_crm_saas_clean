/**
 * verify-supabase-grants.ts — every table a migration creates in `public` must also be GRANTed.
 *
 * WHY THIS EXISTS. Supabase notice dated 2026-09-23, found sitting in GoDaddy's mail quarantine four
 * days later and never delivered to the inbox:
 *
 *   "On October 30, Supabase will stop automatically granting Data API access to new tables in the
 *    public schema for existing projects... Migrations count too. From October 30, any migration that
 *    creates a table without the required grants leaves that table unreachable through the Data API.
 *    That includes new projects, preview branches, and a local `supabase db reset`."
 *
 * Existing tables keep their grants, so production is NOT broken today. What breaks is REPRODUCIBILITY:
 * after 2026-10-30 a fresh project, a preview branch, or `supabase db reset` rebuilt from these
 * migrations yields tables the Data API cannot reach, and the failure appears as a runtime
 * "permission denied" far from the migration that caused it. At the time this guard was written, all 9
 * tables created by supabase/migrations/ had ZERO grant statements between them.
 *
 * WHAT THIS GUARD DOES AND DOES NOT CLAIM. It checks one thing: a table created in `public` is named by
 * at least one GRANT in the migration set, for at least one role the app actually uses. It is NOT a
 * security audit — ROW LEVEL SECURITY, not the grant, decides which rows a role may see, and a grant
 * without a policy still returns nothing. So this guard deliberately does not prescribe WHICH roles a
 * table should carry: that is a per-table judgement. It only refuses ZERO.
 */

import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const APP_ROLES = ["anon", "authenticated", "service_role"];

let failures = 0;
let checks = 0;
const fail = (msg: string) => { failures++; console.error(`  ✖ ${msg}`); };
const ok = (msg: string) => { console.log(`  ✓ ${msg}`); };

if (!fs.existsSync(MIGRATIONS)) {
  console.error(`✖ ${MIGRATIONS} does not exist — this guard cannot run, which is NOT a pass.`);
  process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.error("✖ no .sql migrations found — cannot run, which is NOT a pass.");
  process.exit(1);
}

// Strip comments so a CREATE TABLE inside a comment is not counted, and a GRANT inside one does not
// satisfy a requirement. A guard that matches its own commentary has happened here before.
const decomment = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

type Created = { table: string; file: string };
const created: Created[] = [];
const granted = new Map<string, Set<string>>();   // table -> roles

for (const f of files) {
  const sql = decomment(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));

  // CREATE TABLE [IF NOT EXISTS] [public.]name  — skip anything schema-qualified to a non-public schema.
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)/gi)) {
    const raw = m[1].replace(/"/g, "");
    const parts = raw.split(".");
    const schema = parts.length > 1 ? parts[0] : "public";
    const table = parts[parts.length - 1];
    if (schema !== "public") continue;
    created.push({ table, file: f });
  }

  // GRANT <privs> ON [TABLE] [public.]name[, name2] TO role[, role2]
  for (const m of sql.matchAll(/grant\s+[\s\S]*?\s+on\s+(?:table\s+)?([\w.,"\s]+?)\s+to\s+([\w,\s"]+)/gi)) {
    const tables = m[1].split(",").map((t) => t.trim().replace(/"/g, "").split(".").pop()!).filter(Boolean);
    const roles = m[2].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase()).filter(Boolean);
    for (const t of tables) {
      if (!granted.has(t)) granted.set(t, new Set());
      for (const r of roles) granted.get(t)!.add(r);
    }
  }
}

console.log(`\nSUPABASE DATA API GRANTS — ${files.length} migration(s), ${created.length} public table(s) created\n`);

// 1. Every created public table must carry at least one grant to a role the app uses.
const seen = new Set<string>();
for (const c of created) {
  if (seen.has(c.table)) continue;
  seen.add(c.table);
  checks++;
  const roles = granted.get(c.table);
  const appRoles = roles ? [...roles].filter((r) => APP_ROLES.includes(r)) : [];
  if (!appRoles.length) {
    fail(
      `public.${c.table} (created in ${c.file}) has NO GRANT to any of ${APP_ROLES.join("/")}. ` +
      `After 2026-10-30 a rebuild leaves it unreachable through the Data API. Add grants in a migration:\n` +
      `        grant select, insert, update, delete on public.${c.table} to authenticated, service_role;`
    );
  } else {
    ok(`public.${c.table} granted to ${appRoles.sort().join(", ")}`);
  }
}

// 2. A grant naming a table nothing creates is usually a typo or a renamed table — report it, do not
//    fail, because a table may legitimately be created by schema.sql or by the Supabase dashboard.
for (const [t, roles] of granted) {
  if (seen.has(t)) continue;
  const appRoles = [...roles].filter((r) => APP_ROLES.includes(r));
  if (appRoles.length) console.log(`  · note: grant on "${t}" but no CREATE TABLE for it in migrations/ (dashboard- or schema.sql-created?)`);
}

// 3. THE GUARD MUST BE ABLE TO SEE SOMETHING. If the parser matched no CREATE TABLE at all, the syntax
//    drifted and every check above went vacuous — that is a failure, not a pass.
//    [[assertions-inside-a-branch-go-vacuous]]
checks++;
if (!created.length) {
  fail("parsed 0 CREATE TABLE statements across all migrations — the parser has drifted and every " +
       "check above is vacuous. Fix the parser; do not trust a green run.");
} else {
  ok(`parser found ${created.length} CREATE TABLE statement(s) — assertions are not vacuous`);
}

console.log(`\n${failures ? "✖ FAIL" : "✅ PASS"} — ${checks} check(s), ${failures} failure(s)`);
if (failures) {
  console.error(
    `\nThe Oct 30 change does not break tables that already exist in production — it breaks REBUILDS\n` +
    `(new project, preview branch, \`supabase db reset\`) and any NEW table created without grants.\n` +
    `Note: the grant is necessary, not sufficient — RLS still decides which rows a role can read.\n`
  );
}
process.exit(failures ? 1 : 0);
