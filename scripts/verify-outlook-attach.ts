// ATTACH LOAN DOCUMENTS FROM INSIDE OUTLOOK.
//
// Ramon, 2026-08-06: "Trying to drop it in a Outlook file is not working."
//
// The drag-out shipped earlier works into Finder and Mail, because Chromium hands the OS a
// PROMISED file and those apps resolve promises. Outlook does not do so reliably, and Outlook on
// the web cannot receive it at all — a drag between two browser tabs never materialises a File
// for the receiving page. No amount of fixing the drag changes either fact.
//
// Outlook's own mechanism is Office.js `item.addFileAttachmentAsync(uri, name)`: Outlook fetches
// the URI itself and embeds a real attachment. The trap is WHOSE credentials do that fetch —
// Office carries none of ours, so a session-gated URL 401s and the attachment silently fails.
//
//   npx tsx scripts/verify-outlook-attach.ts
import { readFileSync } from "fs";

let bad = 0;
const chk = (c: boolean, m: string) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) bad++; };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const route = strip(readFileSync("app/api/outlook/attach/route.ts", "utf8"));
const pane = readFileSync("public/outlook/taskpane.html", "utf8");
const proxy = strip(readFileSync("proxy.ts", "utf8"));

console.log("\nATTACH FROM OUTLOOK\n");

console.log("the URL Outlook fetches does not need our session:");
chk(/createSignedUrl\(/.test(route), "documents are handed over as SIGNED storage URLs, not session-gated app routes");
chk(!/\/api\/los\/files\//.test(route), "and never as a /api/los/... URL, which would 401 for Office and fail silently");
chk(/SIGNED_TTL_SECONDS = \d+/.test(route) && Number((route.match(/SIGNED_TTL_SECONDS = (\d+)/) || [])[1]) <= 3600,
  "the signature is short-lived (an hour or less), so a leaked link dies quickly");

console.log("\none bad document cannot hide the rest:");
chk(/for \(const d of uploaded\)/.test(route) && /createSignedUrl\(/.test(route),
  "each path is signed INDIVIDUALLY — createSignedUrls (plural) fails the whole batch on one missing object");
chk(/continue;/.test(route), "an unreachable file is skipped, not fatal");
chk(/skipped:/.test(route), "and the count of skipped files is reported rather than swallowed");

console.log("\nthe endpoint is authorised, and not by a session:");
chk(/requireAddinAuth\(req\)/.test(route), "it uses the add-in Bearer gate");
chk(/const denied = await requireAddinAuth\(req\);\s*if \(denied\) return denied;/.test(route),
  "and returns immediately when that gate denies — fail closed");
chk(!/'\/api\/outlook'/.test(proxy) && !/"\/api\/outlook"/.test(proxy),
  "proxy.ts does NOT session-gate /api/outlook — Outlook has no CRM session, it carries the key");

console.log("\nthe task pane attaches correctly:");
chk(/addFileAttachmentAsync\(d\.url, d\.name,/.test(pane), "it calls addFileAttachmentAsync with the signed URL and a real filename");
// Match the RECURSIVE CALL, not the definition. `function afAttach(list, done, okCount, failed){`
// satisfies a bare-name regex, so deleting every call site left this green — the eighth vacuous
// assertion of this kind. The trailing semicolon and the absence of `function ` are the difference.
chk(/(?<!function )afAttach\(list, done, okCount, failed\);/.test(pane),
  "attachments go one at a time — Outlook drops concurrent addFileAttachmentAsync calls, silently");
chk(/typeof item\.addFileAttachmentAsync !== "function"/.test(pane),
  "and it says so plainly when the pane is open on a read item instead of a compose window");
chk(/Attached \" \+ ok \+ \" document/.test(pane) || /✓ Attached/.test(pane), "success reports how many actually attached");
chk(/failed\.length/.test(pane), "and failures are surfaced, not counted as success");

console.log("");
if (bad) { console.error(`FAIL — ${bad} problem(s). An attachment that silently doesn't attach is worse than an error: he will send the email anyway.\n`); process.exit(1); }
console.log("PASS — Outlook fetches each document itself, authorised by a short-lived signature, one at a time, and reports what happened.\n");
