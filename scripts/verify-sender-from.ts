// THE VISIBLE "FROM" ON BORROWER MAIL COMES FROM ONE PLACE, AND NOTHING WAS CHECKING THAT.
//
// 2026-10-16. The desk quarantined a forged "IRS Tax Penalty Status Notice" whose From line was
// noreply@fettifi.com, Ramon said block it, and answering "is that safe?" turned up a real gap:
// of the 108 verify:* guards in this repo, grep across scripts/, hooks/ and .github/ for
// `mailFrom|senderFrom|EMAIL_FROM|noreply` returned ZERO. The one module written to be the single
// source of truth for the sender — lib/notify/mailFrom.ts — had no guard asserting anybody used it.
//
// And exactly one send site didn't. app/api/portal/auth/send-otp/route.ts read
//     process.env.LEAD_NOTIFY_EMAIL_FROM || 'Fetti Financial Services <noreply@fettifi.com>'
// which is borrower-facing — it is the access code a borrower needs to open her own portal. Two
// independent defects in one line:
//
//   1. LEAD_NOTIFY_EMAIL_FROM is "FettiFinancialServices<hello@fettifi.com>" and hello@ HAS NO
//      INBOX (Ramon, 2026-07-14). mailFrom.ts coerces hello@ -> frank@ precisely because of this;
//      the OTP route never called it, so a borrower replying to her access code hit a dead mailbox.
//   2. The fallback named noreply@fettifi.com. fettifi.com is a VERIFIED Resend sending domain
//      (confirmed against the Resend API 2026-10-16), and Resend allows ANY local-part on a
//      verified domain — so that address is first-class send-capable, DKIM-signed and DMARC-aligned.
//      Clearing one Vercel env var would have moved every borrower access code onto an unmonitored
//      address that now also carries a block entry on our own mail perimeter.
//
// DMARC p=reject stops an OUTSIDER forging us. It does nothing about us sending as the wrong
// local-part ourselves — that is this guard's job.
//
//   npx tsx scripts/verify-sender-from.ts            # 0 clean · 1 defect
//   npx tsx scripts/verify-sender-from.ts --selftest
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const SCAN = ["app", "lib", "components"];

/** The only sender that may appear as a From literal. Everything else routes through senderFrom(). */
export const ALLOWED_FROM = /frank@fettifi\.com/i;

// An @fettifi.com address. The lookbehind is load-bearing: without it the local part matches
// mid-address, so "frank@fettifi.com" yields the capture "k@fettifi.com" and the ALLOWED_FROM test
// never sees the real address. The first draft of this guard did exactly that and reported four
// false positives on lib/notify/docRequest.ts, which is how a guard gets switched off.
export const FETTI_ADDR = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@fettifi\.com)/g;

// Only an ASSIGNMENT to a sender counts. `from = …`, `from: …`, `FROM_EMAIL = …`. A privacy page
// printing privacy@fettifi.com as a contact address, or a Reply-To, is not a sender and must not be
// flagged — app/privacy/page.tsx tripped the first draft purely because the line contained "from".
export const SENDER_CONTEXT = /\b(?:from|FROM|_FROM|From)\s*[:=]\s*[^=]/;

/** Reading the notify env var straight into a sender, instead of calling senderFrom(). */
export const RAW_ENV_SENDER =
  /\b(?:const|let|var)\s+from\s*(?::\s*string\s*)?=\s*process\.env\.(LEAD_NOTIFY_EMAIL_FROM|LEAD_RESPONSE_FROM_EMAIL)/;

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

export type Defect = { file: string; line: number; kind: string; text: string };

// INTERNAL ALERTS ARE EXEMPT, AND ONLY INTERNAL ONES.
// lib/notify/leadAlert.ts and lib/stalledFiles.ts send to LEAD_NOTIFY_EMAIL_TO — Ramon's own notify
// address. Those are the desk talking to itself; nobody replies to them, so an unmonitored From
// costs nothing, and rewriting working lead alerting to satisfy a guard would be the guard causing
// the damage. A send is exempt ONLY when the same block also addresses LEAD_NOTIFY_EMAIL_TO. The
// moment someone points one of these at a borrower, the exemption stops applying and it goes red.
const INTERNAL_TO = /process\.env\.LEAD_NOTIFY_EMAIL_TO/;
const WINDOW = 8;

export function auditSource(src: string, file = "<mem>"): Defect[] {
  const out: Defect[] = [];
  const code = stripComments(src);
  const lines = code.split("\n");
  const internalNear = (i: number) =>
    lines.slice(Math.max(0, i - WINDOW), i + WINDOW).some((l) => INTERNAL_TO.test(l));
  lines.forEach((line, i) => {
    if (internalNear(i)) return;   // internal desk alert — see above
    // 1. a disallowed @fettifi.com address written as a literal sender
    if (SENDER_CONTEXT.test(line)) {
      for (const m of line.matchAll(FETTI_ADDR)) {
        const addr = m[1];
        if (ALLOWED_FROM.test(addr)) continue;
        out.push({ file, line: i + 1, kind: `sender literal "${addr}" is not frank@fettifi.com`, text: line.trim().slice(0, 120) });
      }
    }
    // 2. a sender taken straight off the env, bypassing senderFrom()
    if (RAW_ENV_SENDER.test(line))
      out.push({ file, line: i + 1, kind: "sender read from env directly — must call senderFrom()", text: line.trim().slice(0, 120) });
  });
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) acc.push(p);
  }
  return acc;
}

if (process.argv.includes("--selftest")) {
  let bad = 0;
  const ck = (n: string, c: boolean) => { if (!c) bad++; console.log(`  ${c ? "✅" : "❌"} ${n}`); };
  console.log("\nSELFTEST — verify-sender-from\n");

  // the exact line that shipped
  const shipped = `const from = process.env.LEAD_NOTIFY_EMAIL_FROM || 'Fetti Financial Services <noreply@fettifi.com>';`;
  ck("the REAL shipped OTP line is caught", auditSource(shipped).length > 0);
  ck("…and it is caught for BOTH reasons (literal + raw env)", auditSource(shipped).length === 2);
  ck("a noreply@ sender literal is caught",
     auditSource(`const from = "Fetti <noreply@fettifi.com>";`).some((d) => /noreply@fettifi\.com/.test(d.kind)));
  ck("a hello@ sender literal is caught (dead mailbox)",
     auditSource(`const from = "Fetti <hello@fettifi.com>";`).some((d) => /hello@fettifi\.com/.test(d.kind)));
  ck("frank@ as a sender literal is ALLOWED",
     auditSource(`const CANONICAL_FROM = "Fetti Financial Services <frank@fettifi.com>";`).length === 0);
  ck("senderFrom() is the blessed path and is not flagged",
     auditSource(`const from = senderFrom();`).length === 0);
  ck("a non-sender mention of an address is not flagged",
     auditSource(`const replyTo = "hello@fettifi.com"; // not a from`).length === 0);
  ck("a COMMENT naming the bad pattern is not flagged",
     auditSource(`// const from = process.env.LEAD_NOTIFY_EMAIL_FROM || "x <noreply@fettifi.com>"`).length === 0);
  ck("a BLOCK comment naming it is not flagged",
     auditSource(`/* const from = "x <noreply@fettifi.com>" */`).length === 0);
  ck("LEAD_RESPONSE_FROM_EMAIL read directly is also caught",
     auditSource(`const from = process.env.LEAD_RESPONSE_FROM_EMAIL;`).length === 1);
  ck("mailFrom.ts's own env read is NOT a `from =` and so is not flagged",
     auditSource(`const env = (process.env.LEAD_RESPONSE_FROM_EMAIL || "").trim();`).length === 0);

  // the internal-alert exemption — must exempt internal, must NOT exempt borrower-facing
  const internalBlock = `const to = process.env.LEAD_NOTIFY_EMAIL_TO;\nconst from = process.env.LEAD_NOTIFY_EMAIL_FROM;`;
  ck("an INTERNAL desk alert (sends to LEAD_NOTIFY_EMAIL_TO) is exempt",
     auditSource(internalBlock).length === 0);
  const borrowerBlock = `const to = borrower.email;\nconst from = process.env.LEAD_NOTIFY_EMAIL_FROM;`;
  ck("…but the SAME sender aimed at a borrower is NOT exempt",
     auditSource(borrowerBlock).length === 1);
  ck("…and the exemption does not reach across a long file",
     auditSource(`const to = process.env.LEAD_NOTIFY_EMAIL_TO;` + "\n".repeat(30) +
                 `const from = process.env.LEAD_NOTIFY_EMAIL_FROM;`).length === 1);

  // the live tree must be clean now that the OTP route is fixed
  const live = SCAN.flatMap((d) => walk(join(ROOT, d))).flatMap((f) => auditSource(readFileSync(f, "utf8"), relative(ROOT, f)));
  ck(`the live tree is clean (${live.length} defect(s))`, live.length === 0);
  if (live.length) for (const d of live) console.log(`       ${d.file}:${d.line} — ${d.kind}`);

  console.log(bad ? `\n❌ ${bad} failed\n` : "\n✅ ALL PASS\n");
  process.exit(bad ? 1 : 0);
}

const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
const defects = files.flatMap((f) => auditSource(readFileSync(f, "utf8"), relative(ROOT, f)));

console.log(`\nSENDER FROM — ${files.length} file(s) scanned\n`);
if (!defects.length) {
  console.log("✅ CLEAN — every sender is frank@fettifi.com or routes through senderFrom()\n");
  process.exit(0);
}
for (const d of defects) console.log(`  ❌ ${d.file}:${d.line} — ${d.kind}\n       ${d.text}`);
console.log(`\n❌ ${defects.length} sender defect(s). Use senderFrom() from lib/notify/mailFrom.ts.`);
console.log(`   fettifi.com is a VERIFIED Resend domain: any local-part will send, DKIM-signed.`);
console.log(`   An unmonitored From is mail a borrower can reply into a void.\n`);
process.exit(1);
