// A CARD AUTHORIZATION WITHOUT A DOLLAR CEILING MUST NEVER REACH A BORROWER.
//
// 2026-08-06, Ramon: "The credit card link is not working when I try and send it to an additional
// borrower… Also, it's saying it's expired."
//
// It had not expired. FF-202607-6368 was sent with amount 0, because the LO panel and the send
// route both did `Number(...) || 0` and the amount box was blank. blanketAuthText refuses to
// generate uncapped authorization language — correctly, there is no safe version of it — so it
// THREW inside the public GET, which had no try/catch, which returned 500, which the borrower page
// rendered as "This authorization link is invalid or has expired."
//
// Proven against production before the fix: the same endpoint returned 200 for a file with a $200
// ceiling and 500 for the file with 0. The borrower was shown a reason that was not true, about a
// document that authorises charges against their card.
//
// Four layers, because any one of them alone leaves the failure reachable:
//   1. the LO panel refuses to fire      — the LO can still fix it
//   2. the send route refuses to send    — nothing broken is ever delivered
//   3. the public route answers honestly — 409 + reason, never a 500 read as "expired"
//   4. the page shows the server's words — no more collapsing every failure into "expired"
//
//   npx tsx scripts/verify-card-auth.ts
import { readFileSync } from "fs";
import { blanketAuthText } from "../lib/cardAuth";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nCARD AUTHORIZATION — NO CEILING, NO LINK\n");

// ── the invariant the whole thing rests on ───────────────────────────────────────────────────
console.log("the signed language still refuses to go uncapped:");
let threw = false;
try { blanketAuthText("FF-TEST-0001", 0); } catch { threw = true; }
chk(threw, "blanketAuthText(…, 0) THROWS rather than authorising charges with no limit");
let ok200 = "";
try { ok200 = blanketAuthText("FF-TEST-0001", 200); } catch { /* */ }
chk(/up to a total of \$200\./.test(ok200), "and a real ceiling produces language that states it — “up to a total of $200.”");
chk(/BLANKET authorization/.test(ok200) && /revoke it in writing/.test(ok200),
  "the instrument still says what it is and how to revoke it");

// ── 1. the LO panel ──────────────────────────────────────────────────────────────────────────
console.log("\nthe LO cannot send a blank amount:");
const panel = code("components/los/CardAuthPanel.tsx");
chk(/if \(!\(amt > 0\) && !\(existing > 0\)\)/.test(panel),
  "the panel checks the typed amount AND any amount already on the record before sending");
chk(/rows\.find\(\(x\) => x\.index === i\)/.test(panel),
  "and finds the borrower BY INDEX, not by position in the array");

// ── 2. the send route ────────────────────────────────────────────────────────────────────────
console.log("\nthe server refuses to deliver an uncapped authorization:");
const send = code("app/api/los/files/[id]/card-auth/route.ts");
const sendBranch = (send.match(/if \(body\.action === "send"\)[\s\S]*?const appUrl =/) || [""])[0];
chk(/if \(!\(amt > 0\)\) \{/.test(sendBranch),
  "the send branch itself rejects amount ≤ 0 — before the record is written or a link built");
chk(/status: 422/.test(sendBranch), "with a 422 the panel can show, not a silent success");
const iRefuse = sendBranch.indexOf("if (!(amt > 0))");
const iPersist = sendBranch.indexOf("persistCardAuthEntry");
// Both must be FOUND. indexOf returns -1 when absent, and -1 < anything reads as "in order".
chk(iRefuse >= 0 && iPersist >= 0 && iRefuse < iPersist,
  `and it refuses BEFORE persisting — a broken request is never stored (refuse@${iRefuse}, persist@${iPersist})`);

// ── 3. the public route ──────────────────────────────────────────────────────────────────────
console.log("\nthe borrower is told the truth:");
const pub = code("app/api/card-auth/[token]/route.ts");
chk((pub.match(/reason: "missing_amount"/g) || []).length >= 2,
  "BOTH the GET and the POST answer a missing ceiling with a specific reason");
chk(/status: 409/.test(pub), "as a 409 — distinguishable from the 404 that really does mean invalid/expired");
const gate = pub.indexOf('reason: "missing_amount"');
chk(gate > 0 && gate < pub.indexOf("blanketAuthText(r.file.file_number"),
  "the check runs BEFORE blanketAuthText — so it can no longer throw a 500 at a borrower");
chk(!/isn't ready yet[\s\S]{0,120}expired/.test(pub),
  "and the missing-ceiling message never uses the word “expired”");

// ── 4. the page ──────────────────────────────────────────────────────────────────────────────
console.log("\nthe page stops inventing a reason:");
const page = code("app/card-auth/[token]/page.tsx");
chk(/setLoadErr\(j\?\.error \|\| ""\)/.test(page),
  "it captures the server's own message on a failed load");
chk(/\{loadErr \|\| "This authorization link is invalid or has expired/.test(page),
  "and shows it — falling back to “invalid or expired” only when the server gave no reason");

console.log("");
if (bad) {
  console.error(`FAIL — ${bad} problem(s). A borrower told their link “expired” will not call back; they will assume we are disorganised, about a document that charges their card.\n`);
  process.exit(1);
}
console.log("PASS — no path can deliver an uncapped card authorization, and no failure is reported as an expiry that did not happen.\n");
