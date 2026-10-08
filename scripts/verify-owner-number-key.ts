// A FEATURE THAT RINGS RAMON MUST READ A KEY THAT IS ACTUALLY SET.
//
// 2026-10-08. app/api/voice/errand/bridge/route.ts resolved his number from
// `cfg("OWNER_MOBILE") || process.env.OWNER_MOBILE`. Measured that day against both live sources:
// absent from all 43 Vercel production env keys, absent from app_settings. Nothing else in the
// repo had ever used the name — I invented it while writing the route, and it type-checked,
// linted, built and deployed clean, because an unset env var is a legal `undefined`.
//
// The route it broke is reached at exactly one moment: Penny has worked the phone tree, held
// forty minutes, and a human has just picked up. The unset key makes it answer
// {"bridged":false,"error":"not configured"} and she reads the no-answer script. Every cheap part
// of the feature works and the single irreplaceable part fails — and it fails looking exactly
// like "Ramon didn't pick up", so nothing in the logs would have pointed here.
//
// So: a static allowlist of key names that reach him, and a rule that NEW code goes through
// lib/ownerCell.ts instead of re-typing the expression. Divergence was the defect; a second
// copy of the right expression is a third copy waiting to be wrong.
//
//   npx tsx scripts/verify-owner-number-key.ts
//   npx tsx scripts/verify-owner-number-key.ts --live   # also prove the keys RESOLVE
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");
const failures: string[] = [];
const ck = (name: string, cond: boolean, why: string) => { if (!cond) failures.push(`${name}\n        ${why}`); };

// ---- the only key names allowed to carry a number that rings a Fetti principal --------------
// OWNER_CELL           app_settings override, no deploy needed
// LEAD_NOTIFY_SMS_TO   the env var actually set in Vercel production (113d as of 2026-10-08)
// OWNER_CALL_FROM      the FROM side (lib/ownerCallFrom.ts), different concern, same family
// TWILIO_VOICE_FROM /
// TWILIO_FROM          caller IDs, not destinations
const ALLOWED = new Set(["OWNER_CELL", "LEAD_NOTIFY_SMS_TO", "OWNER_CALL_FROM", "TWILIO_VOICE_FROM", "TWILIO_FROM"]);

// Anything that LOOKS like it holds a principal's phone number. Deliberately wide: the point is to
// catch the name I have not thought of yet.
//
// TESTED ON WHOLE IDENTIFIERS, NOT WITH \b. The first version used \b…\b and silently MISSED
// LEAD_NOTIFY_SMS_TO — `_` is a word character, so there is no word boundary between `LEAD` and
// `NOTIFY`. It therefore could not see one of the two keys it exists to govern, which means it
// could not have seen the next invented one either. Enumerate SCREAMING_SNAKE tokens and test
// each whole token.
const KEY_TOKEN = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/g;
const looksLikeOwnerNumber = (k: string) =>
  /^(OWNER|RAMON|DENT|PRINCIPAL|BOSS|MY|HIS)_[A-Z0-9_]*(CELL|MOBILE|PHONE|NUMBER|SMS|PAGER|LINE|DID)/.test(k) ||
  /^(OWNER|RAMON)_CALL_FROM$/.test(k) ||
  /(NOTIFY|ALERT|PAGE|PAGER)_[A-Z0-9_]*(SMS|CELL|PHONE|MOBILE)/.test(k) ||
  /^TWILIO_(VOICE_)?FROM$/.test(k);

// ---- PROVE THE DETECTOR FIRES, before trusting anything it says about the codebase ----------
// This guard must NOT learn about itself by scanning its own source: the first version matched the
// string "OWNER_MOBILE" inside its own failure message and reported a defect in itself. So its own
// file is excluded from the scan below, and these constructed cases are what keep it honest.
for (const k of ["OWNER_MOBILE", "RAMON_CELL", "MY_MOBILE_NUMBER", "OWNER_PHONE", "OWNER_SMS_TO",
                 "LEAD_NOTIFY_SMS_TO", "OWNER_CELL", "PAGER_CELL_TO", "HIS_DID"])
  ck(`detector flags "${k}"`, looksLikeOwnerNumber(k),
    `a key shaped like a principal's phone number must be seen; this one is invisible`);
for (const k of ["TWILIO_ACCOUNT_SID", "LEAD_NOTIFY_EMAIL_TO", "NEXT_PUBLIC_APP_URL", "REPO_OWNER",
                 "SUPABASE_SERVICE_ROLE_KEY", "VOICE_INGEST_TOKEN", "SSN_ENCRYPTION_KEY"])
  ck(`detector ignores "${k}"`, !looksLikeOwnerNumber(k),
    `flagging ordinary config makes this guard noise, and a noisy guard gets switched off`);

// Files that resolved the owner's number BEFORE lib/ownerCell.ts existed and are proven in
// production. They are allowed to keep their own copy of the expression; they are NOT allowed to
// change key name (ALLOWED still governs). Nothing may be added to this list — a new file that
// rings him calls ownerCell().
const LEGACY_INLINE = new Set([
  "app/api/voice/transfer/route.ts",
  "app/api/voice/bridge/route.ts",
  "app/api/sms/inbound/route.ts",
  "lib/connect.ts",
  "lib/hotLead.ts",
  "lib/notify/leadAlert.ts",
  "lib/phoneMessages.ts",
  "lib/commsWatchdog.ts",
  "app/api/cron/comms-reconcile/route.ts",
  "lib/ownerCell.ts",        // the resolver itself
  "lib/ownerCallFrom.ts",    // the FROM side
  "scripts/verify-sms-consent.ts",
  "scripts/verify-owner-number-key.ts",
]);

// ---- walk ------------------------------------------------------------------------------------
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git" || e === "dist") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) files.push(p);
  }
};
for (const d of ["app", "lib", "scripts"]) { try { walk(join(ROOT, d)); } catch {} }
ck("there is source to scan", files.length > 50, `found only ${files.length} files — the scan is not reaching the code`);

const referenced = new Map<string, Set<string>>();   // key -> files
let resolverUsers = 0;

const SELF = "scripts/verify-owner-number-key.ts";

for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  if (rel === SELF) continue;           // see the detector self-test above
  const src = readFileSync(abs, "utf8");
  // Strip comments so a WHY note naming a dead key cannot trip the scan. Note that string
  // LITERALS are deliberately kept — cfg("OWNER_MOBILE") is a string literal, and it is the exact
  // thing being hunted.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  for (const m of code.matchAll(KEY_TOKEN)) {
    const key = m[0];
    if (!looksLikeOwnerNumber(key)) continue;
    if (!referenced.has(key)) referenced.set(key, new Set());
    referenced.get(key)!.add(rel);
  }
  if (/\bownerCell\s*\(/.test(code) && rel !== "lib/ownerCell.ts") resolverUsers++;

  // A file that resolves the number inline, is not legacy, and is not the resolver.
  const inline = /(cfg|getSetting)\s*\(\s*["'`]OWNER_CELL["'`]\s*\)|process\.env\.LEAD_NOTIFY_SMS_TO/.test(code);
  if (inline && !LEGACY_INLINE.has(rel)) {
    failures.push(
      `${rel} resolves the owner's number INLINE\n        ` +
      `call ownerCell() from lib/ownerCell.ts instead. Two copies of the expression is how the ` +
      `third one gets written wrong — which is exactly what OWNER_MOBILE was.`,
    );
  }
}

// ---- THE PROPERTY THAT MATTERS: no invented key names ---------------------------------------
for (const [key, where] of referenced) {
  if (ALLOWED.has(key)) continue;
  failures.push(
    `"${key}" is not a configured way to reach him\n        ` +
    `used in: ${[...where].join(", ")}\n        ` +
    `An unset env var is a legal undefined — it builds, deploys and then fails on a live call. ` +
    `Resolve through ownerCell() (lib/ownerCell.ts), or add the key to BOTH Vercel and ALLOWED here.`,
  );
}

// The guard must be able to SEE the thing it governs, or it is green over nothing.
ck("the scan actually found the owner-number keys", referenced.has("OWNER_CELL") && referenced.has("LEAD_NOTIFY_SMS_TO"),
  `found: ${[...referenced.keys()].join(", ") || "(none)"} — if the proven keys are invisible to the ` +
  `regex then so is the next invented one, and this guard is decoration`);
ck("the errand bridge resolves through ownerCell()", resolverUsers >= 1,
  `no file calls ownerCell() — the 2026-10-08 fix has been reverted or the import was dropped`);

// ---- --live: prove the keys RESOLVE, not just that they are spelled right -------------------
// Static analysis cannot tell a configured key from a typo'd one. This half reads the sources the
// app reads. It is NOT in pre-commit (needs network) — run it before trusting a voice feature.
async function liveCheck() {
  const envLocal = (() => { try { return readFileSync(join(ROOT, ".env.local"), "utf8"); } catch { return ""; } })();
  const inEnv = /^\s*LEAD_NOTIFY_SMS_TO\s*=\s*\S/m.test(envLocal);
  let inDb = false;
  try {
    const { getSetting } = await import("../lib/settings");
    inDb = !!(await getSetting("OWNER_CELL"));
  } catch { /* leave false */ }
  ck("his number RESOLVES from at least one live source", inEnv || inDb,
    `LEAD_NOTIFY_SMS_TO absent from .env.local AND app_settings.OWNER_CELL empty. ` +
    `Every path that rings him — press-1 transfer, hot-lead pager, Penny's errand bridge — is dead.`);
  console.log(`  live: app_settings.OWNER_CELL ${inDb ? "set" : "unset"} · env LEAD_NOTIFY_SMS_TO ${inEnv ? "set" : "unset"}`);
}

function report() {
  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} owner-number gap(s):\n`);
    for (const f of failures) console.error("  • " + f);
    console.error("");
    process.exit(1);
  }
  console.log(`\nOWNER NUMBER\n`);
  console.log(`  ${files.length} files scanned; keys reaching him: ${[...referenced.keys()].sort().join(", ")}`);
  console.log(`  ${resolverUsers} file(s) resolve through ownerCell(); ${LEGACY_INLINE.size - 3} legacy inline, none new.\n`);
  console.log(`PASS — no feature rings a number that nothing sets.\n`);
}

if (process.argv.includes("--live")) liveCheck().then(report);
else report();
