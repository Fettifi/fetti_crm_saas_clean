"use client";

// Rupee — the in-CRM AI strategist. Voice + text. She talks to the existing
// /api/chat brain (Claude when ANTHROPIC_API_KEY is set, else OpenAI), which
// already has tools + long-term memory (The Vault). You speak (mic → Whisper),
// she answers and talks back in her ElevenLabs voice.
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const RUPEE_VOICE = "NBA1cQRTWFj793Oifdaj"; // ElevenLabs "Rupee" voice
const STORAGE_KEY = "rupee_thread_v1";
const GREETING =
  "Hey — I'm Rupee. Your co-founder, strategist, and oracle for Fetti. Talk to me like a partner: ask me to read the funnel, draft a follow-up, map a move, or build something. What are we doing?";

export default function RupeePage() {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsQueueRef = useRef<string[]>([]);
  const playingRef = useRef(false);

  // restore / persist the thread
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) setMessages(parsed);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu;

  // Stop any speech in progress and clear the queue (barge-in).
  function stopSpeech() {
    ttsQueueRef.current = [];
    playingRef.current = false;
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} audioRef.current = null; }
  }

  // Play queued speech chunks one after another, fetching each as it's needed.
  async function playQueue() {
    if (playingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: next.slice(0, 800), voiceId: RUPEE_VOICE }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const a = new Audio(URL.createObjectURL(blob));
        audioRef.current = a;
        const advance = () => { playingRef.current = false; playQueue(); };
        a.onended = advance;
        a.onerror = advance;
        a.play().catch(advance);
        return;
      }
    } catch {}
    playingRef.current = false;
    playQueue();
  }

  // Queue a chunk of text to be spoken (emojis/markdown stripped for the ear).
  function enqueueSpeech(text: string) {
    if (!voiceOn) return;
    const clean = text.replace(/[*_`#>~]/g, "").replace(EMOJI, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    ttsQueueRef.current.push(clean);
    if (!playingRef.current) playQueue();
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    const history: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages(history);
    setBusy(true);
    setStatus("Thinking…");
    stopSpeech();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, message: clean, mode: "co-founder" }),
      });
      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalText = "";
      let streamed = "";
      let draftStarted = false;
      let spokenCursor = 0;

      // Speak complete sentences as they finish streaming; on the final flush,
      // speak whatever's left even without terminal punctuation.
      const flushSentences = (final: boolean) => {
        const pending = streamed.slice(spokenCursor);
        if (!pending) return;
        if (final) { enqueueSpeech(pending); spokenCursor += pending.length; return; }
        const m = pending.match(/^[\s\S]*[.!?…](?=\s)/);
        if (!m) return;
        enqueueSpeech(m[0]);
        spokenCursor += m[0].length;
      };

      const handle = (evt: any) => {
        if (evt.type === "token") {
          streamed += evt.text || "";
          if (!draftStarted) {
            draftStarted = true;
            setStreaming(true);
            setStatus(null);
            setMessages((m) => [...m, { role: "assistant", content: streamed }]);
          } else {
            setMessages((m) => { const c = m.slice(); c[c.length - 1] = { role: "assistant", content: streamed }; return c; });
          }
          flushSentences(false);
        } else if (evt.type === "status") {
          if (!draftStarted) setStatus(evt.message || "Working…");
        } else if (evt.type === "result") {
          finalText = evt.message || finalText;
        } else if (evt.type === "error") {
          finalText = "⚠️ " + (evt.message || "Something went wrong.");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          handle(evt);
        }
      }
      if (buf.trim()) { try { handle(JSON.parse(buf)); } catch {} }

      const reply = finalText || streamed || "…";
      setMessages((m) => {
        const c = m.slice();
        if (draftStarted) c[c.length - 1] = { role: "assistant", content: reply };
        else c.push({ role: "assistant", content: reply });
        return c;
      });
      if (draftStarted) flushSentences(true);
      else enqueueSpeech(reply);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ " + (e?.message || "Connection error.") }]);
    } finally {
      setBusy(false);
      setStreaming(false);
      setStatus(null);
    }
  }

  async function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      stopSpeech(); // barge-in: hush her the moment you start talking
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1200) return;
        setStatus("Listening…");
        try {
          const fd = new FormData();
          fd.append("audio", blob, "speech.webm");
          const res = await fetch("/api/rupee/listen", { method: "POST", body: fd });
          const json = await res.json();
          setStatus(null);
          if (json.text) send(json.text);
        } catch { setStatus(null); }
      };
      rec.start();
      setRecording(true);
    } catch {
      alert("I couldn't reach your mic. Check browser permissions and try again.");
    }
  }

  function resetThread() {
    setMessages([{ role: "assistant", content: GREETING }]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 to-white text-slate-900 flex flex-col">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="relative">
            <div className={`h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center text-white font-black ${busy || recording ? "animate-pulse" : ""}`}>R</div>
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${busy ? "bg-amber-400" : recording ? "bg-rose-500" : "bg-emerald-500"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight">Rupee</div>
            <div className="text-xs text-slate-500 truncate">{status || "Your AI co-founder · strategist · oracle"}</div>
          </div>
          <button onClick={() => setVoiceOn((v) => { if (v) stopSpeech(); return !v; })} title="Toggle voice"
            className={`rounded-full px-3 py-1.5 text-sm font-semibold border transition ${voiceOn ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-300"}`}>
            {voiceOn ? "🔊 Voice" : "🔈 Muted"}
          </button>
          <button onClick={resetThread} title="New chat" className="rounded-full px-3 py-1.5 text-sm font-semibold border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">New</button>
        </div>
      </header>

      {/* thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm ${
                m.role === "user"
                  ? "bg-emerald-600 text-white rounded-br-sm"
                  : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && !streaming && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-white border border-slate-200 px-4 py-3 shadow-sm">
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-end gap-2">
          <button
            onClick={toggleMic}
            disabled={busy}
            title={recording ? "Stop & send" : "Hold a thought — tap to talk"}
            className={`shrink-0 h-11 w-11 rounded-full flex items-center justify-center text-lg transition disabled:opacity-50 ${
              recording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {recording ? "■" : "🎙️"}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder={recording ? "Listening…" : "Talk to Rupee, or type…"}
            className="flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-[15px] focus:border-emerald-500 focus:outline-none max-h-40"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="shrink-0 h-11 px-5 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold"
          >
            ↑
          </button>
        </div>
        <p className="text-center text-[11px] text-slate-400 pb-2">Rupee can take actions in your CRM. Double-check anything irreversible before you confirm.</p>
      </div>
    </div>
  );
}
