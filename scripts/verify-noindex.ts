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

// Borrower-private token surfaces. Every one of these returned 200 with NO robots meta on
// 2026-08-12 — e-sign pages, document portals and card-authorization forms, all silently
// indexable if a link ever escaped. One representative token per route family; the token does not
// need to resolve to a real record, because the noindex comes from the route's layout and is
// therefore emitted whether or not the token is valid. That is exactly the property to assert.
const PRIVATE_PATHS = [
  "/file/verify-noindex-probe",
  "/sign/verify-noindex-probe",
  "/letter/verify-noindex-probe",
  "/optin/verify-noindex-probe",
  "/card-auth/verify-noindex-probe",
  "/connect/verify-noindex-probe",
  "/portal/verify-noindex-probe",
];

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

  // A meta tag counts here as well as a header: these routes carry it via each family's
  // layout.tsx (`robots: { index: false }`), which Next renders into <meta name="robots">.
  console.log("\nPRIVATE BORROWER ROUTES — every one must be noindex");
  for (const p of PRIVATE_PATHS) {
    const r = await fetch(PUBLIC_HOST + p, { redirect: "manual" });
    const header = r.headers.get("x-robots-tag");
    const html = r.status === 200 ? await r.text() : "";
    const meta = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i.exec(html);
    const directive = isNoindex(header) ? `header: ${header}` : meta && /noindex/i.test(meta[1]) ? `meta: ${meta[1]}` : null;
    // A redirect or a 404 is also a safe outcome — there is no indexable body to worry about.
    const safeStatus = r.status !== 200;
    if (directive || safeStatus) {
      console.log(`  ok   ${p} -> ${r.status}${directive ? `, ${directive}` : " (no indexable body)"}`);
    } else {
      console.log(`  MISS ${p} -> 200 with NO noindex`);
      problems.push(
        `${PUBLIC_HOST}${p} returns 200 with no noindex — a borrower e-sign/document/card-auth page ` +
          `is indexable if its link ever escapes into a crawlable surface`
      );
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

  // Not strictly a noindex property, but it belongs with the other LIVE-SITE invariants rather
  // than in the static verify:seo, because the only way to know what the homepage actually links
  // to is to fetch it. On 2026-08-12 the homepage linked to seven /lending pages and every one
  // was noindex, while the indexable pages got none — the highest-authority URL on the domain
  // spending all of its lending equity on pages that cannot rank.
  // The auth gate and the crawl rules must agree. They are now built from one array
  // (lib/routeAccess.ts), and this asserts the SERVED robots.txt actually reflects it — the two
  // hand-maintained lists had already drifted by 24 routes, every one of them crawlable and
  // spending crawl budget on a 307 to a disallowed /login.
  console.log("\nROBOTS.TXT — every login-gated route must be disallowed");
  const { PROTECTED_ROUTES } = await import("../lib/routeAccess");
  const missing = PROTECTED_ROUTES.filter((r) => !new RegExp(`^\\s*Disallow:\\s*${r}\\s*$`, "im").test(pubRobots));
  if (missing.length) {
    console.log(`  MISS ${missing.length} gated route(s) absent from robots.txt: ${missing.join(" ")}`);
    problems.push(
      `robots.txt does not disallow ${missing.length} login-gated route(s) (${missing.join(", ")}) — ` +
        `Googlebot crawls each one and earns a 307 to /login, spending budget the money pages need`
    );
  } else {
    console.log(`  ok   all ${PROTECTED_ROUTES.length} gated routes disallowed`);
  }

  console.log("\nHOMEPAGE — must link every indexable lending page");
  const { INDEXABLE_LENDING_SLUGS } = await import("../lib/seoIndexable");
  const homeHtml = await (await fetch(PUBLIC_HOST + "/")).text();
  for (const slug of INDEXABLE_LENDING_SLUGS) {
    if (homeHtml.includes(`/lending/${slug}`)) {
      console.log(`  ok   links /lending/${slug}`);
    } else {
      console.log(`  MISS no homepage link to /lending/${slug}`);
      problems.push(
        `the homepage does not link /lending/${slug} — an indexable page getting no link from the ` +
          `domain's strongest URL, while the noindex program pages get several`
      );
    }
  }

  if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nPASS — noindex is on the CRM host, off the public host, and readable by Googlebot.");
})();
