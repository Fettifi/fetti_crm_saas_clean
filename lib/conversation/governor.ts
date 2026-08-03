// THE GOVERNOR — one place that decides whether an automated message may go out.
//
// WHY THIS EXISTS. On 2026-07-29 Ramon read the live threads: "they all sound like AI
// harassment instead of building rapport". The data agreed — 753 outbound, 24 inbound
// (5.8%), the same message to 66 different people, 28 leads hit 3+ times inside 15 minutes,
// and 8 of the 11 who actually replied got pushed to "finish your application" anyway. Every
// conversation that became an application was one Ramon had himself.
//
// The old system was a SENDER: four independent engines (drip, concierge, doc-chaser,
// re-engagement) each asked "who is due?" and none could see what the others had just done.
// Volume was the design. This inverts it: nothing goes out unless it earns its way past a
// single gate, and the gate's default answer is NO.
//
// THE RULES, and the failure each one prevents:
//   1. A human's own send is never blocked.            Ramon must always be able to talk.
//   2. Automation off ⇒ nothing.                       The master shutoff.
//   3. Never speak twice in a row.                     Dawn got 3 near-identical replies in
//                                                      12h without saying a word between.
//   4. They replied ⇒ no more marketing, ever.         Melinda answered like a human and got
//                                                      a rate-deferral push. A reply means a
//                                                      person owns this now.
//   5. Cooldown across ALL channels.                   Kills the 3-in-15-minutes bursts and
//                                                      the simultaneous SMS+email double-tap.
//   6. Never send one body to two people.              Kills the 66- and 54-recipient blasts
//                                                      that were dressed as personal notes.
//   7. A hard lifetime cap on proactive touches.       Nobody gets a 90-day drip again.
// Everything is decided from what was ACTUALLY sent (the comms log), never from a counter a
// bug can leave stale — the class of failure that hid 13 days of silence behind a green
// dashboard.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { automationPaused, allowlistPermits } from "@/lib/automationGate";
import { convertedReasons } from "@/lib/inProcess";
import crypto from "crypto";

export type SendKind =
  | "reply"        // answering something the borrower just said — the only kind we want a lot of
  | "proactive"    // we speak first: follow-up, re-engagement. Rationed hard.
  | "operational"; // a specific thing their live file needs (missing docs). Not marketing.

export type Decision = { allow: true } | { allow: false; reason: string };

/** Proactive touches a lead may EVER receive. Was effectively 12+ across 90 days. */
export const PROACTIVE_LIFETIME_CAP = 3;
// The ONLY send kinds allowed to reach a borrower who has already converted. Ramon kept the
// doc-chaser (2026-08-01): asking for a document we are genuinely waiting on moves the
// client's own file forward and is not marketing. Drip, re-engagement and AI concierge
// replies all stop the moment someone becomes a client.
export const OPERATIONAL_KINDS = new Set<SendKind>(["operational"]);

/** Minimum gap between any two automated messages to the same person, any channel. */
export const COOLDOWN_HOURS: Record<SendKind, number> = {
  reply: 0,          // a reply is invited by definition; rule 3 stops it running away
  proactive: 96,     // 4 days. A human does not chase a stranger daily.
  operational: 72,   // 3 days between "here's what your file still needs"
};
/** A body identical to one sent to a DIFFERENT lead inside this window is a blast. */
const DUPLICATE_WINDOW_DAYS = 45;

type LoggedMessage = { direction: "inbound" | "outbound"; at: string; kind: string | null; body: string };

/** Normalize a message so near-identical blasts collide: strip names, links, numbers, case. */
export function bodyFingerprint(body: string): string {
  const norm = String(body || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")         // links carry per-lead tokens
    .replace(/\d[\d,.]*/g, " ")              // amounts, dates, phone numbers
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The first ~24 words are the recognisable "voice" of a template; a merged first name at
  // the front shouldn't stop two otherwise-identical blasts from matching, so drop word 1.
  const words = norm.split(" ").filter(Boolean).slice(1, 25);
  // No words ⇒ NO fingerprint. Callers that check the thread rules before a body exists
  // (the concierge, which asks permission before spending a model call) pass an empty body,
  // and hashing "" would give every one of them the same fingerprint — so the second such
  // check of the day would be denied as a "blast" against the first. An empty fingerprint
  // makes rule 7 skip instead.
  if (words.length < 3) return "";
  return crypto.createHash("sha1").update(words.join(" ")).digest("hex").slice(0, 16);
}

/** The lead's real message history, newest last, straight from the comms log. */
export async function threadFor(leadId: string, limit = 60): Promise<LoggedMessage[]> {
  const { data } = await supabaseAdmin
    .from("activity_log")
    .select("created_at, detail")
    .eq("action", "comms.message")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(limit);
  return ((data || []) as any[])
    .map((r) => ({
      direction: r.detail?.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
      at: String(r.created_at),
      kind: r.detail?.type ?? null,
      body: String(r.detail?.body || ""),
    }));
}

/**
 * May this message go out? Deny by default; every allow is a rule that was satisfied.
 * `now` is injectable so the rules can be replayed against history in tests.
 */
export async function authorizeSend(input: {
  /** Per-channel bodies. Hashing the concatenation only ever fingerprinted the SMS. */
  smsBody?: string | null;
  emailBody?: string | null;
  leadId?: string | null;
  kind: SendKind;
  body: string;
  humanInitiated?: boolean;
  now?: Date;
  thread?: LoggedMessage[];        // supply to avoid a re-query (and for replay tests)
}): Promise<Decision> {
  // 1. A human pressed send. Never block Ramon.
  if (input.humanInitiated) return { allow: true };

  // 2. Master shutoff.
  if (await automationPaused()) return { allow: false, reason: "automation paused" };

  const leadId = input.leadId || "";
  if (!leadId) return { allow: false, reason: "no lead id — cannot reason about the conversation" };

  // 2b. PILOT LIST. When one is configured, only those borrowers hear from automation at
  //     all. This is how the rebuilt engine gets turned back on safely: a couple of people
  //     first, watched, then widened — rather than 190 at once, which is how we got here.
  if (!(await allowlistPermits(leadId))) {
    return { allow: false, reason: "not on the automation pilot allowlist" };
  }

  // 2c. ALREADY A CLIENT. Ramon, 2026-08-01: "don't auto message anyone that's already
  //     converted to a real loan application... cross reference against active loan
  //     application and any auto messaging going out. should not happen."
  //
  //     This sits here — after the allowlist, BEFORE the thread load — for two reasons.
  //     It is a fact about the PERSON, not the conversation, so rules 3-6 (which are pure
  //     functions of the message thread and must stay replayable with no IO) can never
  //     express it. And putting it above threadFor() means a converted borrower costs no
  //     query at all.
  //
  //     Until today not one of the seven rules read application state: the governor's only
  //     data sources were activity_log and activity_log again. It never touched `leads` or
  //     `loan_files`, so a borrower mid-underwriting looked exactly like a cold lead.
  //
  //     OPERATIONAL_KINDS is the deliberate exception. Ramon kept the doc-chaser (2026-08-01):
  //     chasing a document we are actually waiting on moves the client's own file forward and
  //     is not marketing. Everything else — drip, re-engagement, AI concierge replies — goes
  //     silent the moment someone converts.
  if (!OPERATIONAL_KINDS.has(input.kind)) {
    const reasons = await convertedReasons(leadId).catch((e) => {
      // A failed lookup must DENY, never fall through. "Could not tell" and "not a client"
      // must not produce the same outcome — that is how a borrower in underwriting gets a
      // drip message during a database blip.
      throw new Error(`governor: could not establish applicant status for ${leadId} — ${e instanceof Error ? e.message : e}`);
    });
    if (reasons?.length) {
      return { allow: false, reason: `already a client (${reasons.join("+")}) — automated messaging is off for converted applicants` };
    }
  }

  const now = input.now ?? new Date();
  const thread = input.thread ?? (await threadFor(leadId));

  // Rules 3–6 are pure — decided entirely from the thread. Evaluate them first and without
  // IO so they can be REPLAYED against history (scripts/verify-governor.ts) with no database
  // writes and no dependence on the live pause switch.
  const local = evaluateThreadRules({ kind: input.kind, thread, now });
  if (!local.allow) return local;

  // 7. NOT A BLAST. If this exact body already went to somebody ELSE recently, it is a
  //    template pretending to be a personal note — the thing that made 66 people receive
  //    the same "here's something most people don't hear" email in the same minute.
  // HASH EACH CHANNEL'S BODY SEPARATELY. The caller passed `smsBody + " " + emailBody` as one
  // string, and bodyFingerprint keeps only words 2-25 — which the ~40-word SMS copy always
  // occupies. So the fingerprint WAS the SMS body and the email body was never hashed at all,
  // while the comparison set (comms.message detail.body) is written one row per channel.
  // Measured since 2026-07-25: EMAIL fingerprints spanned 32, 30, 22, 22, 18, 17 and 11 leads;
  // SMS collided for only 2 and 7, because the SMS templates carry the first name at word 2 and
  // the email templates did not. The exact copy that got automation switched off — 32 recipients
  // of the same "something most people don't hear" email — passed this gate untouched.
  const fps = [input.smsBody, input.emailBody, input.body]
    .map((b) => bodyFingerprint(String(b || "")))
    .filter(Boolean);
  if (fps.length) {
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86400000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("activity_log")
      .select("lead_id, detail")
      .eq("action", "comms.message")
      .gte("created_at", since)
      .limit(2000);
    const seen = new Set(
      ((recent || []) as any[])
        .filter((r) => r.lead_id && r.lead_id !== leadId && r.detail?.direction === "outbound")
        .map((r) => bodyFingerprint(String(r.detail?.body || "")))
        .filter(Boolean),
    );
    // EITHER channel colliding is a blast — the email one is the one that was slipping through.
    if (fps.some((f) => seen.has(f))) {
      return { allow: false, reason: "identical message already sent to a different lead — that's a blast, not a note" };
    }
  }

  return { allow: true };
}

/**
 * The thread-only rules (3–6). PURE: no database, no clock of its own, no side effects —
 * so the exact logic that guards production can be replayed over historical messages to
 * show what it would have stopped. That replay is the only honest way to claim this fixes
 * anything; see scripts/verify-governor.ts.
 */
export function evaluateThreadRules(input: { kind: SendKind; thread: LoggedMessage[]; now: Date }): Decision {
  const { kind, thread, now } = input;
  const last = thread[thread.length - 1];
  const outbound = thread.filter((m) => m.direction === "outbound");
  const everReplied = thread.some((m) => m.direction === "inbound");

  // 3. NEVER SPEAK TWICE IN A ROW. If the last thing in the thread is ours, the borrower
  //    has not said anything since — so an automated reply has nothing to reply to. This is
  //    the single rule that would have stopped Dawn's three identical IRS-transcript
  //    messages, and it is simply what a person does: you don't answer your own text.
  if (input.kind === "reply" && last && last.direction === "outbound") {
    return { allow: false, reason: "we spoke last — nothing new from them to answer" };
  }

  // 4. THEY REPLIED ⇒ NO MORE MARKETING. A live human owns this conversation now. Proactive
  //    drip on someone who is already talking to us is the behaviour Ramon called harassment.
  if (input.kind === "proactive" && everReplied) {
    return { allow: false, reason: "they have replied — a person owns this thread now" };
  }

  // 5. COOLDOWN across every channel. The bursts happened because four engines each checked
  //    only their own last-sent stamp; this checks what the BORROWER actually received.
  const cooldown = COOLDOWN_HOURS[input.kind] ?? 72;
  if (cooldown > 0 && outbound.length) {
    const lastOut = new Date(outbound[outbound.length - 1].at).getTime();
    const hours = (now.getTime() - lastOut) / 3600000;
    if (hours < cooldown) {
      return { allow: false, reason: `only ${hours.toFixed(1)}h since our last message (needs ${cooldown}h)` };
    }
  }

  // 6. A HARD LIFETIME CAP on speaking first — counted in TOUCHES, not message rows.
  //
  // This counted rows, and logComms writes ONE ROW PER CHANNEL: a single both-channel touch
  // consumed TWO of the three slots, so touch #2 pushed the count to 4 and the lead was capped
  // after two real conversations. Measured: 6 of the 26 cap-denied leads hit the cap after only
  // TWO touches, and every one of them had both an email and a phone.
  //
  // That means the cap throttled hardest exactly the cohort that is the only one that ever
  // replies — both-channel leads reply 20.6%, email-only 0% — and it did so by an accident of
  // logging granularity that nobody decided. Group by minute: the email and the SMS of one
  // touch are written together.
  if (input.kind === "proactive") {
    const isProactive = (m: LoggedMessage) => (m.kind || "").startsWith("proactive") || (m.kind || "") === "nurture";
    const minutes = new Set(
      outbound.filter(isProactive).map((m) => String(m.at || "").slice(0, 16)),
    );
    const priorProactive = minutes.size;
    if (priorProactive >= PROACTIVE_LIFETIME_CAP) {
      return { allow: false, reason: `proactive lifetime cap reached (${priorProactive}/${PROACTIVE_LIFETIME_CAP})` };
    }
  }

  return { allow: true };
}
