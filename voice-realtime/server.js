// Realtime "Mark" voice bridge — Twilio Media Streams <-> OpenAI Realtime API.
//
// This is the engine that makes Mark REAL to talk to: full-duplex, talk-over-him
// (barge-in), zero-lag speech-to-speech. It CANNOT run on Vercel (serverless can't
// hold a live audio websocket) — deploy it on a tiny always-on host (Render, Fly,
// Railway; free/$7 tiers are plenty). See README.md.
//
// Flow: Twilio number's voice webhook (Fetti CRM /api/voice/incoming, once
// REALTIME_VOICE_WSS is set) returns <Connect><Stream url="wss://THIS_HOST/media"/>.
// Twilio streams caller audio here; we relay it to OpenAI Realtime and stream
// Mark's audio back. When Mark has the message he calls save_message → we POST it
// to the CRM (/api/voice/ingest). g711_ulaw on both sides → no transcoding.
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";
const VOICE = process.env.OPENAI_REALTIME_VOICE || "verse"; // warm, natural OpenAI voice
const CRM_INGEST_URL = process.env.CRM_INGEST_URL || "https://app.fettifi.com/api/voice/ingest";
const VOICE_INGEST_TOKEN = process.env.VOICE_INGEST_TOKEN || "";

const INSTRUCTIONS = `You are Mark, the warm, sharp, confident virtual assistant for Fetti Financial Services LLC (a licensed mortgage lender & broker, NMLS 2267023). California-cool, intelligent, smooth — never robotic. You greet AS the virtual assistant (this is legally required — never claim to be human).
Talk like a real person on the phone: natural, brief, conversational; let the caller interrupt you and roll with it.
Ramon Dent is NOT available for a live transfer. For ANYONE asking for Ramon (or anyone at Fetti), warmly take a detailed message — never promise a transfer, never give out a direct line/email/personal contact.
Get the caller's name, best callback number, and the FULL, specific reason for the call (loan type, property, dollar amount, timeline, who referred them, urgency). Ask natural follow-ups until it's genuinely detailed.
Do NOT quote specific rates, confirm approvals, or give financial advice — take the message and defer specifics to the team. Stay compliant; make no promises.
Once you have name + callback number + a detailed reason: briefly read the key details back, tell them the team will follow up shortly, CALL the save_message tool, then warmly close.`;

const TOOLS = [{
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
}];

const server = http.createServer((_req, res) => { res.writeHead(200); res.end("Fetti realtime voice bridge — OK"); });
const wss = new WebSocketServer({ server, path: "/media" });

wss.on("connection", (twilio) => {
  let streamSid = null;
  let callSid = null;
  const transcript = [];
  const oai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
  });

  oai.on("open", () => {
    oai.send(JSON.stringify({ type: "session.update", session: {
      instructions: INSTRUCTIONS, voice: VOICE,
      input_audio_format: "g711_ulaw", output_audio_format: "g711_ulaw",
      turn_detection: { type: "server_vad", silence_duration_ms: 500 },
      input_audio_transcription: { model: "whisper-1" },
      tools: TOOLS, tool_choice: "auto", modalities: ["audio", "text"],
    } }));
    oai.send(JSON.stringify({ type: "response.create", response: { instructions: "Open warmly: 'Hey, thanks for calling Fetti Financial Services — this is Mark, the virtual assistant. Who am I talking to, and what can I help you out with today?'" } }));
  });

  oai.on("message", async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "response.audio.delta" && m.delta && streamSid) {
      twilio.send(JSON.stringify({ event: "media", streamSid, media: { payload: m.delta } }));
    } else if (m.type === "input_audio_buffer.speech_started" && streamSid) {
      twilio.send(JSON.stringify({ event: "clear", streamSid }));   // barge-in: stop Mark
      oai.send(JSON.stringify({ type: "response.cancel" }));
    } else if (m.type === "conversation.item.input_audio_transcription.completed" && m.transcript) {
      transcript.push("Caller: " + m.transcript.trim());
    } else if (m.type === "response.audio_transcript.done" && m.transcript) {
      transcript.push("Mark: " + m.transcript.trim());
    } else if (m.type === "response.function_call_arguments.done" && m.name === "save_message") {
      try {
        const args = JSON.parse(m.arguments || "{}");
        await fetch(CRM_INGEST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOICE_INGEST_TOKEN}` },
          body: JSON.stringify({ ...args, call_sid: callSid, transcript: transcript.join("\n") }),
        });
        oai.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: m.call_id, output: '{"saved":true}' } }));
        oai.send(JSON.stringify({ type: "response.create" }));
      } catch (e) { console.error("ingest failed", e?.message); }
    }
  });

  twilio.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.event === "start") { streamSid = m.start.streamSid; callSid = m.start.callSid; }
    else if (m.event === "media" && oai.readyState === WebSocket.OPEN) {
      oai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: m.media.payload }));
    } else if (m.event === "stop") { try { oai.close(); } catch {} }
  });

  twilio.on("close", () => { try { oai.close(); } catch {} });
  oai.on("close", () => { try { twilio.close(); } catch {} });
  oai.on("error", (e) => console.error("OpenAI ws error", e?.message));
});

server.listen(PORT, () => console.log(`Fetti realtime voice bridge listening on :${PORT} (path /media)`));
