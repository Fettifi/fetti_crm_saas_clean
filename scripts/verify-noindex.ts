// THE noindex DIRECTIVE LANDS ON THE CRM HOST — AND ONLY ON THE CRM HOST.
//
// Background (2026-08-12): the Search Console domain property revealed Google had indexed
// app.fettifi.com/lending/dscr-loans-florida and .../commercial-real-estate-loans-florida,
// competing with the real pages. Both served a correct canonical to fettifi.com — canonicals
// are hints, so that was not enough. The fix is an X-Robots-Tag: noindex header on the app host
// (next.config.mjs) plus a robots.txt there that still lets Googlebot fetch /lending/, because
// a URL Google cannot crawl is a URL Google cannot drop.
//
// Two ways this goes wrong, and the second one is a business-ending mistake:
//   1. The header stops being sent -> the duplicates never leave the index. Annoying.
//   2. The header leaks onto fettifi.com -> Google de-indexes THE ENTIRE PUBLIC SITE.
//      Every lead source that starts with a search disappears, and nothing errors, nothing
//      alerts, and the site keeps serving 200s the whole time.
//
// Assertion 2 is the reason this file exists. It is cheap insurance against a silent
// catastrophe with a slow, hard-to-attribute onset.
//
// Network-dependent, so deliberately NOT in pre-commit — see scripts/verify-dns.ts.
//
//   npx tsx scripts/verify-noindex.ts
const PUBLIC_HOST = "https://fettifi.com";
const APP_HOST = "https://app.fettifi.com";

// The paths that were actually caught in the index, plus the app root.
const APP_PATHS = ["/", "/lending/dscr-loans-florida", "/lending/commercial-real-estate-loans-florida"];
// Public pages that MUST stay indexable. Losing these is the catastrophic case.
const PUBLIC_PATHS = ["/", "/lending/dscr-loans-florida", "/lending/bridge-loans-florida", "/apply", "/quote"];

const problems: string[] = [];

async function robotsHeader(url: string): Promise<{ status: number; tag: string | null }> {
  const r = await fetch(url, { redirect: "manual" });
  return { status: r.status, tag: r.headers.get("x-robots-tag") };
}

function isNoindex(tag: string | null): boolean {
  return !!tag && /(^|[,\s])noindex([,\s]|$)/i.test(tag);
}

(async () => {
  console.log("APP HOST — every response must carry noindex");
  for (const p of APP_PATHS) {
    const { status, tag } = await robotsHeader(APP_HOST + p);
    if (isNoindex(tag)) {
      console.log(`  ok   ${p} -> ${status}, X-Robots-Tag: ${tag}`);
    } else {
      console.log(`  MISS ${p} -> ${status}, X-Robots-Tag: ${tag ?? "(absent)"}`);
      problems.push(`${APP_HOST}${p} does not send noindex — the CRM host stays indexable and the duplicates never drop out`);
    }
  }

  console.log("\nPUBLIC HOST — no response may carry noindex");
  for (const p of PUBLIC_PATHS) {
    const { status, tag } = await robotsHeader(PUBLIC_HOST + p);
    if (isNoindex(tag)) {
      console.log(`  FAIL ${p} -> ${status}, X-Robots-Tag: ${tag}`);
      problems.push(
        `CATASTROPHIC: ${PUBLIC_HOST}${p} sends "${tag}" — this de-indexes the public site. ` +
          `Check the host condition on the X-Robots-Tag rule in next.config.mjs.`
      );
    } else {
      console.log(`  ok   ${p} -> ${status}, no noindex`);
    }
  }

  console.log("\nROBOTS.TXT — Googlebot must still be able to FETCH the app /lending/ pages");
  const appRobots = await (await fetch(`${APP_HOST}/robots.txt`)).text();
  const pubRobots = await (await fetch(`${PUBLIC_HOST}/robots.txt`)).text();

  if (/^\s*Allow:\s*\/lending\//im.test(appRobots)) {
    console.log("  ok   app robots.txt allows /lending/ (so noindex is readable)");
  } else {
    console.log("  MISS app robots.txt does not allow /lending/");
    problems.push(
      `${APP_HOST}/robots.txt blocks /lending/ — Googlebot cannot re-fetch those URLs, ` +
        `so it can never see the noindex and the stale entries persist indefinitely`
    );
  }
  if (/^\s*Disallow:\s*\/\s*$/im.test(appRobots)) {
    console.log("  ok   app robots.txt keeps the rest of the CRM uncrawlable");
  } else {
    console.log("  MISS app robots.txt no longer disallows the rest of the CRM");
    problems.push(`${APP_HOST}/robots.txt lost its "Disallow: /" — the whole CRM became crawlable`);
  }
  if (/^\s*Disallow:\s*\/\s*$/im.test(pubRobots)) {
    console.log("  FAIL public robots.txt disallows everything");
    problems.push(`CATASTROPHIC: ${PUBLIC_HOST}/robots.txt contains "Disallow: /" — the public site is blocked from crawling`);
  } else {
    console.log("  ok   public robots.txt does not block the site");
  }

  if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nPASS — noindex is on the CRM host, off the public host, and readable by Googlebot.");
})();
