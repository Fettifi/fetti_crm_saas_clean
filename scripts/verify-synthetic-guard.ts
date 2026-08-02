// SYNTHETIC LEAD GUARD — the daily healthcheck must reach the database and nothing else.
//
// The autopilot + doctor sweeps POST a fake lead to /api/apply every day. For six weeks
// (35 probes, 2026-06-19 → 2026-07-29) every one of them ran the FULL new-lead pipeline:
// a first-touch email to a domain that does not resolve, an owner page to Ramon (one of
// them Tier 1 — the voice pager), a Lead event to the Meta Conversions API, and four
// OpenAI agent runs. The sweep deleted the test ROW afterward and the log looked clean.
// Nothing about deleting a row unsends an email or un-trains a pixel.
//
// This guard checks the two directions that actually matter, in the order they can hurt:
//
//   1. OVER-MATCH (catastrophic): does the predicate claim any REAL lead is synthetic?
//      A false positive here silently drops a paying borrower's first touch. Checked
//      against every live lead in the database, not a fixture.
//   2. UNDER-MATCH (the original bug): does it catch every probe shape the sweeps send?
//   3. WIRED (the recurring failure mode): is the predicate actually CALLED at both
//      chokepoints? A perfect predicate nobody invokes is the exact shape of every bug
//      this codebase keeps re-learning — MAX_DOCS, the heartbeat, DONE_STAGES.
//
// Usage: npm run verify:synthetic     (step 1 needs SUPABASE creds; skipped without them)
import { readFileSync } from "fs";
import path from "path";
import { isSyntheticLead } from "../lib/synthetic";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  ${d}` : ""}`); };

// ─── 2. UNDER-MATCH: every shape the health sweeps actually send ────────────────
const PROBES = [
  { label: "autopilot email probe", lead: { email: "autopilot+123@fetti-internal.test", source: "website_apply" } },
  { label: "doctor email probe", lead: { email: "doctor+1690000000@fetti-internal.test", source: "doctor_healthcheck" } },
  { label: "autopilot source probe", lead: { email: "someone@example.com", source: "autopilot_healthcheck" } },
  { label: "source w/ stray case+space", lead: { email: "a@example.com", source: " Autopilot_Healthcheck " } },
  { label: "explicit raw.synthetic flag", lead: { email: "a@example.com", source: "website_apply", raw: { synthetic: true } } },
];
for (const p of PROBES) ck(`catches ${p.label}`, isSyntheticLead(p.lead));

// ─── 2b. Shapes that must NOT match, however tempting ───────────────────────────
const LOOKALIKES = [
  { label: "real lead on a normal source", lead: { email: "ramon@example.com", source: "website_apply" } },
  { label: "campaign source containing 'test'", lead: { email: "a@example.com", source: "testimonial_campaign" } },
  { label: "the CAPI selftest (@fetti.test, different domain)", lead: { email: "capitest@fetti.test", source: "capitest" } },
  { label: "lookalike domain, not ours", lead: { email: "a@fetti-internal.test.example.com", source: "website_apply" } },
  { label: "raw.synthetic falsy", lead: { email: "a@example.com", source: "website_apply", raw: { synthetic: "no" } } },
  { label: "empty lead", lead: {} },
  { label: "null lead", lead: null },
];
for (const l of LOOKALIKES) ck(`does NOT catch ${l.label}`, !isSyntheticLead(l.lead));

// ─── 3. WIRED: the predicate is called at EVERY chokepoint ─────────────────────
// One chokepoint is a chokepoint you forget. The first cut of this fix guarded only
// runNewLeadPipeline — and the live probe never reached it, because a probe carries a
// fake phone, so Lead Shield quarantines it and /api/apply takes a DIFFERENT branch.
// The guard was real, correct, and on the wrong road. /api/apply has three exits and
// each one sends something:
//
//   pass       → runNewLeadPipeline   (first touch, owner alert, Meta CAPI, 4 agents)
//   quarantine → sendVerificationEmail + notifyQuarantine   ← what the probe hits
//   returning  → notifyNewLead + respondToLead
//
// So the guard lives in the SENDING functions, where every lane has to pass through it.
const CHOKEPOINTS: [string, string][] = [
  ["lib/leadPipeline.ts", "runNewLeadPipeline — clean-intake lane"],
  ["lib/metaCapi.ts", "sendMetaLeadEvent — pixel training"],
  ["lib/notify/leadAlert.ts", "notifyNewLead — owner page (incl. Tier-1 voice pager)"],
  ["lib/notify/leadResponder.ts", "respondToLead — borrower email/SMS"],
  ["lib/leadShield.ts", "sendVerificationEmail + notifyQuarantine — quarantine lane"],
];
for (const [file, what] of CHOKEPOINTS) {
  let src = "";
  try { src = readFileSync(path.join(process.cwd(), file), "utf8"); } catch { /* reported below */ }
  ck(`${file} calls isSyntheticLead()  [${what}]`, /isSyntheticLead\s*\(/.test(src));
}
// leadShield holds TWO senders; one grep would pass with the other left open.
{
  let src = "";
  try { src = readFileSync(path.join(process.cwd(), "lib/leadShield.ts"), "utf8"); } catch { /* */ }
  for (const fn of ["sendVerificationEmail", "notifyQuarantine"]) {
    const at = src.indexOf(`export async function ${fn}`);
    const body = at < 0 ? "" : src.slice(at, at + 1200);
    ck(`leadShield.${fn}() checks isSyntheticLead`, /isSyntheticLead\s*\(/.test(body));
  }
}

// ─── 1. OVER-MATCH against LIVE data — the direction that costs money ──────────
async function liveOverMatchCheck() {
  const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !KEY) {
    console.log("SKIP  live over-match check (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)");
    return;
  }
  const res = await fetch(`${URL_}/rest/v1/leads?select=id,email,source,raw,created_at&limit=5000`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const rows: any[] = res.ok ? await res.json() : [];
  ck("live leads readable", res.ok, `${rows.length} rows`);
  // A lead is "real" if it isn't one of our own probes by ORIGIN (source/email), judged
  // independently of the predicate under test — otherwise this would be circular.
  const looksLikeOurProbe = (l: any) =>
    /@fetti-internal\.test$/i.test(String(l.email || "")) ||
    ["autopilot_healthcheck", "doctor_healthcheck"].includes(String(l.source || "").trim().toLowerCase());
  const misfires = rows.filter((l) => isSyntheticLead(l) && !looksLikeOurProbe(l));
  ck("no REAL lead is misclassified as synthetic", misfires.length === 0,
    misfires.length ? `${misfires.length} misfire(s): ${misfires.slice(0, 5).map((m) => `${m.id} <${m.email}> src=${m.source}`).join("; ")}` : `${rows.length} live leads checked`);
}

liveOverMatchCheck()
  .catch((e) => { fail++; console.log("FAIL  live over-match check threw:", e?.message || e); })
  .then(() => {
    console.log(fail === 0 ? "\nAll synthetic-guard checks passed." : `\n${fail} check(s) FAILED.`);
    process.exit(fail === 0 ? 0 : 1);
  });
