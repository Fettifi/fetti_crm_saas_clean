// DRAG A FILE OUT OF THE LOS — INTO AN EMAIL, A PORTAL, THE DESKTOP.
//
// Ramon, 2026-08-06: "I want to be able to drag the files directly out of the LOS into emails and
// portals… I don't wanna have to save them in another file folder considering they're already
// saved in my system."
//
// Chromium's ONLY mechanism for this is the `DownloadURL` drag flavour:
//     <mime>:<filename>:<absolute-url>
// On drop, Chrome fetches that URL itself and hands the target app a real file. Three details
// decide whether it works at all, and each is silent when wrong:
//
//   · the URL must be ABSOLUTE. A relative path is accepted by setData and simply never resolves,
//     so the drag looks fine and drops nothing.
//   · the FILENAME must not contain a colon. Chrome splits the payload on colons, so "Scan:2.pdf"
//     truncates the URL and the drop dies.
//   · the URL must be SAME-ORIGIN, so the staff session cookie rides along. A Supabase signed URL
//     would work too, but it cannot be minted inside dragstart — that handler is synchronous, and
//     an awaited fetch there produces an empty dataTransfer.
//
//   npx tsx scripts/verify-doc-dragout.ts
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const src = readFileSync("app/los/[id]/page.tsx", "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nDRAG-OUT FROM THE LOS\n");

console.log("the drag carries a file, not just a link:");
chk(/setData\("DownloadURL",/.test(code), "dragstart sets the DownloadURL flavour Chromium needs to materialise a file");
chk(/\$\{docMime\(fileName\)\}:\$\{fileName\}:\$\{url\}/.test(code),
  "in the exact <mime>:<filename>:<url> order — any other arrangement is silently ignored");

console.log("\nthe three things that fail silently:");
chk(/\$\{window\.location\.origin\}\/api\/los\/files\//.test(code),
  "the URL is ABSOLUTE — a relative path drops nothing and reports no error");
chk(/replace\(\/\[:\\r\\n"\\\\\/\]\/g, "-"\)/.test(code) || /replace\(\/\[:[^)]*\]\/g, "-"\)/.test(code),
  "the filename is stripped of colons (and slashes/quotes/newlines) before it goes in the payload");
chk(/\/api\/los\/files\/\$\{id\}\/docs\?doc_id=/.test(code),
  "and points at our own same-origin route, so the existing session gate still authorises it");
chk(!/await[^\n]*dataTransfer|dataTransfer[^\n]*await/.test(code),
  "nothing is awaited inside dragstart — an async handler yields an empty drag");

console.log("\nonly real files are draggable:");
chk(/draggable=\{!!d\.storage_path\}/.test(code), "a checklist row with no uploaded file is not draggable");
chk(/if \(!d\.storage_path\) \{ e\.preventDefault\(\); return; \}/.test(code),
  "and the handler refuses too, so nothing can drag an empty placeholder");

console.log("\nthe LO can tell it is draggable:");
chk(/cursor-grab/.test(code), "the row shows a grab cursor");
chk(/Drag this file straight into an email/.test(src), "and says so on hover");

console.log("\nthe filename is meaningful to whoever receives it:");
chk(/d\.file_name \|\| `\$\{d\.name\}\./.test(code),
  "it uses the uploaded file's real name, falling back to the checklist label + extension");
chk(/docMime\(name: string\)/.test(code) && /application\/pdf/.test(code) && /image\/jpeg/.test(code),
  "and declares a real MIME type so the receiving app opens it correctly");

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). A drag that silently drops nothing is worse than no drag: he will try it in front of a client.\n`);
  process.exit(1);
}
console.log("PASS — documents drag out as real files, authorised by the same session, with their own names.");
console.log("       NOT provable here: the OS-level drop itself. Chromium only; one file per drag.\n");
