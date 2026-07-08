// Realtime "Penny" voice bridge — Twilio Media Streams <-> OpenAI Realtime API (GA).
//
// Full-duplex, talk-over-him (barge-in), zero-lag speech-to-speech. CANNOT run on Vercel
// (serverless can't hold a live audio websocket) — deploy on a tiny always-on host
// (Render/Fly/Railway). See README.md.
//
// Flow: Twilio number's voice webhook (Fetti CRM /api/voice/incoming, once
// REALTIME_VOICE_WSS is set) returns <Connect><Stream url="wss://THIS_HOST/media"/>.
// Twilio streams caller audio here; we relay it to OpenAI Realtime and stream Penny's
// audio back. When Penny has the message she calls save_message → POST to the CRM
// (/api/voice/ingest). g711_ulaw (audio/pcmu) both sides → no transcoding.
//
// NOTE: uses the OpenAI Realtime GA API (the old "beta" shape was retired 2025 — it
// returns beta_api_shape_disabled). GA = NO "OpenAI-Beta" header; session config nests
// under session.audio.*; audio events are response.output_audio*.
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime"; // GA model
const VOICE = process.env.OPENAI_REALTIME_VOICE || "marin"; // female GA voice for Penny (marin; alt: coral, sage, shimmer)
const CRM_INGEST_URL = process.env.CRM_INGEST_URL || "https://app.fettifi.com/api/voice/ingest";
const VOICE_INGEST_TOKEN = process.env.VOICE_INGEST_TOKEN || "";
const CRM_LOOKUP_URL = process.env.CRM_LOOKUP_URL || "https://app.fettifi.com/api/voice/lookup";
const CRM_TRANSFER_URL = process.env.CRM_TRANSFER_URL || "https://app.fettifi.com/api/voice/transfer";

// MANDATORY opening line — Penny's FIRST utterance, NON-INTERRUPTIBLE (barge-in ignored
// until it finishes). Combines CA SB 1001 (automated-AI disclosure) + CA §632 (recorded/
// transcribed → continuing = implied consent).
const OPENING = "You've reached Fetti Financial Services. Quick heads-up — this is Penny, an automated A.I. assistant, and this call is recorded and transcribed for quality and record-keeping. Now — who am I speaking with, and what can I help you with today?";

const INSTRUCTIONS = `You are Penny, the warm, sharp, professional receptionist and virtual assistant for Fetti Financial Services LLC (a licensed mortgage lender & broker, NMLS 2267023). California-cool, intelligent, smooth — never robotic. You are an automated A.I. assistant and must never claim to be human.
Your VERY FIRST words on the call must be, word for word: "${OPENING}" — say exactly that before anything else (it is a legally required disclosure that you're an automated A.I. assistant and the call is recorded), then continue naturally. Never skip it, shorten it, or talk over it.
After the opening, talk like a real person on the phone: natural, brief, conversational; let the caller interrupt you and roll with it.
LIVE TRANSFER: you CAN attempt a live transfer to Ramon when the caller asks to speak with him or the matter is clearly urgent/time-sensitive (existing borrower with a live deal, deadline, or a referral partner). FIRST get their name and the reason. Then say something like "Let me see if he's available — one moment, stay with me" and CALL the transfer_call tool. NEVER promise he'll pick up. CRITICAL: while checking, NEVER say he is available, never say you are transferring or connecting — you do NOT know yet. Say only that you're checking. Announce a connection ONLY if the tool returns connected; if it returns unavailable, apologize warmly ("he's tied up right now") and take a detailed message. If the tool says he's unavailable, say he's tied up right now and take a detailed message instead. Never give out his direct line/email/personal contact. For routine inquiries, vendors, and solicitors, take a message — don't attempt a transfer. TRANSFER ELIGIBILITY: attempt transfer_call ONLY for (a) callers matched in the CRM as clients/leads, or (b) business callers who have FULLY identified themselves (name + company + reason) with a clearly legitimate, deal-related, time-sensitive matter — and include their company in the transfer reason. NEVER attempt a transfer for an unidentified caller or anyone selling something.
Get the caller's name, best callback number, and the FULL, specific reason for the call (loan type, property, dollar amount, timeline, who referred them, urgency). Ask natural follow-ups until it's genuinely detailed.
Do NOT quote specific rates, confirm approvals, or give financial advice — take the message and defer specifics to the team. Stay compliant; make no promises.
If the caller wants to schedule a call, book a time, or talk to a person, use the book_call tool (capture their name, number, and what they want to discuss) and tell them the team will send a scheduling link and follow up shortly. You NEVER place outbound calls.
Once you have name + callback number + a detailed reason: briefly read the key details back, tell them the team will follow up shortly, CALL the save_message tool, then warmly close.`;

const TOOLS = [
  {
    type: "function",
    name: "save_message",
    description: "Save the caller's message to the CRM. Call this once you have the caller's name, callback number, and a detailed reason — before ending the call.",
    parameters: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        callback_number: { type: "string" },
        reason: { type: "string", description: "full, specific reason for the call" },
        urgency: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["caller_name", "callback_number", "reason"],
    },
  },
  {
    type: "function",
    name: "transfer_call",
    description: "Attempt a LIVE transfer to Ramon. Use ONLY after getting the caller's name and reason, and after telling them to hold while you check availability. Returns whether he accepted; if not, take a detailed message.",
    parameters: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        reason: { type: "string", description: "one line: who they are and what it's about" },
        callback_number: { type: "string" },
      },
      required: ["caller_name", "reason"],
    },
  },
  {
    type: "function",
    name: "book_call",
    description: "Use when the caller wants to schedule/book a call or speak with someone. Flags a HIGH-priority booking request in the CRM so the team sends a scheduling link and follows up. Does NOT place an outbound call.",
    parameters: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        callback_number: { type: "string" },
        topic: { type: "string", description: "what they want to discuss / book about" },
      },
      required: ["caller_name", "callback_number"],
    },
  },
];

async function postToCrm(payload) {
  // Retry 3x with backoff — a transient Vercel/network blip must never lose a
  // borrower's message. Returns true only on a 2xx.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(CRM_INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOICE_INGEST_TOKEN}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return true;
      console.error(`ingest attempt ${attempt} HTTP ${r.status}`);
    } catch (e) { console.error(`ingest attempt ${attempt}:`, e?.message); }
    await new Promise((res) => setTimeout(res, attempt * 1500));
  }
  console.error("INGEST FAILED after retries — payload:", JSON.stringify(payload).slice(0, 500));
  return false;
}

const server = http.createServer((_req, res) => { res.writeHead(200); res.end("Fetti realtime voice bridge — OK rev=" + (process.env.BRIDGE_REV || "unknown")); });
const wss = new WebSocketServer({ server, path: "/media" });

wss.on("connection", (twilio) => {
  let streamSid = null;
  let callSid = null;
  let caller = null;
  let obMode = null, obFirst = "", obContext = ""; // outbound call mode (confirm|callback)
  let dynamicOpening = null;      // outbound calls swap the mandatory opening line              // caller's phone number (from Twilio start customParameters)
  let greeted = false;            // true once the opening disclosure finishes → barge-in allowed
  let oaiOpen = false, startSeen = false, started = false;
  let messageSaved = false;       // save_message succeeded → no salvage needed
  let transferred = false;        // live transfer accepted → stream teardown is EXPECTED
  let salvaged = false;
  const transcript = [];
  // On ANY teardown (caller hung up early, OpenAI dropped, bridge restart): if Penny
  // heard something real but never saved a message, persist the partial transcript —
  // a dropped call must still surface in /messages instead of vanishing.
  async function salvageIfNeeded(why) {
    if (messageSaved || salvaged || transferred) return;
    const callerLines = transcript.filter((t) => t.startsWith("Caller:"));
    if (!callerLines.length) return;
    salvaged = true;
    try {
      await postToCrm({
        caller_name: obFirst || null, callback_number: caller || null,
        // An OUTBOUND call ending without a saved outcome is normal wrap-up, not an
        // emergency — label it as a summary instead of a callback alarm.
        reason: obMode
          ? `📞 Outbound ${obMode} call ended — transcript below`
          : `⚠️ CALL ENDED EARLY (${why}) — partial transcript below; call back`,
        urgency: obMode ? "normal" : "high",
        call_sid: callSid, transcript: transcript.join("\n"),
      });
    } catch { /* postToCrm already retries + logs */ }
  }
  const oai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, // GA: NO "OpenAI-Beta" header
  });

  // Begin the OpenAI session only once BOTH the OpenAI socket is open AND Twilio's "start"
  // (which carries the caller number) has arrived — so Penny can do a quick CRM lookup and
  // greet personally. The lookup is bounded (fast fallback to a generic greeting) and
  // one-time at connect, so it never adds per-turn conversation latency.
  async function beginSession() {
    if (started || !oaiOpen || !startSeen) return;
    started = true;
    let ctx = "";
    if (obMode === "confirm" || obMode === "callback") {
      // OUTBOUND CALL (we dialed them): different opening + tight scope. Consent and
      // no-cold-call gates were enforced server-side before this call was placed.
      const who = obFirst ? ` Am I speaking with ${obFirst}?` : " Who am I speaking with?";
      const obOpening = obMode === "confirm"
        ? `Hi! This is Penny, the automated A.I. assistant for Fetti Financial Services — quick heads-up, this call is recorded and transcribed.${who}`
        : `Hi! This is Penny, the automated A.I. assistant for Fetti Financial Services, returning your call — and a quick heads-up, this call is recorded and transcribed.${who}`;
      ctx = `\n\nOUTBOUND MODE (${obMode}): WE called THEM — ${obContext}\n` + (obMode === "confirm"
        ? `Your ONLY job: warmly confirm they can still make the appointment. If yes: great, tell them Ramon is looking forward to it, ask if there's anything they'd like him to prepare, then wrap up and CALL save_message with the outcome (reason starting "APPT CONFIRMED — "). If they need to reschedule: no problem — tell them a fresh scheduling link is coming by text/email, use book_call, and save_message (reason starting "WANTS RESCHEDULE — "). Keep the whole call under two minutes; do NOT sell, do NOT collect documents, do NOT quote numbers. If they ask to speak to Ramon now, you may use transfer_call as usual. If they say stop calling / not interested: apologize once, confirm no more calls, save_message (reason starting "CALL OPT-OUT — "), and end warmly.`
        : `You're RETURNING their call — they reached out to us first. Ask how you can help, handle it exactly like an inbound call (messages, booking, transfer_call if they want Ramon — whisper rules apply). If they don't remember calling or want no calls: apologize once, confirm no more calls, save_message (reason starting "CALL OPT-OUT — "), and end warmly.`);
      // Outbound opening replaces the inbound one for this session.
      dynamicOpening = obOpening;
    } else if (caller) {
      try {
        const r = await fetch(CRM_LOOKUP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOICE_INGEST_TOKEN}` },
          body: JSON.stringify({ phone: caller }),
          signal: AbortSignal.timeout(1200),
        });
        const j = await r.json();
        if (j && j.known) {
          const bits = [j.first_name ? `first name: ${j.first_name}` : null, j.loan_purpose ? `working on: ${j.loan_purpose}` : null, j.stage ? `pipeline stage: ${j.stage}` : null].filter(Boolean).join("; ");
          ctx = `\n\nCALLER CONTEXT (matched from the CRM by their phone number — this is NOT proof of identity): ${bits}. Right after the required disclosure, warmly greet them by first name and naturally reference what they're working on (e.g. "…and it looks like you're on your ${j.loan_purpose || "loan"} — how can I help today?"). Do NOT reveal sensitive specifics (loan amounts, SSN, documents, addresses) — keep it a warm, general acknowledgment. If they indicate they're someone else, drop this context and treat them as a new caller.`;
        } else {
          ctx = `\n\nCALLER CONTEXT: this number does NOT match any client or lead in the CRM — treat them as UNKNOWN. If they are (or sound like they are) calling FROM A BUSINESS — a lender, title company, vendor, recruiter, marketer, "partnership opportunity", or any sales call — you MUST get, before helping further: (1) their full name, (2) the company they're calling from, and (3) specifically why they're calling. Be warm but firm — do not proceed, answer questions, or discuss Ramon's availability until you have all three. If they refuse to identify themselves or their company, say Ramon doesn't take unidentified business calls, offer to pass along a message if they change their mind, and politely wrap up. Obvious solicitors/cold pitches: take a ONE-LINE message (name, company, number, what they're selling) and end courteously — never transfer them, never book them. DEPARTMENT REQUESTS: anyone asking for \"accounts payable\", \"billing\", \"accounting\", \"HR\", \"the owner\", or \"whoever handles your marketing/website/ads\" is almost always a vendor, collector, or salesperson — do NOT transfer, do NOT confirm whether any such department or person exists, and do NOT discuss company finances. Automatically go to message mode: get their full name, company, callback number, and EXACTLY what it concerns (invoice number and amount if they claim one is owed), then close politely. If they claim an unpaid or overdue invoice, capture every detail they'll give and mark the message urgency high. If they're a regular CONSUMER asking about a loan for themselves, this screen does not apply — treat them as a warm new borrower (normal intake: name, number, what they're looking to do).`;
        }
      } catch { /* lookup slow/failed → generic greeting, call still proceeds */ }
    }
    // GA Realtime session shape: audio config nested under session.audio.*, formats are
    // objects (audio/pcmu = g711 u-law), modalities -> output_modalities.
    oai.send(JSON.stringify({ type: "session.update", session: {
      type: "realtime",
      instructions: (dynamicOpening ? INSTRUCTIONS.split(OPENING).join(dynamicOpening) : INSTRUCTIONS) + ctx,
      output_modalities: ["audio"],
      audio: {
        input: { format: { type: "audio/pcmu" }, turn_detection: { type: "server_vad" }, transcription: { model: "whisper-1" } },
        output: { format: { type: "audio/pcmu" }, voice: VOICE },
      },
      tools: TOOLS, tool_choice: "auto",
    } }));
    // The verbatim SB 1001 + §632 disclosure is mandated as Penny's first utterance inside
    // INSTRUCTIONS; a bare response.create kicks it off (non-interruptible via `greeted`).
    oai.send(JSON.stringify({ type: "response.create" }));
  }

  oai.on("open", () => { oaiOpen = true; beginSession(); });

  oai.on("message", async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "response.output_audio.delta" && m.delta && streamSid) {
      twilio.send(JSON.stringify({ event: "media", streamSid, media: { payload: m.delta } }));
    } else if (m.type === "response.done") {
      greeted = true; // opening disclosure (and every later turn) done → allow barge-in
    } else if (m.type === "input_audio_buffer.speech_started" && streamSid) {
      if (!greeted) return; // never let the caller cut off the legal disclosure
      twilio.send(JSON.stringify({ event: "clear", streamSid }));   // barge-in: stop Penny
      oai.send(JSON.stringify({ type: "response.cancel" }));
    } else if (m.type === "conversation.item.input_audio_transcription.completed" && m.transcript) {
      transcript.push("Caller: " + m.transcript.trim());
    } else if (m.type === "response.output_audio_transcript.done" && m.transcript) {
      transcript.push("Penny: " + m.transcript.trim());
    } else if (m.type === "response.function_call_arguments.done") {
      try {
        const args = JSON.parse(m.arguments || "{}");
        if (m.name === "save_message") {
          messageSaved = (await postToCrm({ ...args, call_sid: callSid, transcript: transcript.join("\n") })) === true;
        } else if (m.name === "transfer_call") {
          // Screened transfer: CRM rings Ramon with a press-1 whisper while the
          // caller holds with Penny. Keep-alive at ~18s so the hold never goes dead.
          let resolved = false;
          const keepAlive = setTimeout(() => {
            if (resolved) return;
            try {
              oai.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: "Still checking on his availability — briefly reassure the caller and thank them for holding. Do NOT say he is available or that you are transferring; you do not know the outcome yet. Do not end the call." }] } }));
              oai.send(JSON.stringify({ type: "response.create" }));
            } catch (e) { /* */ }
          }, 18000);
          let accepted = false;
          try {
            const r = await fetch(CRM_TRANSFER_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOICE_INGEST_TOKEN}` },
              body: JSON.stringify({ ...args, call_sid: callSid, callback_number: args.callback_number || caller || null }),
              signal: AbortSignal.timeout(50000),
            });
            const j = await r.json().catch(() => ({}));
            accepted = j && j.accepted === true;
          } catch (e) { console.error("transfer request failed:", e?.message); }
          resolved = true; clearTimeout(keepAlive);
          if (accepted) {
            transferred = true;
            // Caller is being redirected into the conference — the stream will end.
            // No further speech from Penny (she'd talk over the connect message).
            oai.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: '{"result":"connected — say NOTHING, the call is being bridged"}' } }));
            return;
          }
          oai.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: '{"result":"unavailable — tell the caller he is tied up right now and take a detailed message (name, number, full reason), then save_message"}' } }));
          oai.send(JSON.stringify({ type: "response.create" }));
          return; // CRITICAL: never fall through to the shared {"ok":true} output below —
                  // a duplicate SUCCESS result for the same call_id made Penny announce
                  // a transfer that had just been DECLINED (live-test bug 2026-07-08).
        } else if (m.name === "book_call") {
          await postToCrm({
            caller_name: args.caller_name, callback_number: args.callback_number,
            reason: "📅 WANTS TO BOOK A CALL" + (args.topic ? " — " + args.topic : ""),
            urgency: "high", wants_booking: true, call_sid: callSid, transcript: transcript.join("\n"),
          });
        }
        oai.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: '{"ok":true}' } }));
        oai.send(JSON.stringify({ type: "response.create" }));
      } catch (e) { console.error("tool/ingest failed", e?.message); }
    } else if (m.type === "error") {
      console.error("OpenAI realtime error:", JSON.stringify(m.error || m).slice(0, 300));
    }
  });

  twilio.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.event === "start") {
      streamSid = m.start.streamSid; callSid = m.start.callSid;
      caller = (m.start.customParameters && m.start.customParameters.caller) || null;
      obMode = (m.start.customParameters && m.start.customParameters.mode) || null;
      obFirst = (m.start.customParameters && m.start.customParameters.first) || "";
      obContext = (m.start.customParameters && m.start.customParameters.context) || "";
      startSeen = true; beginSession();
    }
    else if (m.event === "media" && oai.readyState === WebSocket.OPEN) {
      oai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: m.media.payload }));
    } else if (m.event === "stop") { try { oai.close(); } catch {} }
  });

  twilio.on("close", () => { salvageIfNeeded("caller disconnected"); try { oai.close(); } catch {} });
  oai.on("close", () => { salvageIfNeeded("AI connection dropped"); try { twilio.close(); } catch {} });
  oai.on("error", (e) => { console.error("OpenAI ws error", e?.message); salvageIfNeeded("AI error"); });
});

server.listen(PORT, () => console.log(`Fetti realtime voice bridge listening on :${PORT} (path /media, model ${MODEL}, GA)`));
