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

// MANDATORY opening line — Penny's FIRST utterance, NON-INTERRUPTIBLE (barge-in ignored
// until it finishes). Combines CA SB 1001 (automated-AI disclosure) + CA §632 (recorded/
// transcribed → continuing = implied consent).
const OPENING = "You've reached Fetti Financial Services. Quick heads-up — this is Penny, an automated A.I. assistant, and this call is recorded and transcribed for quality and record-keeping. Now — who am I speaking with, and what can I help you with today?";

const INSTRUCTIONS = `You are Penny, the warm, sharp, professional receptionist and virtual assistant for Fetti Financial Services LLC (a licensed mortgage lender & broker, NMLS 2267023). California-cool, intelligent, smooth — never robotic. You are an automated A.I. assistant and must never claim to be human.
Your VERY FIRST words on the call must be, word for word: "${OPENING}" — say exactly that before anything else (it is a legally required disclosure that you're an automated A.I. assistant and the call is recorded), then continue naturally. Never skip it, shorten it, or talk over it.
After the opening, talk like a real person on the phone: natural, brief, conversational; let the caller interrupt you and roll with it.
Ramon Dent is NOT available for a live transfer. For ANYONE asking for Ramon (or anyone at Fetti), warmly take a detailed message — never promise a transfer, never give out a direct line/email/personal contact.
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
  return fetch(CRM_INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOICE_INGEST_TOKEN}` },
    body: JSON.stringify(payload),
  });
}

const server = http.createServer((_req, res) => { res.writeHead(200); res.end("Fetti realtime voice bridge — OK"); });
const wss = new WebSocketServer({ server, path: "/media" });

wss.on("connection", (twilio) => {
  let streamSid = null;
  let callSid = null;
  let caller = null;              // caller's phone number (from Twilio start customParameters)
  let greeted = false;            // true once the opening disclosure finishes → barge-in allowed
  let oaiOpen = false, startSeen = false, started = false;
  const transcript = [];
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
    if (caller) {
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
        }
      } catch { /* lookup slow/failed → generic greeting, call still proceeds */ }
    }
    // GA Realtime session shape: audio config nested under session.audio.*, formats are
    // objects (audio/pcmu = g711 u-law), modalities -> output_modalities.
    oai.send(JSON.stringify({ type: "session.update", session: {
      type: "realtime",
      instructions: INSTRUCTIONS + ctx,
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
          await postToCrm({ ...args, call_sid: callSid, transcript: transcript.join("\n") });
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
      startSeen = true; beginSession();
    }
    else if (m.event === "media" && oai.readyState === WebSocket.OPEN) {
      oai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: m.media.payload }));
    } else if (m.event === "stop") { try { oai.close(); } catch {} }
  });

  twilio.on("close", () => { try { oai.close(); } catch {} });
  oai.on("close", () => { try { twilio.close(); } catch {} });
  oai.on("error", (e) => console.error("OpenAI ws error", e?.message));
});

server.listen(PORT, () => console.log(`Fetti realtime voice bridge listening on :${PORT} (path /media, model ${MODEL}, GA)`));
