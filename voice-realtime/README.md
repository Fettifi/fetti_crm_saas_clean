# Realtime Mark — voice bridge

Makes Mark **real to talk to**: full-duplex, talk-over-him, zero-lag speech-to-speech via the OpenAI Realtime API, bridged to a Twilio phone number. Drops the captured message into the Fetti CRM (`/messages`).

This **cannot run on Vercel** (serverless can't hold a live audio websocket). It runs as a tiny always-on Node server.

## Deploy (Render / Fly / Railway — ~free–$7/mo)

1. Push this `voice-realtime/` folder to its own repo (or deploy the subfolder).
2. New **Web Service**, build `npm install`, start `npm start`. (Render/Railway auto-detect Node.)
3. Set env vars on the host:
   - `OPENAI_API_KEY` — same key as the CRM
   - `VOICE_INGEST_TOKEN` — the value stored in the CRM (`app_settings.VOICE_INGEST_TOKEN`)
   - `CRM_INGEST_URL` — `https://app.fettifi.com/api/voice/ingest` (default)
   - `OPENAI_REALTIME_MODEL` *(optional)* — default `gpt-4o-realtime-preview`
   - `OPENAI_REALTIME_VOICE` *(optional)* — default `verse` (warm). Try `echo`, `ballad`, `ash`.
4. The host gives you a public URL, e.g. `https://fetti-voice.onrender.com`. Your stream URL is the **wss** form + `/media`:
   `wss://fetti-voice.onrender.com/media`

## Point the phone at it

In the Fetti CRM, set `REALTIME_VOICE_WSS` (app_settings) to that `wss://…/media` URL. `/api/voice/incoming` then auto-returns `<Connect><Stream>` to this server — the **same Twilio number** (or forwarded office line) now uses realtime Mark instead of the turn-based version. No Twilio change needed.

## Notes
- Audio is `g711_ulaw` on both sides (Twilio + OpenAI), so there's no transcoding — lowest latency.
- Voice is OpenAI's **native realtime voice** (extremely natural, conversational). It is NOT Mark's exact ElevenLabs voiceprint — matching that in realtime needs a Realtime-text → ElevenLabs-streaming pipeline (higher latency); start with the native voice, it's the "real conversation" win.
- Barge-in: when the caller starts talking, Mark's audio is cleared and his response cancelled — natural interruptions.
- Compliance: Mark greets as "the virtual assistant" (CA bot-disclosure). Do not remove.
- Expect to tune VAD timing / the greeting after the first live call.
