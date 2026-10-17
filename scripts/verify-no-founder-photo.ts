// NO PHOTOGRAPH OF RAMON ON ANY PUBLIC PAGE.
//
// Ramon, 2026-10-17, plainly: **"Don't put my actual picture on the website."**
//
// He said it while I was proposing to build a founder-led section on the homepage. The instruction
// is about the END STATE, not about the page I happened to be discussing — and when he said it,
// `/ramon-dent.jpg` was already live on `/about`, floated right beside the founder paragraph. So it
// came off that page too.
//
// WHY THIS IS A GUARD AND NOT A NOTE. Every creative direction for a lender's site reaches for a
// founder photo eventually — it is the standard answer to "this page has no people on it", which is
// a real weakness of the current design and one I have already written down. The next person to
// work on this page, including me in a week, will have a good reason to add it back. A preference
// stated once in conversation does not survive that; a failing build does.
//
// SCOPE: public marketing routes only. The asset stays in /public and is used internally; this does
// not police the CRM, the LOS, or anything behind a login. It also deliberately does not try to
// detect "a photo of Ramon" in general — it asserts the specific known asset, plus any obvious
// rename of it, which is what a careless re-add would actually look like.
//
//   npm run verify:no-founder-photo
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nFOUNDER PHOTO — Ramon asked for his picture not to be on the site.\n");

// The asset itself, and the shapes a rename would plausibly take.
export const FOUNDER_IMAGE_RE = /ramon[-_.]?dent\s*\.(jpg|jpeg|png|webp|avif)|\/ramon\.(jpg|jpeg|png|webp|avif)|founder[-_]?(photo|headshot|portrait)\.(jpg|jpeg|png|webp|avif)/i;

/** Every .tsx/.ts under a public marketing route. Walks, so a new page is covered automatically. */
function publicPages(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // Skip the authenticated app surfaces — this is about the PUBLIC site.
      if (/^(api|los|admin|underwriter|studio|dashboard|scout|photos)$/.test(e)) continue;
      publicPages(p, out);
    } else if (/\.(tsx|ts)$/.test(e)) out.push(p);
  }
  return out;
}

const pages = publicPages("app").concat(publicPages("components"));
// ANTI-VACUOUS: a broken walk would pass this guard trivially.
ck(`the page roster is non-empty (${pages.length} file(s) scanned)`, pages.length > 20,
   pages.length <= 20 ? "the directory walk is broken, not the site" : "");

const offenders: string[] = [];
for (const f of pages) {
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  // Strip comments first — THIS FILE AND app/about/page.tsx both NAME the asset in prose explaining
  // why it is gone. A guard that fires on its own documentation teaches people to delete the
  // documentation, which is the thing that preserves the reason.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
                  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  if (FOUNDER_IMAGE_RE.test(code)) offenders.push(f);
}

ck("no public page references a photograph of Ramon", offenders.length === 0,
   offenders.length ? `found in ${offenders.join(", ")} — he asked for this not to be on the site` : "");

// And prove the matcher actually matches, so a typo in the regex cannot quietly pass everything.
ck("…and the matcher is live (recognises the real filename)", FOUNDER_IMAGE_RE.test('src="/ramon-dent.jpg"'));
ck("…including a plausible rename", FOUNDER_IMAGE_RE.test('src="/founder-headshot.png"'));
ck("…and does NOT fire on the mascot or the emblem",
   !FOUNDER_IMAGE_RE.test('src="/mark-golden-owl.png"') && !FOUNDER_IMAGE_RE.test('src="/fetti-emblem.png"'));

console.log(fail ? `\n❌ verify:no-founder-photo — ${fail} check(s) failed\n`
                 : `\n✅ verify:no-founder-photo — no photograph of Ramon on the public site\n`);
process.exit(fail ? 1 : 0);
