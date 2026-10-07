// THE PHONE'S LOW-BALANCE ALARM MUST MEASURE A RATE, NOT JUST A LEVEL.
//
// 2026-09-26. The CRM had been emailing "⚠️ CRM degraded" for hours. The check behind it was
// correct — I read it earlier the same day and confirmed so — and I still had no idea how bad it
// was, because I verified the MECHANISM and never read the VALUE. The balance was $14.07 against
// a $15 floor. Pulling 14 days of usage turned that into "$1.63/day, empty about Oct 5", which
// could then be set against a rate lock dying 10/02 and a closing on 09/28. A level tells you a
// state; only a rate gives you a deadline.
//
// It also exposed a hole in the check itself: A FIXED FLOOR IS BLIND TO THE BURN RATE. $20
// against a $15 floor reports healthy, but at $5/day that is four days from every caller to the
// office line getting a busy signal — the exact two-day outage this file was written to prevent.
// The floor catches a slow drain and misses a fast one, and a fast one is the one that hurts.
//
//   npx tsx scripts/verify-comms-runway.ts
import { balanceVerdict, type Burn } from "../lib/commsHealth";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };

const FLOOR = 15, MIN_DAYS = 10;
const slow: Burn = { perDay: 0.20, worstDay: 0.40, sampled: 14 };   // $0.20/day
const fast: Burn = { perDay: 5.00, worstDay: 9.00, sampled: 14 };   // $5.00/day
const real: Burn = { perDay: 1.63, worstDay: 4.56, sampled: 14 };   // what Twilio actually reported

console.log("\nverify:comms-runway — the low-balance alarm\n");

// ── 1. The live case that prompted this. Below the floor, and it must say WHEN.
const live = balanceVerdict(14.065, FLOOR, MIN_DAYS, real);
chk(live.level === "warn" && !live.ok, "$14.07 under a $15 floor warns");
chk(/\$1\.63\/day/.test(live.detail), "it names the burn rate, not just the balance");
chk(/~8 days left/.test(live.detail), "it names the days remaining");
chk(/empty ~\d{4}-\d{2}-\d{2}/.test(live.detail), "it names a calendar date the phone dies");
chk(/worst of the last 14 days \(\$4\.56\)/.test(live.detail), "it names the pessimistic bound too");

// ── 2. THE HOLE THIS CHANGE EXISTS TO CLOSE. Comfortably above the floor, nearly empty.
//     Before this, the line below reported "info" and the alert said nothing at all.
const fastBurn = balanceVerdict(20.00, FLOOR, MIN_DAYS, fast);
chk(!fastBurn.ok && fastBurn.level === "warn",
  "$20 CLEARS the $15 floor but at $5/day is 4 days — it warns anyway");
chk(/cannot see a fast burn/.test(fastBurn.detail),
  "and it says why the floor missed it, so nobody 'fixes' it by lowering the floor");

// ── 3. The alarm must not cry wolf on a healthy account.
const healthy = balanceVerdict(200, FLOOR, MIN_DAYS, slow);
chk(healthy.ok && healthy.level === "info", "$200 at $0.20/day is quiet");
chk(/\$0\.20\/day/.test(healthy.detail), "…but still reports the runway, so the trend is visible before it bites");

// ── 4. Zero is the outage itself, and outranks every runway consideration.
for (const b of [null, slow, fast]) {
  const z = balanceVerdict(0, FLOOR, MIN_DAYS, b);
  if (z.level !== "critical" || z.ok) chk(false, `a zero balance must be critical (burn=${b ? b.perDay : "null"})`);
}
chk(true, "a zero balance is critical regardless of what the burn rate says");
const neg = balanceVerdict(-3, FLOOR, MIN_DAYS, real);
chk(neg.level === "critical", "a negative balance is critical too");

// ── 5. THE DIAGNOSTIC MUST NEVER BREAK THE ALARM IT DECORATES.
//     If the usage API is unreachable, burn is null — the floor check must still fire exactly
//     as it did before this file existed. A nice-to-have that can silence a critical alarm is
//     worse than no nice-to-have.
const noBurn = balanceVerdict(14.065, FLOOR, MIN_DAYS, null);
chk(!noBurn.ok && noBurn.level === "warn", "with NO usage data the floor warning still fires");
chk(!/day/.test(noBurn.detail), "and it claims no runway it could not measure");
const okNoBurn = balanceVerdict(200, FLOOR, MIN_DAYS, null);
chk(okNoBurn.ok && okNoBurn.level === "info", "a healthy balance with no usage data stays quiet");

// ── 6. An unreadable balance is not a healthy one.
const nan = balanceVerdict(NaN, FLOOR, MIN_DAYS, real);
chk(!nan.ok && nan.level === "warn", "an unreadable balance warns rather than passing");

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). This alarm is the one that turns a two-day dead office line into a two-minute top-up; it does not get to be approximately right.\n`);
  process.exit(1);
}
console.log("PASS — the alarm measures a rate, names a date, catches a fast burn above the floor, and degrades to the old behaviour when usage cannot be read.\n");
