// A GUARD THAT IS NOT IN THE HOOK IS A GUARD THAT DOES NOT RUN.
//
// 2026-09-19. package.json declared 90 verify:* scripts; scripts/hooks/pre-commit invoked 61. The
// other 29 existed, passed when run by hand, and enforced nothing on any commit — among them
// verify:sms-consent (TCPA), verify:disclosure (Equal Housing), verify:twilio-sig, verify:1003,
// verify:income-drift-gate, verify:income-payload and verify:currency-input. MEMORY.md prints the
// word HARD beside rules those guards were supposed to hold.
//
// I added to that pile the same day: I wrote verify:esign-field-units after a borrower's signature
// stamped off the page, wired it into package.json, and never referenced it in the hook. Writing a
// guard and assuming it fires is the failure this file exists to make impossible.
//
// scripts/verify-assertions.ts already asks "is every guard REACHABLE?" and answers it with "does it
// have an npm script" (its own comment says so). Reachable is not enforced. This asks the question
// that matters: does the pre-commit hook actually invoke it, or has someone declared, in writing and
// with a reason, that it is manual?
//
//   npm run verify:hook-wired
import { readFileSync } from "fs";
import { execSync } from "child_process";

// Manual by DECLARATION, not by omission. Each entry needs a reason, and the reason has to be about
// why a commit hook is the wrong place to run it — never "it was failing" or "it is slow to type".
const MANUAL: Record<string, string> = {
  "verify:rsvp-text": "SENDS REAL SMS through the live inbound webhook. Must never run unattended.",
  "verify:rsvp-line": "drives the live RSVP voice/SMS line end to end. Real messages to real numbers.",
  "verify:dns": "calls the GoDaddy API over the network; run by hand when DNS records change.",
  "verify:photos": "reads the private guest-photo bucket over the network; not a code invariant.",
  "verify:card-statement": "scans every stored document in the live database (>100s). Run by hand.",
};

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nHOOK WIRING — a declared guard must actually be invoked\n");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const declared = Object.keys(pkg.scripts || {}).filter((k) => k.startsWith("verify:")).sort();
// STRIP THE COMMENTS BEFORE SEARCHING. First cut of this guard used a bare substring match against
// the whole hook file — and the comment block I had just written in that hook NAMES the statutory
// guards ("verify:sms-consent (TCPA), verify:disclosure..."). So the guard matched its own prose:
// I unwired verify:sms-consent to prove the check worked, and it stayed green. That is
// guard-matched-its-own-comment, inside the guard built to stop exactly this. Comments are stripped,
// and a guard only counts as wired if it appears in a line that actually RUNS it — an `npm run`
// invocation or a `for G in ...` list the loop executes.
const hookRaw = readFileSync("scripts/hooks/pre-commit", "utf8");
const hook = hookRaw
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))              // drop whole-line comments
  .map((l) => l.replace(/\s#(?!\{).*$/, ""))    // drop trailing comments
  .filter((l) => /npm run|for G in|verify:/.test(l) && !/^\s*echo/.test(l))
  .join("\n");

// 1. The hook has to be armed at all, or every assertion below is theatre.
let hooksPath = "";
try { hooksPath = execSync("git config core.hooksPath", { encoding: "utf8" }).trim(); } catch { /* unset */ }
ck("the repo's pre-commit hook is armed (core.hooksPath = scripts/hooks)", hooksPath === "scripts/hooks",
  `core.hooksPath = ${hooksPath || "EMPTY — NO hook runs on commit"}`);

// 2. Every declared guard is either invoked by the hook or declared manual with a reason.
const unwired = declared.filter((n) => !hook.includes(n) && !(n in MANUAL));
ck(`every declared guard is invoked by the hook or declared manual (${declared.length} declared, ${Object.keys(MANUAL).length} manual)`,
  unwired.length === 0, unwired.length ? `NOT WIRED AND NOT DECLARED: ${unwired.join(", ")}` : "");

// 3. A manual declaration must name a guard that still exists — stale exemptions hide real gaps.
const staleManual = Object.keys(MANUAL).filter((n) => !declared.includes(n));
ck("no manual declaration names a guard that no longer exists", staleManual.length === 0, staleManual.join(", "));

// 4. A guard cannot be BOTH hook-wired and declared manual — that means someone exempted a live gate.
const bothWays = Object.keys(MANUAL).filter((n) => hook.includes(n));
ck("nothing is both declared manual and invoked by the hook", bothWays.length === 0, bothWays.join(", "));

// 5. The compliance guards specifically. These protect statutory obligations, so name them by hand:
//    an exemption for any of these should have to be argued, not slipped in with a rename.
const COMPLIANCE = ["verify:sms-consent", "verify:disclosure", "verify:twilio-sig", "verify:1003"];
for (const c of COMPLIANCE) {
  if (!declared.includes(c)) { ck(`${c} still exists`, false, "declared guard disappeared"); continue; }
  ck(`${c} is invoked by the hook (statutory — TCPA / EHO / signature / URLA)`, hook.includes(c));
}

console.log(fail
  ? `\n❌ ${fail} check(s) failed — a guard nobody runs is not a guard\n`
  : `\n✅ ALL PASS — ${declared.length - Object.keys(MANUAL).length} guards invoked by the hook, ${Object.keys(MANUAL).length} declared manual with reasons\n`);
process.exit(fail ? 1 : 0);
