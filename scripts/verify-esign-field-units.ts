// A SIGNATURE THAT LANDS OFF THE PAGE STILL REPORTS "COMPLETED".
//
// 2026-09-18, Magali Lopez Villafuerte. I sent a letter of explanation for UWM condition 7385 with
// fields {xPct: 12.4, yPct: 65.7, wPct: 41, hPct: 4} — percentages, which is precisely what a key named
// "xPct" invites. app/api/esign/sign/[token]/route.ts clamps to [0,0.98] / [0.05,0.6] / [0.02,0.2], so
// every value pinned to its maximum and pdf-lib drew her signature at x 599.76-966.96, y 834.81-875.91
// on a 612x792 page — entirely off the canvas. She signed. The envelope went to "completed". A
// Certificate of Completion was issued. The LOE itself showed a blank signature line, and I nearly
// uploaded it to the lender as executed.
//
// The defect was not the clamp; it was that the clamp answered a unit error with silence. This guard
// pins the refusal at the door, pins the clamp contract it depends on, and proves on the live data that
// no envelope carries out-of-range geometry.
//
//   npm run verify:esign-field-units
import "./_env";
import { readFileSync } from "fs";

const REQ = "app/api/esign/requests/route.ts";
const SIGN = "app/api/esign/sign/[token]/route.ts";
let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// The stamper's real arithmetic, copied from sign/[token]/route.ts so the geometry can be exercised
// without a PDF. If that math changes, the pinned-source checks below fail and this must be revisited.
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));
function placeOnPage(f: { xPct: number; yPct: number; wPct: number; hPct: number }, pw = 612, ph = 792) {
  const x = clamp(f.xPct, 0, 0.98) * pw;
  const bw = clamp(f.wPct, 0.05, 0.6) * pw;
  const bh = clamp(f.hPct, 0.02, 0.2) * ph;
  const yBottom = ph - clamp(f.yPct, 0, 0.98) * ph - bh;
  return { x, yBottom, bw, bh, onPage: x >= 0 && x + bw <= pw && yBottom >= 0 && yBottom + bh <= ph };
}

async function main() {
  console.log("\nE-SIGN FIELD UNITS — a fraction, not a percent\n");

  // ── 1. The geometry that actually happened. Percentages leave the page; fractions do not.
  {
    const asPercent = placeOnPage({ xPct: 12.4, yPct: 65.7, wPct: 41, hPct: 4 });
    ck("the exact values I sent place the box OFF the page (the 2026-09-18 defect, reproduced)",
      !asPercent.onPage, `x=${asPercent.x.toFixed(2)} w=${asPercent.bw.toFixed(2)} yBottom=${asPercent.yBottom.toFixed(2)}`);
    ck("…and x pins to the 0.98 clamp, which is where the signature was found", Math.abs(asPercent.x - 599.76) < 0.01);
    const asFraction = placeOnPage({ xPct: 0.124, yPct: 0.657, wPct: 0.41, hPct: 0.04 });
    ck("the same numbers ÷100 place the box ON the page", asFraction.onPage,
      `x=${asFraction.x.toFixed(2)} yBottom=${asFraction.yBottom.toFixed(2)}`);
  }

  // ── 2. The door is shut: ingest refuses > 1 rather than clamping it.
  {
    const src = code(REQ);
    ck(`${REQ} refuses field coordinates greater than 1`,
      /const badUnits = fields\.filter/.test(src) && /Number\(\(f as any\)\[k\]\) > 1/.test(src));
    const refuseAt = src.search(/if \(badUnits\.length\)/);
    const persistAt = src.search(/recipients, source_path/);
    ck("…BEFORE the envelope is persisted", refuseAt >= 0 && persistAt > refuseAt, `refuse@${refuseAt} persist@${persistAt}`);
    ck("…with a 400 and an actionable message naming the fix", /status: 400/.test(src) && /Divide by 100/.test(src));
    ck("…covering all four geometry keys", (["xPct", "yPct", "wPct", "hPct"] as const).every((k) => new RegExp(`"${k}"`).test(src)));
  }

  // ── 3. The clamp contract this guard's arithmetic mirrors is still what ships.
  {
    const src = code(SIGN);
    ck("the stamper still clamps xPct/yPct to 0.98", /Math\.min\(0\.98, Number\(f\.xPct\)/.test(src) && /Math\.min\(0\.98, Number\(f\.yPct\)/.test(src));
    ck("…wPct to 0.6 and hPct to 0.2", /Math\.min\(0\.6, Number\(f\.wPct\)/.test(src) && /Math\.min\(0\.2, Number\(f\.hPct\)/.test(src));
    ck("…and still maps y from the TOP (ph - yPct*ph - bh), the convention the sender lays out against",
      /ph - \(f\.yPct \|\| 0\) \* ph - bh/.test(src));
  }

  // ── 4. Live: no envelope carries geometry that would land off the page.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabaseAdmin } = await import("../lib/supabaseAdminClient");
      const { data, error } = await (supabaseAdmin as any).from("app_settings").select("key,value").like("key", "esign:%");
      if (error) throw error;
      // ONE KNOWN CASUALTY, NAMED AND DATED. The ingest refusal above makes new bad envelopes
      // impossible; this envelope predates it and CANNOT be voided — lib/esign.ts refuses to void a
      // completed envelope because a Certificate of Completion was already issued, and that refusal is
      // right: Magali really did sign. It is superseded by a corrected envelope instead. An entry here
      // requires a reason, so this list cannot grow quietly; anything NOT listed still fails.
      const KNOWN_BAD: Record<string, string> = {
        "Letter of Explanation - monthly parking charge (20353 Gault St)":
          "2026-09-18 percent-vs-fraction defect; signature drawn off-page; completed so un-voidable; " +
          "superseded by a corrected envelope re-sent to Magali the same day. Never send its output to a lender.",
      };
      const bad: string[] = []; let known = 0;
      for (const r of data || []) {
        let v: any; try { v = JSON.parse(r.value); } catch { continue; }
        for (const f of v.fields || []) {
          if ((["xPct", "yPct", "wPct", "hPct"] as const).some((k) => Number((f as any)[k]) > 1)) {
            if (!KNOWN_BAD[String(v.title)]) bad.push(`${String(v.title).slice(0, 44)} (${v.status})`);
            else known++;
            break;
          }
        }
      }
      ck(`no UNKNOWN envelope has out-of-range field geometry (${(data || []).length} checked, ${known} known-bad)`,
        bad.length === 0, bad.join("; "));
      for (const [title, why] of Object.entries(KNOWN_BAD)) console.log(`  ⚪ known casualty: ${title.slice(0, 52)} — ${why.slice(0, 96)}…`);
    } catch (e: any) { ck("live envelope check ran", false, e?.message || String(e)); }
  } else {
    console.log("  ⚪ live envelope check skipped (no database in this environment)");
  }

  console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — percentages are refused at the door; a signed document cannot come back blank\n");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
