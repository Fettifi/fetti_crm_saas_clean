// A GUARD THAT DID NOT REACH THE DATABASE MUST FAIL, NOT PASS.
//
// 2026-08-12/13. Five verify scripts printed "Supabase Admin environment variables missing.
// Using mock client" and THREE of them reported success anyway:
//   • verify:governor  replayed "0 MESSAGES THAT ACTUALLY WENT OUT" and exited 0. The claim
//     that the governor blocks 82% of past sends was, that run, measured over nothing. Its
//     query did not destructure `error`, so a transient `fetch failed` is indistinguishable
//     from "this borrower was never messaged" — and the second is always the quiet answer.
//   • verify:synthetic printed "SKIP live over-match check" — the ONE assertion that catches a
//     synthetic-lead predicate broad enough to swallow a REAL lead (a live lead really is
//     sourced `owner-test`). Skipped for want of a credential, and still "All checks passed."
//   • verify:stale-files crashed instead — the mock builder has no .limit() — which is the only
//     reason anybody noticed the other two.
//
// This is the house pattern: a mechanism that exists and does nothing. The failure mode is
// always the same shape — absence of data reads as absence of a problem. So:
//
//   import "./_env";                    // FIRST, before anything that reads process.env
//   await requireLiveDb("verify:foo");  // then prove the connection is real
//
// and use `rows()` instead of a bare select, so an error can never arrive as an empty list.
import "./_env";
import { supabaseAdmin } from "../lib/supabaseAdminClient";

/**
 * Fail the run unless this process is talking to the real Supabase.
 * Checks the same two variables lib/supabaseAdminClient branches on, then proves the
 * credentials actually work — a present-but-wrong key is still not a live database.
 */
export async function requireLiveDb(who: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      `\n${who}: NO DATABASE. NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, so ` +
      `lib/supabaseAdminClient handed out its MOCK client.\nThis guard checks live records; against a mock ` +
      `it would assert nothing and still exit 0. Refusing to pass.\nFix: make sure the script does ` +
      `\`import "./_env";\` as its FIRST import, and that .env.local is present.`,
    );
    process.exit(1);
  }
  const { error } = await supabaseAdmin.from("loan_files").select("id", { count: "exact", head: true });
  if (error) {
    console.error(`\n${who}: the database is configured but UNREACHABLE — ${error.message}\n` +
      `A guard that cannot read the records it checks has not checked them. Refusing to pass.`);
    process.exit(1);
  }
}

/**
 * Run a PostgREST query and treat an error as fatal instead of as an empty result.
 * `minRows` additionally fails when a query the caller knows must return data comes back empty
 * — the shape that let a replay over 0 rows print a pass.
 */
export async function rows<T = any>(
  who: string,
  q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { minRows?: number } = {},
): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    console.error(`\n${who}: query failed — ${error.message}\nTreating this as "no rows" would be a false pass. Refusing.`);
    process.exit(1);
  }
  const out = data || [];
  if (opts.minRows != null && out.length < opts.minRows) {
    console.error(`\n${who}: expected at least ${opts.minRows} row(s), got ${out.length}. ` +
      `A guard measured over nothing reports success for the wrong reason. Refusing to pass.`);
    process.exit(1);
  }
  return out;
}
