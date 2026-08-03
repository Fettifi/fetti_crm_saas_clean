// REPLAY: run the governor's rules over every message that actually went out, and report
// what it would have stopped. Claiming "this fixes the harassment" is only honest if the
// rules are tested against the real threads that caused the complaint.
//   npx tsx scripts/verify-governor.ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { evaluateThreadRules, bodyFingerprint, type SendKind } from "@/lib/conversation/governor";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

// What the old system called each send → what the governor treats it as.
function classify(type: string | null): SendKind {
  const t = String(type || "").toLowerCase();
  if (t.includes("ai_reply") || t.includes("reply")) return "reply";
  if (t.includes("doc")) return "operational";
  return "proactive";   // nurture, reactivation, connect_offer, first_touch
}

async function main() {
  const { data: rows } = await sb.from("activity_log")
    .select("lead_id, created_at, detail").eq("action", "comms.message")
    .order("created_at", { ascending: true }).limit(5000);

  const byLead = new Map<string, any[]>();
  for (const r of (rows || []) as any[]) {
    if (!r.lead_id) continue;
    if (!byLead.has(r.lead_id)) byLead.set(r.lead_id, []);
    byLead.get(r.lead_id)!.push(r);
  }

  // Rule 7 (blast detection) needs cross-lead state, so track fingerprints as we replay.
  const fpSeen = new Map<string, { lead: string; at: number }[]>();
  const reasons = new Map<string, number>();
  let total = 0, blocked = 0, allowed = 0;

  // Replay in true chronological order across all leads.
  const all = ((rows || []) as any[]).filter((r) => r.lead_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const threads = new Map<string, any[]>();

  for (const r of all) {
    const dir = r.detail?.direction === "inbound" ? "inbound" : "outbound";
    const lead = r.lead_id as string;
    if (!threads.has(lead)) threads.set(lead, []);
    const thread = threads.get(lead)!;
    const msg = { direction: dir as "inbound" | "outbound", at: String(r.created_at), kind: r.detail?.type ?? null, body: String(r.detail?.body || "") };

    if (dir === "outbound") {
      total++;
      const kind = classify(r.detail?.type);
      const now = new Date(r.created_at);
      let d = evaluateThreadRules({ kind, thread, now });   // thread = state BEFORE this send
      if (d.allow) {
        // rule 7: identical body already sent to a different lead in the window?
        //
        // NOTE ON THIS REPLAY'S HONESTY. It hashes `msg.body` — the logged, SINGLE-CHANNEL
        // body — which until 2026-08-02 was NOT what production hashed: authorizeSend was
        // handed `smsBody + " " + emailBody` as one string, and bodyFingerprint keeps only
        // words 2-25, so the production hash matched neither stored row reliably and the email
        // blasts (fingerprints spanning 32, 30, 22, 22, 18, 17 and 11 leads) sailed through.
        // The replay was therefore exercising a layer production never reached, which makes the
        // "82% would have been blocked" figure it produced too generous. authorizeSend now
        // fingerprints each channel separately against the per-channel rows, so this replay and
        // production finally agree — and the number below can be trusted.
        const fp = bodyFingerprint(msg.body);
        const prior = (fpSeen.get(fp) || []).filter((x) => now.getTime() - x.at < 45 * 86400000 && x.lead !== lead);
        if (fp && prior.length) d = { allow: false, reason: "blast — same body already sent to another lead" };
      }
      if (d.allow) allowed++; else { blocked++; const key = d.reason.replace(/only [\d.]+h/, "too soon"); reasons.set(key, (reasons.get(key) || 0) + 1); }
      const fp = bodyFingerprint(msg.body);
      if (fp) { if (!fpSeen.has(fp)) fpSeen.set(fp, []); fpSeen.get(fp)!.push({ lead, at: now.getTime() }); }
    }
    thread.push(msg);
  }

  console.log(`\n══ REPLAY OVER ${total} MESSAGES THAT ACTUALLY WENT OUT ══\n`);
  console.log(`  would still send : ${allowed}`);
  console.log(`  would be BLOCKED : ${blocked}   (${((100 * blocked) / Math.max(1, total)).toFixed(0)}% of everything sent)\n`);
  console.log("  why blocked:");
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([why, n]) =>
    console.log(`    ${String(n).padStart(4)}  ${why}`));

  // The specific complaints, by name.
  console.log("\n══ THE CASES RAMON READ ══");
  const named: [string, string][] = [];
  for (const [lead, msgs] of threads) {
    const { data: l } = await sb.from("leads").select("full_name").eq("id", lead).maybeSingle();
    const name = (l as any)?.full_name || lead;
    // consecutive outbound with no inbound between = talking to yourself
    let run = 0, maxRun = 0;
    for (const m of msgs) { if (m.direction === "outbound") { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
    if (maxRun >= 4) named.push([name, `${maxRun} messages in a row with no reply from them`]);
  }
  named.sort((a, b) => Number(b[1].split(" ")[0]) - Number(a[1].split(" ")[0]));
  named.slice(0, 8).forEach(([n, d]) => console.log(`    ${n.padEnd(28)} ${d}`));
  console.log(`\n  Under the governor the longest possible unanswered run is ${3} (the proactive lifetime cap).\n`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
