/**
 * GUARD: the daily social posts must be steered by our own competitor research — and must never
 * leak it.
 *
 * Ramon, 2026-10-12 by voice: "Instagram: rotate the images — the posted ones are stale. And use
 * competitor-watch data on industry flow/climate to drive what the daily posts say."
 *
 * Wired 2026-10-18. The data had been there the whole time: COMPETITOR_WATCH_CACHE refreshes daily
 * (20KB, last written 2026-10-18T13:30Z) and COMPETITOR_HISTORY is ~390KB. lib/content.ts ignored
 * all of it and generated from a static list of teaching pillars every single day.
 *
 * THE RISK THIS GUARD EXISTS FOR IS THE OTHER DIRECTION. The weekly brief names real competitors
 * and quotes their follower and engagement numbers:
 *
 *   "CrossCountry is the clear outlier: +1,614 followers and 7.56% engagement this week..."
 *
 * Feeding that to a generator that writes PUBLIC posts for a licensed mortgage brokerage is how a
 * post ends up naming a rival or republishing their metrics. Naming competitors in marketing is
 * comparative advertising — a different risk class entirely — and those numbers are not market
 * data, not ours, and the prompt's own standing rule is never to invent or borrow statistics.
 *
 *   npx tsx scripts/verify-content-climate.ts
 *
 * Exit 1 = the climate wiring is missing, or its prohibitions are not in the prompt.
 */
import { readFileSync } from "fs";

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}${cond || !detail ? "" : `\n      ${detail}`}`);
  if (!cond) failures++;
};

const src = readFileSync("lib/content.ts", "utf8");

console.log("\nCONTENT CLIMATE — is the daily post steered by our research, without leaking it?\n");

ok("industryClimate() exists and reads the weekly brief",
   /export async function industryClimate/.test(src) && /COMPETITOR_WEEKLY_BRIEF/.test(src));
ok("THE REGRESSION: the climate block is actually appended to the prompt",
   (src.match(/\$\{climateBlock\}/g) || []).length >= 2,
   `found ${(src.match(/\$\{climateBlock\}/g) || []).length} injection point(s) — both the topic and the
      default branch must carry it, or half the runs are unsteered`);
ok("…and it is awaited, not left a floating Promise",
   /const climate = await industryClimate\(\)/.test(src));

// ── THE PROHIBITIONS. These are the whole reason the guard exists. ────────────────────────────
ok("the prompt forbids naming any competitor",
   /NEVER name, describe or allude to any competitor/i.test(src));
ok("the prompt forbids repeating their numbers",
   /NEVER repeat any number, follower count or engagement figure/i.test(src));
ok("the prompt forbids growth-tactic subjects (giveaways, follower counts)",
   /NEVER mention giveaways, follower counts/i.test(src));
ok("…and tells the model to fall back rather than force it",
   /IGNORE IT and fall back to the standard pillars/i.test(src));

// ── STALENESS. Market climate decays; an old read steers wrongly and with confidence. ─────────
ok("a maximum age is enforced on the brief", /CLIMATE_MAX_AGE_DAYS/.test(src));
const age = Number((src.match(/CLIMATE_MAX_AGE_DAYS\s*=\s*(\d+)/) || [])[1]);
ok("…and it is a sane window (1–30 days)", age >= 1 && age <= 30, `got ${age}`);

// ── FAIL-SOFT. The daily post must never be blocked by this. ──────────────────────────────────
ok("every failure path returns empty string rather than throwing",
   /catch \{ return ""; \}/.test(src) && (src.match(/return "";/g) || []).length >= 3,
   "industryClimate must swallow a missing/garbled/stale setting and let generation proceed");

// NOT VACUOUS: prove the file is the one we think it is and the checks could fail.
ok("lib/content.ts was actually read", src.length > 3000, `${src.length} bytes`);
ok("a phrase that is NOT in the file is reported absent",
   !/NEVER mention marzipan/i.test(src));

console.log(failures ? `\n❌ verify:content-climate — ${failures} failure(s)\n`
                     : `\n✅ verify:content-climate — posts are steered by our research and cannot leak it\n`);
process.exit(failures ? 1 : 0);
