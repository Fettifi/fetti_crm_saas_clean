// A SCREEN THAT ONLY REMEMBERS ITS FAILURES IS NOT A SCREEN.
//
// Ramon, 2026-08-02: "fix the unverified leads - run shield on all of them".
//
// app/api/cron/shield-sweep runs every 6 hours and scored EVERY in-scope lead — then wrote
// raw.shield only inside `if (hard || total >= qTh)`. A lead that passed had its verdict
// computed and discarded, four times a day, forever. lib/leadReality.ts returns "real" only
// when raw.shield.band === "clean" — a value nothing in the codebase ever wrote — so 166 of
// 170 drip-eligible leads read "Not yet screened by Lead Shield" while being screened
// continuously. The same shape as the heartbeat that logged success for a no-op.
//
// It matters more than a badge: as of 3779c29 the drip refuses "suspect"/"invalid" leads, so
// the verdict now decides whether a lead is worked at all.
//
//   npx tsx scripts/verify-shield-verdict.ts
import { readFileSync } from "fs";
import { leadReality } from "../lib/leadReality";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log(`\nSHIELD VERDICT — a pass is a finding\n`);

// ── 1. The sweep records a CLEAN result, not only a quarantine.
{
  const src = code("app/api/cron/shield-sweep/route.ts");
  chk(/band: "clean"/.test(src), "the sweep writes band \"clean\" for a lead that passes");
  chk(/verdict: "clear"/.test(src), "under an explicit clear verdict");
  chk(/if \(!raw\.shield\)/.test(src),
    "on a FRESHLY re-read row, so a quarantine that landed since the bulk select is never overwritten by a clean band");
  chk(/cleared\+\+/.test(src) && /cleared \}/.test(src),
    "and the count is reported, so a run that clears 190 leads does not look identical to one that clears none");
}

// ── 2. A cleared record must NOT invent a Twilio lookup. leadReality reads lookup.valid and
//      lookup.lineType; a null lookup downgrades to suspect and a fabricated one asserts a
//      check that was never paid for or performed.
{
  const src = code("app/api/cron/shield-sweep/route.ts");
  const block = src.slice(src.indexOf('band: "clean"') - 400, src.indexOf('band: "clean"') + 400);
  chk(!/lookup/.test(block), "the cleared record omits `lookup` entirely rather than inventing or nulling it");
  chk(!/smsCapable/.test(block), "and omits smsCapable — false would read as 'landline, cannot text'");
}

// ── 3. The verdict actually produces "real" through the shipping function.
{
  const cleanShield = { version: 1, verdict: "clear", band: "clean", risk: 0, signals: [], channel: "api", retro: true };
  const r = leadReality({ raw: { shield: cleanShield }, name: "Dawn Engler", email: "dawn@example.com", phone: "5615550134" });
  chk(r.level === "real", `a clean band yields level "real" (got "${r.level}")`);

  // And the tiers below it still work.
  chk(leadReality({ raw: { shield: { ...cleanShield, band: "gray", verdict: "quarantine" } }, name: "x", email: "x@y.com", phone: "5615550134" }).level === "suspect",
    "a gray band is still suspect");
  chk(leadReality({ raw: { shield: { ...cleanShield, band: "junk" } }, name: "x", email: "x@y.com", phone: "5615550134" }).level === "invalid",
    "a junk band is still invalid");
  chk(leadReality({ raw: {}, name: "x", email: "x@y.com", phone: "5615550134" }).level === "unverified",
    "and no record at all is still unverified");
}

// ── 4. THE BACKFILL MUST NOT LAUNDER A LEAD THAT WAS ALREADY SUSPECT.
//      leadReality has a no-Shield fallback that flags a placeholder name or a disposable
//      address without any record. Writing band:"clean" over one of those would CLEAR a lead a
//      cheap check had already caught — the backfill would make the system less suspicious,
//      which is the opposite of what was asked for.
{
  const src = code("scripts/shield-backfill.ts");
  chk(/p\.before === "suspect" \|\| p\.before === "invalid"/.test(src),
    "the backfill refuses to upgrade a lead that already read suspect or invalid");
  chk(/l\.email \|\| l\.phone/.test(src),
    "and skips rows with neither an email nor a phone — there is no identity to screen, and 'junk' would libel a desk-created borrower");
}

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). A verdict decides whether a lead is worked at all now; a screen that forgets its passes silently withholds that decision.\n`); process.exit(1); }
console.log(`PASS — a pass is recorded, a clean record claims no check it did not make, and the backfill cannot launder a flagged lead.\n`);
