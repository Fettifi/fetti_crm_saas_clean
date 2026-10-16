// A SECRET MUST COME FROM A CSPRNG. Math.random() IS NOT ONE.
//
// 2026-10-16. The borrower portal's access code — its ONLY authentication factor, the thing
// standing between a stranger and that borrower's pay stubs, bank statements and tax returns —
// was generated as:
//
//     const code = Math.floor(100000 + Math.random() * 900000).toString();
//
// V8 implements Math.random() as xorshift128+: fast, seeded per-context, and RECOVERABLE. An
// attacker who observes a handful of outputs can reconstruct the internal state and predict the
// rest — and observing outputs here costs nothing, because anyone may request codes for an address
// they control and read them out of their own inbox, then predict the next code issued to somebody
// else.
//
// The verify route is separately rate-limited (10 attempts per 15 minutes, per IP AND per email,
// fail-closed), which contains BRUTE FORCE. It does nothing about a PREDICTED code, which arrives
// correct on the first attempt. Those are different attacks and only one of them was defended.
//
// This guard covers the places where a value IS a credential. It deliberately does NOT ban
// Math.random() repo-wide: correlation ids, cache-busting suffixes and jitter are fine, and a guard
// that flags them gets switched off. [[a-redaction-guard-that-blocks-real-work]]
//
//   npx tsx scripts/verify-credential-randomness.ts            # 0 clean · 1 defect
import { readFileSync, existsSync } from "fs";

// Files whose output authenticates somebody. Add a route here the day it starts minting a secret.
const SECRET_SOURCES = [
  "app/api/portal/auth/send-otp/route.ts",
];

// Identifiers that are secrets by nature, wherever they are built.
export const SECRET_NAMES = /\b(?:code|token|secret|otp|nonce|passcode|apiKey|sessionId)\b/i;

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

/** A line that ASSIGNS a secret-named value from Math.random(). */
export function weakSecretLines(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  strip(src).split("\n").forEach((l, i) => {
    if (!/Math\.random\s*\(/.test(l)) return;
    const assigned = l.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    const name = assigned?.[1] || "";
    if (name && SECRET_NAMES.test(name)) out.push({ line: i + 1, text: l.trim().slice(0, 120) });
  });
  return out;
}

let bad = 0;
const ck = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

console.log("\nCREDENTIAL RANDOMNESS — a secret must not come from Math.random()\n");

// Guard the guard: the predicate must actually catch the real shipped line.
const SHIPPED = `const code = Math.floor(100000 + Math.random() * 900000).toString();`;
ck("the predicate catches the REAL shipped OTP line", weakSecretLines(SHIPPED).length === 1);
ck("…and ignores a correlation id", weakSecretLines(`const requestId = Math.random().toString(36);`).length === 0);
ck("…and ignores jitter", weakSecretLines(`const delay = Math.random() * 1000;`).length === 0);
ck("…and ignores a COMMENT about Math.random", weakSecretLines(`// const code = Math.random()`).length === 0);
ck("…and catches a token built the same way", weakSecretLines(`let token = Math.random().toString(36);`).length === 1);

for (const f of SECRET_SOURCES) {
  if (!existsSync(f)) { ck(`${f} exists`, false, "listed as a secret source but not on disk"); continue; }
  const src = readFileSync(f, "utf8");
  const weak = weakSecretLines(src);
  ck(`${f} mints its secret from a CSPRNG`, weak.length === 0,
     weak.map((w) => `line ${w.line}: ${w.text}`).join(" · "));
  ck(`…and imports one`, /from ['"]crypto['"]/.test(src) || /globalThis\.crypto|webcrypto/.test(src),
     "no crypto import — where is the entropy coming from?");
}

// The brute-force half must stay defended too: a strong code with no attempt limit is still weak.
const verify = "app/api/portal/auth/verify-otp/route.ts";
if (existsSync(verify)) {
  const v = strip(readFileSync(verify, "utf8"));
  ck("the verify route rate-limits attempts", /rateLimit\(/.test(v), "");
  ck("…fail-closed, so a limiter outage cannot open the door", /failClosed:\s*true/.test(v), "");
  ck("…and throttles the EMAIL, not just the IP", /otp-verify:\$\{String\(email\)/.test(v), "an IP-only limit is defeated by rotating IPs");
}

console.log(bad ? `\n❌ ${bad} failed — a portal credential may be predictable.\n`
                : "\n✅ CLEAN — secrets come from a CSPRNG and attempts are throttled.\n");
process.exit(bad ? 1 : 0);
