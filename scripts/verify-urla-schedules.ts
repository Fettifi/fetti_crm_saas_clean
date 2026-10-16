// THE SIGNED 1003 MUST CARRY EVERY ROW THE MISMO CARRIES.
//
// 2026-10-16. lib/urlaPdf.ts took a hard slice on all three schedules:
//     const assets = (u.assets || []).slice(0, 6);
//     const liabs  = (u.liabilities || []).slice(0, 6);
//     const reo    = (u.reo || []).slice(0, 4);
// and printed nothing to say more existed. The MISMO export is built from the SAME Urla object and
// carries all of them — so a borrower signed a 1003 omitting liabilities while the data file sent to
// that same underwriter listed them.
//
// An omitted liability understates DTI on an instrument the borrower ATTESTS to. A signed document
// and its data file disagreeing is an underwriting and compliance problem, not a formatting one.
//
// Measured on a 9-asset / 11-liability / 7-REO borrower before the fix: 6/9, 6/11, 4/7.
//
// `row()` already calls `ensure()`, so the rows paginate on their own and the slices were pure loss.
// `schedule()` now also re-prints the column header after a break, so a continued schedule is not
// an unlabelled block of figures on the next page.
//
// THIS GUARD RENDERS THE REAL PDF AND COUNTS WHAT CAME OUT. A regex on `.slice(` would prove the
// text was deleted, not that every row reaches the paper — and the whole defect was a document that
// looked complete. [[things-that-look-like-they-work]] · [[a-bundle-is-not-a-document]]
//
//   npx tsx scripts/verify-urla-schedules.ts            # 0 clean · 1 defect
import { buildUrlaPdf } from "../lib/urlaPdf";
import { PDFDocument } from "pdf-lib";
import zlib from "zlib";

// Distinctive, non-colliding tokens so a miss cannot hide behind ordinary text.
const N_ASSET = 9, N_LIAB = 11, N_REO = 7;

const sample: any = {
  borrowers: [{ firstName: "Schedule", lastName: "Overflow" }],
  assets: Array.from({ length: N_ASSET }, (_, i) => ({
    type: "Checking", institution: `ZASSETINST${i + 1}`, accountNumber: `****${i}`, balance: 1000 * (i + 1) })),
  liabilities: Array.from({ length: N_LIAB }, (_, i) => ({
    type: "Credit Card", creditor: `ZCREDITOR${i + 1}`, balance: 500 * (i + 1), monthlyPayment: 25 * (i + 1) })),
  reo: Array.from({ length: N_REO }, (_, i) => ({
    address: { street: `${i + 1} ZREOSTREET Ave`, city: "Rochester", state: "NY", zip: "14618" },
    presentValue: 100000, monthlyMortgage: 900, status: "Retained", monthlyRentalIncome: 1500, mortgageBalance: 60000 })),
};

/** Count how many of the generated tokens survived to the rendered page text. */
export function countPresent(text: string, prefix: string, n: number, suffix = ""): number {
  let found = 0;
  for (let i = 1; i <= n; i++) if (text.includes(suffix ? `${i}${suffix}` : `${prefix}${i}`)) found++;
  return found;
}

// pdf-lib cannot extract text, and the content streams are Flate-compressed — so searching the
// saved bytes directly finds NOTHING and reports a perfect document as totally empty. The first
// version of this guard did exactly that and printed 0/9, 0/11, 0/7 on a PDF that PyMuPDF read as
// 9/9, 11/11, 7/7. A guard that cannot see the thing it measures fails in the ALARMING direction
// here, which is survivable — but it would have been indistinguishable from the real defect.
// Inflate every stream, then look for the tokens in the decompressed operators.
export function textOf(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = raw.toString("latin1");                 // uncompressed streams, if any
  const marker = Buffer.from("stream", "latin1");
  const endMarker = Buffer.from("endstream", "latin1");
  let i = 0;
  for (;;) {
    let s = raw.indexOf(marker, i);
    // "endstream" CONTAINS "stream". Matching it restarts the scan mid-keyword, which silently
    // desynchronises every stream after the first — the run that produced 0/9 inflated exactly
    // ONE stream and failed on four, so it was reading page 1 of a 4-page document and calling
    // the rest missing. Skip any match that is the tail of "endstream".
    while (s >= 3 && raw.subarray(s - 3, s).toString("latin1") === "end") s = raw.indexOf(marker, s + 1);
    if (s < 0) break;
    let b = s + marker.length;
    if (raw[b] === 0x0d) b++;
    if (raw[b] === 0x0a) b++;
    const e = raw.indexOf(endMarker, b);
    if (e < 0) break;
    try { out += zlib.inflateSync(raw.subarray(b, e)).toString("latin1"); } catch { /* not Flate */ }
    i = e + endMarker.length;
  }
  // pdf-lib draws text as HEX strings, not literal parens:
  //   <556E69666F726D205265736964656E7469616C> Tj   =   "Uniform Residential"
  // so searching the inflated operators for "ZCREDITOR1" finds nothing until the hex is decoded.
  // Missing this is what made the first run report 0/9 on a correct document.
  return out.replace(/<([0-9A-Fa-f\s]+)>/g, (_m, hex) => {
    const clean = String(hex).replace(/\s+/g, "");
    if (clean.length % 2) return _m;
    try { return Buffer.from(clean, "hex").toString("latin1"); } catch { return _m; }
  });
}

async function run() {
  const bytes = await buildUrlaPdf(sample);
  const doc = await PDFDocument.load(bytes);
  const text = textOf(bytes);

  const a = countPresent(text, "ZASSETINST", N_ASSET);
  const l = countPresent(text, "ZCREDITOR", N_LIAB);
  const r = countPresent(text, "", N_REO, " ZREOSTREET");

  const checks: [string, boolean, string][] = [
    [`2a assets — every row printed`, a === N_ASSET, `${a}/${N_ASSET}`],
    [`2c liabilities — every row printed`, l === N_LIAB, `${l}/${N_LIAB}`],
    [`3a REO — every row printed`, r === N_REO, `${r}/${N_REO}`],
    [`the document grew to hold them`, doc.getPageCount() >= 2, `${doc.getPageCount()} page(s)`],
    // Guard the guard: if the sample ever stopped exceeding the old caps, this would pass vacuously.
    [`the sample still exceeds the old caps (6/6/4)`, N_ASSET > 6 && N_LIAB > 6 && N_REO > 4,
      `${N_ASSET}/${N_LIAB}/${N_REO}`],
  ];

  console.log(`\nURLA SCHEDULES — rendered ${bytes.length} bytes, ${doc.getPageCount()} page(s)\n`);
  let bad = 0;
  for (const [n, ok, d] of checks) { if (!ok) bad++; console.log(`  ${ok ? "✅" : "❌"} ${n} — ${d}`); }
  if (!bad) { console.log("\n✅ CLEAN — the signed 1003 carries every schedule row the MISMO does.\n"); process.exit(0); }
  console.log("\n❌ A SIGNED 1003 IS DROPPING ROWS the MISMO sends to the same lender.\n");
  process.exit(1);
}
run();
