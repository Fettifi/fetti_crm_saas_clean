// A WEBHOOK WITH NO SECRET IS NOT "UNVERIFIED" — IT IS OPEN.
//
// 2026-09-17 system check. Two inbound webhooks had the same shape: `if (secret && !verify(...))
// reject`. Read it the other way round: no secret configured → accept everything. The Calendly
// route had no key in production and would take an unsigned POST from anyone, and if the body's
// email matched a lead it released that lead from Lead Shield quarantine and stamped it Engaged —
// a spammer promoting themselves by posting their own address. The Resend route was closed only
// because its secret happened to be set.
//
// This guard reads the SOURCE of every inbound webhook route (comments stripped, so a comment
// describing the old defect cannot satisfy it) and asserts each one refuses when its secret is
// absent, before any side effect. It also pins the card-auth "ask for the code again" leg to the
// field names sendSignRequest actually reads — the branch passed `email`/`phone` where the sender
// reads `to_email`/`to_phone`, so it had never sent a message.
//
//   npm run verify:webhooks-fail-closed
import { readFileSync } from "fs";

let fail = 0;
const ck = (n: string, c: boolean, d = "") => { if (!c) fail++; console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\nWEBHOOKS — no secret means no entry\n");

// Each entry: the route, the expression that reads its secret, and the refusal that must follow.
const ROUTES: { file: string; secret: RegExp; refuses: RegExp; sideEffect: RegExp }[] = [
  { file: "app/api/calendly/webhook/route.ts", secret: /cfg\("CALENDLY_WEBHOOK_SIGNING_KEY"\)/, refuses: /if \(!key\) return NextResponse\.json\([^)]*status: 503/, sideEffect: /autoPromoteIfQuarantined/ },
  { file: "app/api/webhooks/resend/route.ts", secret: /process\.env\.RESEND_WEBHOOK_SECRET/, refuses: /if \(!secret\) return NextResponse\.json\([^)]*status: 503/, sideEffect: /mutateRequest|recordEmailBounce/ },
  { file: "app/api/webhooks/email-inbound/route.ts", secret: /EMAIL_INBOUND_SECRET/, refuses: /status: 503/, sideEffect: /await (ingest|handle|process|record|supabaseAdmin|logActivity)/ },
];
for (const r of ROUTES) {
  let src = "";
  try { src = code(r.file); } catch { ck(`${r.file} exists`, false, "route file missing — a webhook the guard expects is gone"); continue; }
  ck(`${r.file} reads its secret`, r.secret.test(src));
  // Positions are measured inside the handler body — an import line that names the side
  // effect must not count as "the side effect ran first".
  const bodyStart = Math.max(0, src.search(/export async function POST/));
  const body = src.slice(bodyStart);
  const refuseAt = body.search(r.refuses), effectAt = body.search(r.sideEffect);
  ck(`${r.file} refuses when the secret is absent`, refuseAt >= 0);
  ck(`${r.file} refuses BEFORE any side effect`, refuseAt >= 0 && effectAt >= 0 && refuseAt < effectAt, `refuse@${refuseAt} effect@${effectAt}`);
  ck(`${r.file} has no "secret && !verify" fail-open shape`, !/if \(\s*(secret|key)\s*&&\s*!\s*(verify|signed)/.test(src));
}

// Calendly: the lead-side effects must sit AFTER the signature check, not merely after parsing.
{
  const src = code("app/api/calendly/webhook/route.ts");
  const sig = src.search(/if \(!signed\)/), promote = src.search(/autoPromoteIfQuarantined/), stage = src.search(/stage: "Engaged"/);
  ck("calendly: quarantine release and stage bump happen only after the signature passed", sig >= 0 && promote > sig && stage > sig, `sig@${sig} promote@${promote} stage@${stage}`);
}

// Card-auth re-ask leg: the field names must be the ones sendSignRequest reads.
{
  const src = code("app/api/los/files/[id]/card-auth/route.ts");
  const branch = src.slice(src.indexOf('body.action === "request_cvv"'));
  const call = branch.slice(branch.indexOf("sendSignRequest("), branch.indexOf("sendSignRequest(") + 400);
  ck("card-auth request_cvv passes to_email / to_phone to sendSignRequest", /to_email:\s*email/.test(call) && /to_phone:\s*phone/.test(call));
  ck("card-auth request_cvv passes a title (the sender renders it) and the link", /title:/.test(call) && /link/.test(call));
  ck("card-auth request_cvv returns the link on failure so the LO can deliver it by hand", /status: 502/.test(branch) && /error: "Couldn't reach the borrower[^"]*", link/.test(branch));
  const sig = code("lib/notify/docRequest.ts");
  ck("sendSignRequest still reads to_email / to_phone (the contract this pins)", /to_email\?: string \| null; to_phone\?: string \| null/.test(sig));
}

console.log(fail ? `\n❌ ${fail} check(s) failed\n` : "\n✅ ALL PASS — every inbound webhook fails closed, and the card-code re-ask can actually send\n");
process.exit(fail ? 1 : 0);
