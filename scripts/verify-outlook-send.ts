// THE ADD-IN MAY NEVER EMAIL AN ADDRESS RAMON DID NOT SAY.
//
// 2026-08-10, Ramon asked for the Outlook dictate add-in to have email capabilities: speak a
// note, and it addresses and sends the message rather than only dropping text in the body.
//
// That makes one failure mode intolerable. Asked "who is this to", a language model will happily
// produce a plausible address for a named person — carl@lendingpros.com for "Carl at Lending
// Pros". The mail then leaves under a licensed mortgage originator's identity, to a stranger,
// possibly containing a borrower's details, and the bounce goes somewhere he never sees.
//
// So the model's answer is not trusted. It is intersected with the addresses that appear
// LITERALLY in the dictated note. This guard exercises the SHIPPING function — the same
// vetSpokenAddresses the API route calls — on cases that would have leaked.
//
//   npm run verify:outlook-send
import { readFileSync } from "fs";
import { vetSpokenAddresses } from "../lib/outlookEmail";

let failed = 0;
const chk = (ok: boolean, msg: string) => { console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`); if (!ok) failed++; };
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log("\nOutlook add-in — addressing and sending\n");

// 1. THE ONE THAT MATTERS. The note names a person and gives no address; the model invents one.
chk(eq(vetSpokenAddresses("email carl at lending pros about the bank statements", ["carl@lendingpros.com"]), []),
  "an address invented for a named person is dropped, not emailed");

// 2. A real dictated address survives.
chk(eq(vetSpokenAddresses("send this to carl.winston@example.com please", ["carl.winston@example.com"]), ["carl.winston@example.com"]),
  "an address actually spoken is kept");

// 3. Transcription casing must not defeat the check.
chk(eq(vetSpokenAddresses("send it to Carl.Winston@Example.com", ["carl.winston@EXAMPLE.com"]), ["carl.winston@example.com"]),
  "matching is case-insensitive, so casing cannot smuggle or block an address");

// 4. A partly-invented list keeps only the real one.
chk(eq(vetSpokenAddresses("cc sarah@fettifi.com and also loop in bob", ["sarah@fettifi.com", "bob@fettifi.com"]), ["sarah@fettifi.com"]),
  "a mixed list keeps the spoken address and drops the invented one");

// 5. Shapes the model actually returns: a comma string, angle brackets, duplicates.
chk(eq(vetSpokenAddresses("to a@b.com and a@b.com", "<a@b.com>, a@b.com"), ["a@b.com"]),
  "comma strings, angle brackets and duplicates are all normalised");

// 6. Nothing spoken means nothing addressed — silence must not become a guess.
chk(eq(vetSpokenAddresses("tell the underwriter we will have it tomorrow", ["underwriter@lender.com"]), []),
  "a note with no address yields no recipients at all");

// 7. Garbage in must not throw or leak.
chk(eq(vetSpokenAddresses("", null), []) && eq(vetSpokenAddresses("a@b.com", undefined), []),
  "null/undefined candidates are handled without throwing");

// --- WIRING: the properties above are worthless if the route or the pane bypasses them --------
const route = readFileSync("app/api/outlook/compose/route.ts", "utf8");
chk(/vetSpokenAddresses\(transcript, parsed\.to\)/.test(route) && /vetSpokenAddresses\(transcript, parsed\.cc\)/.test(route),
  "the compose route runs BOTH to and cc through the vetting function");
chk(/\{ subject, body, to, cc \}/.test(route),
  "the route returns the vetted recipients to the add-in");

const pane = readFileSync("public/outlook/taskpane.html", "utf8");
chk(/isSetSupported\("Mailbox","1\.15"\)/.test(pane),
  "sending is capability-checked, so an older Outlook is told rather than silently failing");
chk(/item\.sendAsync\(/.test(pane) && /item\.to\.setAsync\(/.test(pane),
  "the pane addresses the message and sends it through Office.js");
chk(/confirm\("Send this email to "/.test(pane),
  "a send is confirmed against the actual recipient list before it goes");

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nAll checks passed.\n");
process.exit(failed ? 1 : 0);
