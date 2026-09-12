// IDENTIFY DOCUMENTS SITTING ON DISK — the same engine the CRM runs, pointed at a local folder.
//
// Useful before a lender upload: read what each file in a staging folder actually is, rather than
// trusting the names. The names are why this exists — `W-2s — last 2 years.jpg` in Joseph Hixon's
// file is his driver's licence.
//
//   npm run identify -- "/path/to/a.pdf" "/path/to/b.jpg"
//   npm run identify -- "<loan folder>"/*.pdf
import "./_env";
import { readFileSync } from "fs";
import { basename, extname } from "path";
import { identifyDocument, checkAgainstSlot, mayRelabel } from "../lib/docIdentify";

const D = "/Users/fetti/Fetti Loan Files/Joseph Hixon — FF-202608-1250/";
const FILES = process.argv.slice(2);
const mt = (f: string) => ({ ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" } as any)[extname(f).toLowerCase()] || "";

(async () => {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  console.log(key ? "key: present\n" : "key: MISSING\n");
  for (const f of FILES) {
    const path = f.startsWith("/") ? f : D + f;
    const buf = readFileSync(path);
    const t0 = Date.now();
    const ident = await identifyDocument({ buf, fileName: basename(path), mediaType: mt(path), apiKey: key });
    const slot = checkAgainstSlot(basename(path, extname(path)), ident);
    console.log(`── ${basename(path)}  (${(buf.length / 1048576).toFixed(2)}MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`   kind      : ${ident.kind}  [${ident.confidence}, via ${ident.method}]`);
    console.log(`   LABEL     : ${ident.label ?? "(none — " + ident.reason + ")"}`);
    console.log(`   category  : ${ident.category ?? "-"}`);
    const d: any = ident.details;
    const shown = Object.entries(d).filter(([, v]) => v !== null && v !== undefined);
    if (shown.length) console.log(`   fields    : ${shown.map(([k, v]) => `${k}=${Array.isArray(v) ? "[" + v.join(" | ") + "]" : v}`).join(", ")}`);
    if (ident.evidence.length) console.log(`   evidence  : ${ident.evidence.join(" · ")}`);
    console.log(`   vs slot   : ${slot.verdict}${(slot as any).message ? " — " + (slot as any).message : ""}`);
    console.log(`   relabel?  : ${mayRelabel(basename(path), basename(path)) ? "yes (machine name)" : "no (human name)"}`);
    console.log();
  }
})();
