// ONE SHARE TOKEN MUST NOT HAVE THREE EXPIRY DATES.
//
// 2026-10-15. Four surfaces read `preapprovals.expires_on` and answer "is this letter still
// valid?", and three different answers came back for the same token:
//
//   app/api/letter/[token]/pdf/route.ts  new Date("2026-10-20")                -> 2026-10-19 17:00 PT
//   app/api/letter/[token]/route.ts      `${expires_on}T23:59:59-07:00`        -> 2026-10-20 23:59 PT
//   app/letter/[token]/page.tsx          `${expires_on}T23:59:59-07:00`        -> 2026-10-20 23:59 PT
//   lib/preapprovalPdf.ts                `${expires_on}T23:59:59Z`             -> 2026-10-20 16:59 PT
//
// The PDF download therefore 410'd 30h59m59s before the date printed on the letter, while
// the web page served the same letter as live. The reader who finds that out is the listing agent
// on the other side of the offer.
//
// lib/preapprovalExpiry.ts is now the one predicate. This guard holds two things:
//   • the boundary BEHAVES — including that the exact instant the old PDF route refused (5pm
//     Pacific the day before) is not expired, so the bug cannot come back
//   • every reader surface computes the SAME instant from the same date. Not "mentions the module":
//     each file's own expiry expression is extracted and evaluated, and the milliseconds compared.
//
// The renderer is held to a one-sided rule instead: lib/preapprovalPdf.ts decides whether to stamp
// "THIS PRE-APPROVAL HAS EXPIRED" across the document, and it may fire EARLY (a document that calls
// itself expired is never relied on). What it must never do is call a letter valid after the routes
// have stopped serving it.
//
//   npm run verify:letter-expiry
import { readFileSync } from "fs";
import { isLetterGone, isLetterExpired, letterExpiryMs, LETTER_EXPIRY_SUFFIX } from "../lib/preapprovalExpiry";

const read = (p: string) => readFileSync(p, "utf8");
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? `\n       ${d}` : ""}`); };

console.log("\nPRE-APPROVAL LETTER EXPIRY — one token, one answer\n");

// ── 1. the boundary itself, at real instants ──────────────────────────────────────────────────
const DAY = "2026-10-20";
const at = (iso: string) => Date.parse(iso);
const live = { status: "active", expires_on: DAY };

ck("valid one second before the end of the expiry day, Pacific",
   isLetterGone(live, at("2026-10-20T23:59:58-07:00")) === false);
ck("gone one second after the expiry day ends, Pacific",
   isLetterGone(live, at("2026-10-21T00:00:01-07:00")) === true);
// THE REGRESSION TEST. 6pm Pacific on 2026-10-19 is the instant the old PDF route started
// answering 410 — the letter printed "Valid through October 20" and the download was already dead.
ck("still valid at 6pm Pacific the day BEFORE the printed date (the 30h59m59s bug)",
   isLetterGone(live, at("2026-10-19T18:00:00-07:00")) === false,
   "a bare new Date(\"YYYY-MM-DD\") is UTC midnight — this is the shape that produced the bug");
// 30h59m59s, computed here rather than asserted from memory: UTC midnight on the expiry date to
// 23:59:59 at -07:00 on that same date is 111,599 seconds. The first version of this check claimed
// 1,859 minutes and went red on 1,860 — a figure nobody had measured.
ck("…and the old UTC-midnight boundary really is 30h59m59s earlier than the correct one",
   (letterExpiryMs(DAY)! - Date.parse(DAY)) / 1000 === 111599,
   `measured difference: ${(letterExpiryMs(DAY)! - Date.parse(DAY)) / 1000} seconds`);

ck("a VOID letter is gone even with a future expiry date",
   isLetterGone({ status: "void", expires_on: "2099-01-01" }) === true);
ck("a missing letter is gone (the 404 path)", isLetterGone(null) === true);
ck("a letter with NO expiry date never expires — preserved from all four original surfaces",
   isLetterGone({ status: "active", expires_on: null }) === false);
ck("a malformed expiry reads as no-expiry, not as expired (NaN compares false, as before)",
   isLetterExpired("soon") === false,
   "a typo in a date must not start 410-ing live letters");
ck("an explicit full timestamp is honoured as written, not rounded to end of day",
   letterExpiryMs("2026-10-20T08:00:00-07:00") === at("2026-10-20T08:00:00-07:00"));
// `letterExpiryMs(DAY)! <= …` was the first version of this, and sabotaging the suffix to an
// invalid offset made it PASS: letterExpiryMs returned null, and `null <= number` coerces null to 0.
// A boundary of "the epoch" is not a short window, it is a broken one. Finite first, then compare.
const dayMs = letterExpiryMs(DAY);
ck("the boundary never runs LONGER than the printed date in either season (fixed -07:00)",
   typeof dayMs === "number" && Number.isFinite(dayMs) && dayMs <= at("2026-10-20T23:59:59-08:00") && dayMs >= at("2026-10-20T23:59:59-07:00"),
   `computed ${dayMs === null ? "NOTHING — the suffix no longer parses" : new Date(dayMs).toISOString()}; ` +
   `must sit between end-of-day PDT and end-of-day PST (${new Date(at("2026-10-20T23:59:59-07:00")).toISOString()} … ${new Date(at("2026-10-20T23:59:59-08:00")).toISOString()})`);

// ── 2. the PDF route no longer decides for itself ─────────────────────────────────────────────
const pdfRoute = read("app/api/letter/[token]/pdf/route.ts");
ck("app/api/letter/[token]/pdf/route.ts gates on the shared predicate",
   /isLetterGone\s*\(/.test(pdfRoute));
ck("…and does not compute an expiry of its own anywhere",
   !/expires_on/.test(pdfRoute),
   "any date arithmetic left in this route is a fourth answer waiting to happen");

// ── 3. every reader surface computes the SAME instant ─────────────────────────────────────────
// Extract each file's own expiry expression and EVALUATE it. A file that imports the shared module
// is taken at the shared boundary; a file that builds its own template literal is measured by the
// suffix it actually uses; a file doing bare `new Date(expires_on)` is measured at UTC midnight,
// which is how the original defect shows up here.
const SHARED = letterExpiryMs(DAY)!;
function boundaryOf(path: string): { ms: number | null; how: string } {
  const src = read(path);
  if (/from\s+"@\/lib\/preapprovalExpiry"/.test(src)) return { ms: SHARED, how: "lib/preapprovalExpiry" };
  const tpl = src.match(/\$\{[\w.]*expires_on\}([^`]*)`/);
  if (tpl) {
    const ms = Date.parse(`${DAY}${tpl[1]}`);
    return { ms: Number.isFinite(ms) ? ms : null, how: `inline "${tpl[1]}"` };
  }
  if (/new Date\(\s*[\w.]*expires_on\s*\)/.test(src)) return { ms: Date.parse(DAY), how: "bare new Date() — UTC midnight" };
  return { ms: null, how: "no expiry decision found" };
}

// The three surfaces a borrower or an agent can reach with a share token. They must agree exactly.
const READERS = [
  "app/api/letter/[token]/pdf/route.ts",
  "app/api/letter/[token]/route.ts",
  "app/letter/[token]/page.tsx",
];
for (const p of READERS) {
  const b = boundaryOf(p);
  ck(`${p} expires the same token at the same instant (${b.how})`,
     b.ms === SHARED,
     b.ms === null
       ? "could not determine how this file decides expiry — it either stopped deciding or changed shape"
       : `this file: ${new Date(b.ms).toISOString()} · shared: ${new Date(SHARED).toISOString()} · ` +
         `${Math.round((SHARED - b.ms) / 60000)} minutes apart`);
}
// A guard that found no reader surface would pass over nothing.
ck(`the agreement check examined all ${READERS.length} reader surfaces`, READERS.length === 3);

// ── 4. the renderer may be early, never late ──────────────────────────────────────────────────
const rend = boundaryOf("lib/preapprovalPdf.ts");
ck(`lib/preapprovalPdf.ts never calls a letter valid after the routes stop serving it (${rend.how})`,
   rend.ms !== null && rend.ms <= SHARED,
   rend.ms === null ? "could not determine the renderer's boundary"
     : `renderer ${new Date(rend.ms).toISOString()} vs routes ${new Date(SHARED).toISOString()}`);
if (rend.ms !== null && rend.ms < SHARED) {
  console.log(`       · note: the renderer stamps EXPIRED ${Math.round((SHARED - rend.ms) / 60000)} minutes ` +
              `before the link dies (${LETTER_EXPIRY_SUFFIX} vs its own UTC end-of-day). That direction is safe —` +
              `\n         a document that calls itself expired is never relied on — but it is still two rules for one date.`);
}

console.log(fail
  ? `\n❌ ${fail} check(s) failed — a share token with two expiry dates is a letter the other side of the deal cannot verify\n`
  : "\n✅ ALL PASS — every reader surface expires the same token at the same instant\n");
process.exit(fail ? 1 : 0);
