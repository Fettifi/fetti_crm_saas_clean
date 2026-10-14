// A PROMISE THE BROKER MADE OUT LOUD MUST SURVIVE A BUTTON PRESS.
//
// 2026-10-14. Ramon spoke to Andrej Strapko and agreed that nothing moves on his other four
// properties until 78 Oxford St in Rochester closes. The LOS had no way to know that. All four
// files sit active / Application with seven required documents outstanding and his email on the
// row — the exact shape "Remind All" sweeps up. One click would have sent that borrower four more
// chases on files his broker had just told him were parked.
//
// mayChaseDocs(status, stage) cannot carry this. Those columns say where a file IS; a hold says
// what we PROMISED. Setting stage to "Closed" to quiet the chaser would be a lie told to a pipeline
// report, so the hold is its own fact, with a reason and a date attached.
//
// This guard checks that both chase paths consult it — the bulk sweep AND the one-click reminder,
// because a single well-meant click breaks a promise just as thoroughly as a sweep does.
//
//   npm run verify:chase-hold
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nCHASE HOLD — a parked file is not chased\n");

const lib = code("lib/chaseHold.ts");
const all = code("app/api/los/remind-all/route.ts");
const one = code("app/api/los/files/[id]/remind/route.ts");

// 1. the hold carries a REASON — a silent hold becomes a mystery nobody dares lift
ck("a hold records why it exists", /reason: string/.test(lib));
ck("…and when", /at: string/.test(lib));
ck("…and what lifts it", /until\?: string \| null/.test(lib));

// 2. BOTH chase paths consult it
ck("the bulk sweep loads holds", /getChaseHolds\(\)/.test(all));
ck("…and skips a held file before sending", /holds\.get\(f\.id\)/.test(all) && /continue;/.test(all));
ck("…reporting the reason to the LO, not silently", /holdLabel\(hold\)/.test(all));
ck("the one-click reminder consults it too", /getChaseHold\(id\)/.test(one));
ck("…and refuses rather than sends", /status: 409/.test(one) && /Nothing was sent/.test(one));

// 3. ORDER: the hold must be checked BEFORE anything is dispatched
const allSend = all.indexOf("sendDocRequest(");
const allHold = all.indexOf("holds.get(f.id)");
ck("the sweep checks the hold BEFORE it sends", allHold >= 0 && allSend >= 0 && allHold < allSend,
  `hold@${allHold} send@${allSend}`);
const oneSend = one.indexOf("sendDocRequest(");
const oneHold = one.indexOf("getChaseHold(id)");
ck("the one-click checks the hold BEFORE it sends", oneHold >= 0 && oneSend >= 0 && oneHold < oneSend,
  `hold@${oneHold} send@${oneSend}`);

// 4. FAIL CLOSED. An unreadable hold must stop the chase, not wave it through — the cost of a
//    wrong skip is a late reminder; the cost of a wrong send is a broker breaking his word.
ck("an unreadable hold throws rather than returning empty", /throw new Error\("could not read chase holds"\)/.test(lib));

console.log(fail ? `\n❌ ${fail} check(s) failed — a parked file could still be chased\n`
                 : "\n✅ ALL PASS — neither the sweep nor the one-click can chase a file that is on hold\n");
process.exit(fail ? 1 : 0);
