import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { twilioGate, webhookCandidateUrls } from "@/lib/twilioVerify";
import { logHotLeadReply } from "@/lib/notify/hotLeadReply";
import { logComms, sendSms, getLeadMessagesForAI, countRecentOutbound } from "@/lib/comms";
import { autoPromoteIfQuarantined, checkPhonePattern } from "@/lib/leadShield";
import { rateLimit } from "@/lib/rateLimit";
import { logActivity } from "@/lib/activity";
import { markConciergeReply, extractConversationFacts, handoffSignal, expertiseFor } from "@/lib/markConcierge";
import { cfg } from "@/lib/settings";
import { phoneMatchForms } from "@/lib/phone";
import { magicApplyLink } from "@/lib/magicLink";
import { automationPaused } from "@/lib/automationGate";
import { isRevocation } from "@/lib/smsConsent";
import { findPendingPartyByPhone, parsePartyReply, resolveParty, eventLabel, EVENT_DATE } from "@/lib/rsvp";
import { partyConfirmation, firstNameOf } from "@/lib/rsvpFromCall";

export const dynamic = "force-dynamic";
// inbound-reply auto-promote may replay the full pipeline (after Twilio ACK)
export const maxDuration = 120;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";

// Twilio inbound SMS webhook ("A message comes in"). When a lead replies:
//  - pause their automated nurture (they're engaged — a human takes over)
//  - ping the team in Discord with the reply so they respond fast
// Returns empty TwiML so Twilio doesn't auto-reply.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => { params[k] = String(v); });

    // Reject forged webhooks: verify Twilio's signature. Fail-CLOSED — a valid
    // signature is required when a token is set, and a missing token in production
    // rejects (503) rather than silently accepting forged SMS.
    {
      const gate = twilioGate(req, webhookCandidateUrls(req, "/api/sms/inbound"), params);
      if (gate) {
        console.warn(`[sms/inbound] rejected: Twilio gate ${gate.status}`);
        return new NextResponse(gate.status === 503 ? "Service Unavailable" : "Forbidden", { status: gate.status });
      }
    }

    const from = String(params["From"] || "");
    const body = String(params["Body"] || "").trim();
    const digits = from.replace(/\D/g, "").slice(-10);
    const msgSid = String(params["MessageSid"] || ""); // Twilio's unique id for THIS inbound — used for retry idempotency

    // IDEMPOTENCY (before ANY branch): Twilio redelivers this webhook if our response
    // is slow, and EVERY path below has an unguarded side effect on retry — the owner
    // task-by-text double-inserts a task, the keyword opt-in re-fires the alert + reply,
    // and an unmatched sender creates a PHANTOM duplicate lead (none of these had a
    // MessageSid guard; the lead-scoped activity_log check further down only covered the
    // matched-lead reply path). rate_limit_hit is an ATOMIC per-key Postgres counter, so
    // the first delivery of a given MessageSid wins (returns true) and any retry returns
    // false — record it up front (idempotency BEFORE side effects) and short-circuit with
    // a 200 so Twilio stops retrying. Fail-OPEN: a limiter hiccup returns true, so we
    // never silently drop a real inbound (the activity_log check below still backstops
    // the matched-lead path in that rare case).
    if (msgSid) {
      const firstDelivery = await rateLimit(`smsidem:${msgSid}`, 1, 3 * 86400);
      if (!firstDelivery) {
        return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
      }
    }

    // OWNER TASK-BY-TEXT: Ramon dictates tasks from his phone ("task call the CPA",
    // "daily review new leads"). Only honored from the owner's own cell (OWNER_CELL
    // setting; default his alert number), so no lead can inject tasks. "daily …" /
    // "weekly …" / "monthly …" set the cadence; "task …"/"todo …"/"quest …" = one-time.
    const ownerCell = ((await cfg("OWNER_CELL")) || "3236203534").replace(/\D/g, "").slice(-10);
    const taskCmd = body.match(/^(task|todo|quest|daily|weekly|monthly)[:,\s]+([\s\S]{2,200})/i);
    if (digits && digits === ownerCell && taskCmd) {
      const kind = taskCmd[1].toLowerCase();
      const cadence = ["daily", "weekly", "monthly"].includes(kind) ? kind : "once";
      const title = taskCmd[2].trim().replace(/\s+/g, " ");
      await supabaseAdmin.from("org_tasks").insert([{ title: title.slice(0, 200), source: "sms", status: "open", priority: 5, cadence }]);
      const label = cadence === "once" ? "Quest" : cadence[0].toUpperCase() + cadence.slice(1) + " goal";
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const xml = `<Response><Message>✅ ${label} added: "${esc(title.slice(0, 80))}"</Message></Response>`;
      return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
    }

    // ——— A WEDDING GUEST ANSWERING "HOW MANY OF YOU?" ———
    //
    // They phoned in an RSVP, we texted back asking for a head count, and this is the answer.
    // It runs before the lead paths deliberately: a guest is not a lead, and "2" must never be
    // read as a keyword, an opt-in, or a reply to a mortgage nurture sequence. Only numbers
    // FROM A GUEST WE ARE ALREADY WAITING ON can reach this branch, so nothing else changes.
    if (digits) {
      const pending = await findPendingPartyByPhone(digits);
      if (pending) {
        const n = parsePartyReply(body);
        const label = await eventLabel();
        const first = firstNameOf(pending.name);
        if (n === null) {
          // Ask once more, then stop — a loop of "sorry, a number please" is worse than a
          // guest list entry Ramon fixes by hand. The re-ask is rate-limited per number.
          const askAgain = await rateLimit(`rsvpparty:${digits}`, 1, 86400);
          const reply = askAgain
            ? "Sorry — just a number is perfect (like 2), and I'll get you on the list. — Ramon"
            : "Thanks! Ramon will follow up to confirm your headcount.";
          try { await logActivity({ entity_type: "rsvp", entity_id: pending.id, actor: "consumer", action: "rsvp.party_unparsed", detail: { from, text: body.slice(0, 200) } }); } catch { /* */ }
          return new NextResponse(`<Response><Message>${reply.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
        }
        const updated = await resolveParty(pending.id, n);
        const reply = partyConfirmation(first, updated?.party ?? n, label, EVENT_DATE);
        try {
          await logActivity({ entity_type: "rsvp", entity_id: pending.id, actor: "consumer", action: "rsvp.party_set", detail: { from, party: updated?.party ?? n, text: body.slice(0, 200) } });
        } catch { /* */ }
        return new NextResponse(`<Response><Message>${reply.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
      }
    }

    // Keyword opt-in (e.g. "Text DEAL to ..." from The Lot). Because the viewer
    // texts US first, this is express written consent (TCPA-compliant). We log
    // the consented lead and reply with the capture link; the hourly self-heal
    // cron backfills their loan file + agents, and nurture works them.
    const OPTIN_KEYWORDS = (process.env.SMS_OPTIN_KEYWORDS || "DEAL,FETTI,MONEY,QUALIFY,HOME,LOT").split(",").map((k) => k.trim().toUpperCase());
    const word = body.toUpperCase().replace(/[^A-Z]/g, "");
    if (digits && OPTIN_KEYWORDS.includes(word)) {
      // SHIELD: opt-in flood guard — the 1st–3rd keyword text a day already created/
      // refreshed the lead; a 4th+ adds nothing (bot loops). Still ACK 200 (carrier
      // hygiene), still reply, just skip the DB write. Obvious garbage sender
      // numbers (NANP-invalid) are skipped the same way.
      const floodOk = await rateLimit(`shield:smsoptin:${digits}`, 3, 86400);
      const badPhone = checkPhonePattern(digits);
      if (!floodOk || badPhone) {
        try { await logActivity({ entity_type: "shield", entity_id: digits.slice(-4), actor: "shield", action: "shield.optin_flood", detail: { reason: !floodOk ? "4th+ opt-in today" : "invalid NANP pattern" } }); } catch { /* */ }
        const reply = "It's Fetti 🦉 You're already on the list — see what you qualify for: https://fettifi.com/tv (Reply STOP to opt out.)";
        return new NextResponse(`<Response><Message>${reply.replace(/&/g, "&amp;")}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      // ONE WORD FROM A KNOWN LEAD IS A REPLY, NOT AN OPT-IN.
      //
      // This branch ran BEFORE the lead lookup, and the keyword list is DEAL/FETTI/MONEY/
      // QUALIFY/HOME/LOT — every one of which is a plausible answer to our own first-touch
      // question ("are you looking at homes, or getting financing sorted first?"). So a lead
      // replying "Home" was: stamped with a campaign they never saw, had `sms_optout_at`
      // DELETED, had nurture un-paused, and got the marketing auto-reply instead of a human —
      // while their actual reply was never logged, never raised as a hot lead, and never
      // reached the concierge. Executed against the shipping gate: a lead sitting at
      // {sms_consent:false, sms_optout_at:'2026-07-06'} went from DO-NOT-TEXT to TEXTABLE on
      // the single word "Home".
      //
      // A known number falls through to the reply path below, which grants texted-in consent
      // ONLY when there is no opt-out on file (see the `!raw.sms_optout_at` test there).
      const { data: known } = await supabaseAdmin
        .from("leads").select("id").in("phone", phoneMatchForms(digits))
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!known) {
        // A REVOCATION IS NEVER SUPERSEDED BY A KEYWORD. `delete raw.sms_optout_at` was the
        // only line in the codebase that could put a number that said STOP back on the list.
        // It is gone; re-consent has to come through a path that records HOW.
        const consent = {
          sms_optin: true, keyword: word, at: new Date().toISOString(), text: body.slice(0, 200),
          // Only claim the campaign the keyword actually belongs to. Stamping every inbound
          // word "youtube_thelot" manufactures the evidence we would produce in a dispute.
          ...(word === "LOT" ? { campaign: "youtube_thelot" } : {}),
        };
        try {
          await supabaseAdmin.from("leads").insert([{
            phone: digits,
            source: word === "LOT" ? "youtube_thelot" : "sms_optin",
            lead_source: "sms_optin", stage: "New Lead",
            raw: { consent, sms_consent: true, sms_consent_source: "keyword" },
          }]);
        } catch (e) { console.warn("[sms/inbound] optin save failed", e); }
        // The inbound text itself is a record we must keep, whether or not it matched a lead.
        try { await logActivity({ entity_type: "sms", entity_id: digits.slice(-4), actor: "consumer", action: "sms.optin", detail: { keyword: word, from, text: body.slice(0, 200) } }); } catch { /* */ }
      } else {
        // Known number: do NOT treat this as an opt-in. Fall through to the reply path.
      }
      if (!known) {

        const optinHook = process.env.LEAD_NOTIFY_WEBHOOK;
        if (optinHook) { try { await fetch(optinHook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `📲 **SMS opt-in** — ${from} texted "${body}".` }) }); } catch { /* */ } }

        const reply = "It's Fetti 🦉 Thanks for texting in! See what you qualify for in 2 min — home loans, refis & investment: https://fettifi.com/tv — Msg&data rates may apply. Reply STOP to opt out.";
        const xml = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return new NextResponse(`<Response><Message>${xml}</Message></Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });
      }
      // known number → fall through to the reply path
    }

    if (digits) {
      let { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, full_name, first_name, phone, loan_purpose, state, stage")
        .in("phone", phoneMatchForms(digits))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Twilio retries the webhook if our response is slow — guard against
      // double-processing (duplicate inbound log + duplicate AI text). If we've
      // already recorded this exact inbound (by Twilio MessageSid), ack and stop.
      if (lead && msgSid) {
        const { data: seen } = await supabaseAdmin.from("activity_log")
          .select("id").eq("lead_id", (lead as any).id).eq("action", "comms.message")
          .filter("detail->>providerId", "eq", msgSid).limit(1).maybeSingle();
        if (seen) return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
      }

      // Only a genuine opt-out pauses nurture (TCPA). A normal reply is a HOT
      // engagement signal — keep nurturing (throttled) and alert the team to jump in.
      // isRevocation (module scope) catches embedded opt-outs per the FCC 2024 order
      // while keeping ambiguous uses ("cancel my 3pm appointment") as hot replies.
      const isStop = isRevocation(body);
      if (isStop && digits) {
        // Revoke on EVERY row sharing this phone (dup groups, legacy forms) — an
        // opt-out that only hits the newest row is a TCPA violation waiting on the rest.
        const { data: rows } = await supabaseAdmin.from("leads").select("id, raw").in("phone", phoneMatchForms(digits));
        for (const r of rows || []) {
          const raw = (r as any).raw && typeof (r as any).raw === "object" ? (r as any).raw : {};
          raw.sms_consent = false;
          raw.sms_optout_at = new Date().toISOString();
          // Revoke EVERY consent form, including the texted-keyword grant — the SMS
          // gates OR them together, so leaving consent.sms_optin=true would keep
          // texting an opted-out number (TCPA violation).
          if (raw.consent && typeof raw.consent === "object") raw.consent = { ...raw.consent, sms_optin: false, revoked_at: raw.sms_optout_at };
          await supabaseAdmin.from("leads").update({ nurture_paused: true, raw }).eq("id", (r as any).id);
        }
        // A STOP FROM A NUMBER WE HOLD NO ROW FOR MUST STILL BE RECORDED.
        // One did, on 2026-07-06, and left no trace anywhere in 8,567 activity rows — it was
        // only recovered 21 days later by backfilling Twilio's own suppression list. Nothing
        // stopped that number from being intaken and texted in the meantime. A revocation has
        // to survive a failed lead match, so persist it as a suppression row: every existing
        // gate already reads `sms_optout_at`, so this needs no new store and no new DDL.
        if (!(rows || []).length) {
          const now = new Date().toISOString();
          try {
            await supabaseAdmin.from("leads").insert([{
              phone: digits, source: "sms_optout", lead_source: "sms_optout", stage: "Dead",
              nurture_paused: true,
              raw: { sms_consent: false, sms_optout_at: now, do_not_contact: true, optout_text: body.slice(0, 200), optout_source: "inbound_stop" },
            }]);
          } catch (e) { console.warn("[sms/inbound] suppression row failed", e); }
        }
        // Log the revocation itself whether or not it matched — this is the record we would
        // have to produce, and it used to sit under `if (lead)`.
        try { await logActivity({ entity_type: "sms", entity_id: digits.slice(-4), actor: "consumer", action: "sms.optout", detail: { from, text: body.slice(0, 200), matched: (rows || []).length } }); } catch { /* */ }
      } else {
        // UNMATCHED inbound from a real human — CAPTURE, never drop (previously the
        // if(lead) gate below silently lost these). Someone texting a mortgage line is
        // high intent; create a minimal lead so it enters the funnel + gets worked. A
        // texting phone is self-verifying — they initiated, so SMS consent is theirs.
        if (!lead && digits) {
          try {
            const { data: created } = await supabaseAdmin.from("leads").insert({
              // Someone who texts a mortgage line unprompted is a WARM, self-initiated
              // lead, not a cold Tier-3 import — seed a non-zero score/Tier 2 so it sorts
              // above the cold drip and gets prioritized. (Stay honest: we know nothing
              // about their file yet, so this isn't a Tier-1 "qualified" claim; the hot-
              // reply task below + Mark's live concierge reply are what actually work it.)
              phone: digits, source: "sms_inbound", lead_source: "sms_inbound",
              stage: "New Lead", score: 40, tier: "Tier 2",
              notes: `Inbound text (no prior lead matched): "${body.slice(0, 200)}"`,
              raw: { sms_inbound_origin: true, phone_status: "us", consent: { sms_optin: true, sms_optin_at: new Date().toISOString(), source: "texted_in" } },
            }).select("id, full_name, first_name, phone, loan_purpose, state, stage").single();
            lead = created || null;
          } catch (e) { console.warn("[sms/inbound] unmatched-sender lead create failed", e); }
        }
        if (lead) {
          // SHIELD: a real inbound text is human evidence — release a quarantined lead
          // (no-op unless stage is Review). Runs before the hot-reply task/concierge so
          // the full pipeline fires exactly once.
          try { await autoPromoteIfQuarantined((lead as any).id, "sms_inbound"); } catch { /* */ }
          // CONSENT BRIDGE: they texted US first — express written consent (TCPA), the
          // same rationale as the keyword opt-in above. Stamp it with evidence so this
          // lead graduates from email-only to the SMS drip. Never resurrects a STOP:
          // an opted-out number stays out until a fresh keyword opt-in.
          try {
            const { data: lr } = await supabaseAdmin.from("leads").select("raw").eq("id", (lead as any).id).maybeSingle();
            const raw = (lr as any)?.raw && typeof (lr as any).raw === "object" ? (lr as any).raw : {};
            if (!raw.sms_optout_at && raw.sms_consent !== true) {
              raw.sms_consent = true;
              const prior = raw.consent && typeof raw.consent === "object" ? raw.consent : {};
              raw.consent = { ...prior, sms_optin: true, via: "texted_in", at: new Date().toISOString(), text: body.slice(0, 200) };
              await supabaseAdmin.from("leads").update({ raw }).eq("id", (lead as any).id);
            }
          } catch { /* best-effort — the reply/alert flow must not depend on the stamp */ }
          // Non-STOP reply = hottest signal in the funnel → top-priority CRM task + alert.
          await logHotLeadReply({ leadId: (lead as any).id, name: (lead as any).full_name, phone: from, body });
        }
      }

      // Record the inbound text on the conversation timeline (Conversations inbox),
      // so every reply — including opt-outs — shows in-thread next to what we sent.
      if (lead) {
        try { await logComms({ leadId: (lead as any).id, channel: "sms", direction: "inbound", type: isStop ? "optout" : "reply", body, from, status: "received", providerId: msgSid || null }); } catch { /* best-effort */ }
      }

      // AI concierge: Mark replies in real time so a nurture follow-up becomes a
      // genuine two-way conversation, not a one-way drip. Runs AFTER the response
      // (Next after()) so the webhook returns in ~200ms — under Twilio's timeout, so
      // Twilio doesn't retry (a retry would double-text). Guardrails — never on an
      // opt-out, kill-switch (AI_SMS_CONCIERGE=off), a per-lead daily cap, and a
      // deterministic compliance gate inside markConcierge. Human team is alerted
      // (hot-reply task above); if the AI errors we stay silent (no bad text).
      if (lead && !isStop) {
        const leadId = (lead as any).id;
        const leadPhone = (lead as any).phone || from;
        after(async () => {
          try {
            if ((await cfg("AI_SMS_CONCIERGE")) === "off") return;
            // TCPA opt-out guard: never auto-reply to a number that has opted out. They
            // can text in again without re-consenting (the consent bridge above refuses to
            // resurrect an opted-out number) — mirror that here and stay silent. Fetched up
            // front so it guards BOTH the live-bridge hold text and the AI reply below.
            const { data: leadRow } = await supabaseAdmin.from("leads").select("raw, nurture_paused").eq("id", leadId).maybeSingle();
            if ((leadRow as any)?.nurture_paused === true || (leadRow as any)?.raw?.sms_optout_at) return;
            const aiToday = await countRecentOutbound(leadId, "ai_reply", 24 * 3600000);
            if (aiToday >= 8) return;
            // SHIELD: global daily concierge cap — one runaway bot conversation can't
            // burn the whole OpenAI budget (per-lead 8/day stays the primary gate).
            if (!(await rateLimit("shield:concierge:global", 300, 86400))) return;
            const history = await getLeadMessagesForAI(leadId);
            const firstAi = (await countRecentOutbound(leadId, "ai_reply", 365 * 86400000)) === 0;
            const { data: lf } = await supabaseAdmin.from("loan_files").select("id, share_token").eq("lead_id", leadId).limit(1).maybeSingle();
            const fileLink = (lf as any)?.share_token ? `${APP_URL}/file/${(lf as any).share_token}` : null;
            const calendlyUrl = (await cfg("CALENDLY_URL")) || null;
            // File context: the ACTUAL open document list, so "what's left?" gets a
            // precise answer instead of filler.
            let missingDocs: string[] = [];
            if ((lf as any)?.id) {
              const { data: docs } = await supabaseAdmin.from("loan_documents").select("name, status, required").eq("loan_file_id", (lf as any).id);
              missingDocs = (docs || []).filter((d: any) => d.required && d.status !== "received" && d.status !== "accepted").map((d: any) => String(d.name));
            }
            // Conversation memory from prior days (leadRow fetched above for the opt-out guard).
            const knownFacts: string[] = Array.isArray((leadRow as any)?.raw?.concierge_facts) ? (leadRow as any).raw.concierge_facts : [];
            // Handoff: certain signals page the owner in parallel (AI still replies).
            const signal = handoffSignal(body);
            // LIVE BRIDGE (owner rule 2026-07-08): a warm lead explicitly asking for a
            // human gets a real shot at a live call — Mark says he's checking, the owner
            // gets the press-1 whisper, and accept = the system dials the lead and
            // connects them. Decline/timeout = calendar text. The press-1 screen (plus
            // the 2h throttle inside /api/voice/bridge) is the no-bots/no-waste gate.
            if (signal === "asked for a human" && (lead as any).phone && process.env.CRON_SECRET) {
              // THE MASTER SHUTOFF HAS TO APPLY HERE TOO. This branch runs BEFORE
              // markConciergeReply, so with AUTOMATION_PAUSED='1' silencing every other engine
              // a borrower who replied "call me" still received two automated texts — this one
              // and the bridge fallback. `handoffSignal` matches "call me | human | real person",
              // i.e. exactly the borrower most likely to be mid-conversation at any hour.
              const paused = await automationPaused();
              const holdMsg = `You got it — let me see if Ramon can jump on a quick call with you right now. Give me a minute. (Reply STOP to opt out.)`;
              const hs = paused
                ? { ok: false, sid: undefined as string | undefined, detail: "automation paused" }
                : await sendSms(leadPhone, holdMsg);
              if (hs.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: holdMsg, to: leadPhone, providerId: hs.sid, actor: "agent:mark" }).catch(() => {});
              // Fire-and-forget: the bridge endpoint handles the whisper, the connect,
              // and the fallback text — this webhook must return fast.
              fetch(`${APP_URL}/api/voice/bridge`, {
                method: "POST", headers: { "Content-Type": "application/json", "x-fetti-internal": process.env.CRON_SECRET },
                body: JSON.stringify({ lead_id: leadId, reason: body.slice(0, 140) }),
              }).catch((e) => console.error("[sms/inbound] bridge fire failed:", e?.message));
              return; // Mark's hold text + the bridge outcome cover this turn — no AI double-reply
            }
            if (signal) {
              // Internal page to the OWNER — the documented use for allowQuietHours (not a
              // solicitation). Still routed through the one send primitive: "this one is
              // different" is how all four consumer-facing bypasses started.
              const owner = process.env.LEAD_NOTIFY_SMS_TO;
              if (owner) {
                await sendSms(owner, `🔴 HANDOFF (${signal}) — ${(lead as any).full_name || from}: "${body.slice(0, 140)}" → ${APP_URL}/conversations`, { allowQuietHours: true }).catch(() => {});
              }
            }
            // Pre-filled application link = the conversion CTA — but only while they're
            // still pre-application; past that the doc-upload link is the next step.
            const stageNow = String((lead as any).stage || "").toLowerCase();
            const appLink = /application|processing|underwriting|approved|clear|closed|won|funded|dead|lost/.test(stageNow) ? null : magicApplyLink(lead as any);
            const r = await markConciergeReply({ lead, history, fileLink, appLink, firstAiReply: firstAi, calendlyUrl, missingDocs, knownFacts, expertise: expertiseFor(lead, body) });
            if (r.ok && r.reply) {
              const s = await sendSms(leadPhone, r.reply);
              if (s.ok) await logComms({ leadId, channel: "sms", direction: "outbound", type: "ai_reply", body: r.reply, to: leadPhone, providerId: s.sid, actor: "agent:mark" });
              else console.warn("[sms/inbound] AI reply send failed:", s.detail);
              // Persist conversation memory (best-effort) so tomorrow's Mark remembers today.
              try {
                const facts = await extractConversationFacts([...history, { role: "assistant", content: r.reply }], knownFacts);
                if (facts.length) {
                  const raw2 = ((leadRow as any)?.raw && typeof (leadRow as any).raw === "object") ? (leadRow as any).raw : {};
                  raw2.concierge_facts = facts;
                  await supabaseAdmin.from("leads").update({ raw: raw2 }).eq("id", leadId);
                }
              } catch { /* memory is best-effort */ }
            } else { console.warn("[sms/inbound] AI concierge skipped:", r.detail); }
          } catch (e) { console.warn("[sms/inbound] AI concierge error", e); }
        });
      }

      const hook = process.env.LEAD_NOTIFY_WEBHOOK;
      if (hook) {
        const who = (lead as any)?.full_name || from;
        const note = isStop
          ? (lead ? "🛑 STOP — opted out, nurture paused (compliance)." : "🛑 STOP received (no matching lead).")
          : (lead ? "🔥 Hot reply — respond now! (auto-nurture still active)" : "(no matching lead found)");
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `💬 **Lead replied** — ${who} (${from})\n"${body}"\n${note}`,
          }),
        });
      }
    }
  } catch (e) {
    console.warn("[sms/inbound] error", e);
  }
  return new NextResponse("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
