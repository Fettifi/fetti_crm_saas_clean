// EVERY CRITICAL DNS RECORD FOR fettifi.com, ASSERTED AGAINST WHAT THE INTERNET ACTUALLY RESOLVES.
//
// Why this exists: on 2026-08-12 a Google Search Console domain-property TXT was added at
// GoDaddy. The dangerous shape is not adding a record — it is a later write that REPLACES the
// root TXT set instead of appending to it. That single mistake would take out, in one call:
//   - Microsoft 365 domain ownership (NETORGFT…onmicrosoft.com)
//   - SPF — and with Proofpoint in front of the mailboxes, mail starts silently vanishing
//   - Twilio domain verification (SMS link/opt-in)
//   - TikTok developer verification
//   - Google Search Console domain-property verification
// None of those fail loudly. Email does not bounce; it disappears. So the loss is invisible
// until someone notices a borrower never replied.
//
// This asks real resolvers what is published and fails on anything missing. It is NOT in
// pre-commit — it needs the network, and a guard that breaks offline commits gets disabled,
// which is worse than no guard. Run it after ANY DNS change, and on a schedule.
//
//   npx tsx scripts/verify-dns.ts
import { Resolver } from "dns/promises";

const DOMAIN = "fettifi.com";
// Two independent resolvers: GoDaddy's authoritative answer can be right while the record has
// not reached the resolvers Google/Microsoft actually query. Checking only one hides that gap.
const RESOLVERS: [string, string][] = [
  ["Google 8.8.8.8", "8.8.8.8"],
  ["Cloudflare 1.1.1.1", "1.1.1.1"],
];

/** Each required root TXT, matched by a distinctive substring rather than an exact string —
 *  SPF include lists and verification tokens get edited legitimately; the OWNER must survive. */
const REQUIRED_TXT: { label: string; needle: string; breaks: string }[] = [
  { label: "Microsoft 365 domain ownership", needle: "onmicrosoft.com", breaks: "M365 tenant ownership of the domain" },
  { label: "SPF record", needle: "v=spf1", breaks: "ALL outbound mail — receivers start rejecting or spam-filing" },
  { label: "SPF authorizes Amazon SES", needle: "include:amazonses.com", breaks: "Resend/SES mail to borrowers (and same-domain mail through Proofpoint)" },
  { label: "SPF authorizes Proofpoint", needle: "ppe-hosted.com", breaks: "mail sent through the GoDaddy/Proofpoint gateway" },
  { label: "Twilio domain verification", needle: "twilio-domain-verification=", breaks: "Twilio domain ownership for SMS links" },
  { label: "TikTok developer verification", needle: "tiktok-developers-site-verification=", breaks: "the TikTok developer app" },
  { label: "Google Search Console domain property", needle: "google-site-verification=", breaks: "the sc-domain:fettifi.com property — Search Console goes blind" },
];

/** Mail exchangers. If these vanish, inbound mail stops dead. */
const REQUIRED_MX = ["mx1-usg2.ppe-hosted.com", "mx2-usg2.ppe-hosted.com", "mx3-usg2.ppe-hosted.com"];

const fails: string[] = [];

// Named checkResolver, not check: `check(condition, message)` is this repo's assertion-helper
// convention, and verify:assertions reads a bare `check(a, b)` as an assertion with its
// arguments reversed. This is a per-resolver runner, not an assertion.
// A RESOLVER THAT DID NOT ANSWER HAS NOT TOLD YOU A RECORD IS GONE.
//
// 2026-08-23 this guard went red with "Cloudflare 1.1.1.1: DNS lookup itself failed — queryMx
// ETIMEOUT" under a headline that tells you to go restore wiped records at GoDaddy. Nothing was
// wiped: `dig @1.1.1.1` answered correctly seconds later, and on the very next run it was
// 8.8.8.8 that timed out instead. It was this Mac's network, one query deep, with no retry.
//
// That is worse than a nuisance. This guard exists because a PUT to GoDaddy once removed the
// email TXT records, and the one thing it must never do is make "your MX records are gone" and
// "your wifi hiccuped" print the same way — a red that is usually noise gets waved through, and
// then the one that is real gets waved through too.
//
// So: transient transport failures are retried, and if a resolver still will not answer it is
// reported as UNREACHABLE — explicitly not a finding about the records. NODATA/NOTFOUND is the
// opposite: the resolver answered and said the name has nothing. That stays a hard failure.
const TRANSIENT = new Set(["ETIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ESERVFAIL", "EREFUSED"]);
const unreachable: string[] = [];
let answered = 0;

async function checkResolver(label: string, ip: string): Promise<void> {
  const r = new Resolver();
  r.setServers([ip]);

  let txt: string[] | undefined;
  let mx: { exchange: string; priority: number }[] | undefined;
  let last: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // resolveTxt returns chunked strings per record; a long record arrives split across chunks.
      txt = (await r.resolveTxt(DOMAIN)).map((chunks) => chunks.join(""));
      mx = await r.resolveMx(DOMAIN);
      last = null;
      break;
    } catch (e: any) {
      last = e;
      // An answer of "this name has no such record" is a finding, not a flaky link. Stop.
      if (!TRANSIENT.has(String(e?.code || ""))) break;
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 750));
    }
  }
  if (last || !txt || !mx) {
    if (TRANSIENT.has(String(last?.code || ""))) {
      unreachable.push(`${label}: no answer after 3 attempts — ${last?.message || last} (transport, NOT a statement about the records)`);
    } else {
      fails.push(`${label}: DNS lookup itself failed — ${last?.message || last}`);
    }
    return;
  }
  answered++;

  console.log(`\n${label} — ${txt.length} root TXT, ${mx.length} MX`);

  for (const want of REQUIRED_TXT) {
    const hit = txt.find((t) => t.toLowerCase().includes(want.needle.toLowerCase()));
    if (hit) {
      console.log(`  ok   ${want.label}`);
    } else {
      console.log(`  MISS ${want.label}`);
      fails.push(`${label}: missing root TXT "${want.needle}" (${want.label}) — this breaks ${want.breaks}`);
    }
  }

  for (const host of REQUIRED_MX) {
    if (mx.some((m) => m.exchange.toLowerCase().replace(/\.$/, "") === host)) {
      console.log(`  ok   MX ${host}`);
    } else {
      console.log(`  MISS MX ${host}`);
      fails.push(`${label}: missing MX ${host} — inbound mail to @${DOMAIN} stops`);
    }
  }
}

(async () => {
  console.log(`Checking critical DNS for ${DOMAIN}`);
  for (const [label, ip] of RESOLVERS) await checkResolver(label, ip);

  for (const u of unreachable) console.log(`\n  unreachable  ${u}`);

  // If NO resolver answered, nothing above was checked. Passing here would be the vacuous
  // green this repo keeps paying for — say plainly that the run proved nothing, and fail.
  if (answered === 0) {
    console.error(`\nFAIL — no resolver answered, so NOTHING about ${DOMAIN}'s records was verified by this run.`);
    console.error(`  This is a network result, not a DNS finding. Re-run on a working connection before concluding anything.`);
    process.exit(1);
  }

  if (fails.length) {
    console.error(`\nFAIL — ${fails.length} problem(s):`);
    for (const f of fails) console.error(`  - ${f}`);
    console.error(
      `\nIf a record was wiped, restore by APPENDING it back:\n` +
        `  PATCH https://api.godaddy.com/v1/domains/${DOMAIN}/records\n` +
        `Never PUT the all-records endpoint — that is what removes the others.`
    );
    process.exit(1);
  }
  console.log(
    unreachable.length
      ? `\nPASS — every critical TXT and MX resolves on the ${answered} of ${RESOLVERS.length} resolver(s) that answered. ` +
        `${unreachable.length} did not answer and was NOT checked.`
      : `\nPASS — every critical TXT and MX resolves on both resolvers.`
  );
})();
