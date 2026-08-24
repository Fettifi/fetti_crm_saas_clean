// A CALLER'S NAME IS WHAT THEY SAID, NOT THE REST OF THE SENTENCE.
//
// 2026-08-23. Ramon phoned Penny to RSVP and the message came back filed under
// "Ray. I Was" — from the transcript line "This is Ray. I was calling to make sure that...".
// The extractor takes up to three words after "this is" and allows a period INSIDE a word so
// that initials survive ("J. R. Smith"), which meant a SENTENCE BOUNDARY read as part of the
// name. Every phone message from that caller is then addressed to a person who does not exist.
//
//   npx tsx scripts/verify-caller-name.ts
import { extractCallerName } from "../app/api/voice/ingest/route";

const CASES: [string, string | undefined][] = [
  // The real one, verbatim from call CA8cda14d335d5cba0d81f3bee8086a809.
  ["Caller: This is Ray. I was calling to make sure that...", "Ray"],
  ["Caller: This is Ray", "Ray"],
  ["Caller: My name is Dana Whitfield and I saw your ad", "Dana Whitfield"],
  ["Caller: my name is J. R. Smith", "J. R. Smith"],        // initials must survive
  ["Caller: This is Mike from Countrywide", "Mike"],
  ["Caller: It's about a refinance", undefined],            // not a name
  ["Penny: This is Penny with Fetti", undefined],           // never read Penny's own words
  ["Caller: I'm calling about my loan", undefined],
];

let bad = 0;
console.log("\nCALLER NAME EXTRACTION\n");
for (const [transcript, want] of CASES) {
  const got = extractCallerName(transcript);
  const pass = got === want;
  if (!pass) bad++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${JSON.stringify(transcript.slice(0, 56))} -> ${JSON.stringify(got)}${pass ? "" : `  (expected ${JSON.stringify(want)})`}`);
}
console.log(bad === 0 ? "\nall passed\n" : `\n${bad} FAILED\n`);
process.exit(bad === 0 ? 0 : 1);
