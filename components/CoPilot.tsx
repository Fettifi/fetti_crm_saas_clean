"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

export default function CoPilot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm Feddy, your Fetti CRM Co-Pilot. How can I help you manage your leads today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSendMessage() {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Mock API call
    setTimeout(async () => {
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `I'm analyzing your request regarding "${userMsg.content}". As your Matrix Co-Pilot, I can help you automate follow-ups or analyze lead quality. What would you like to do next?`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);

      // --- Custom Voice Integration ---
      if (!isMuted) {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: assistantMsg.content }),
          });

          if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            if (audioRef.current) {
              audioRef.current.src = url;
              audioRef.current.play();
            } else {
              const audio = new Audio(url);
              audioRef.current = audio;
              audio.play();
            }
          }
        } catch (err) {
          console.error("Speech playback error:", err);
        }
      }
    }, 1000);
  }

  return (
    <div className="flex h-[400px] w-full flex-col overflow-hidden rounded-xl border border-emerald-500/20 bg-slate-900/40 backdrop-blur-md shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-emerald-500/10 bg-emerald-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Feddy Co-Pilot
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500 font-medium">MATRIX v1.0</span>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`transition-colors ${isMuted ? 'text-rose-500' : 'text-emerald-500'}`}
            title={isMuted ? "Unmute Feddy" : "Mute Feddy"}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.535 8.465a.75.75 0 0 1 1.06 0L22.344 11.25l2.75-2.75a.75.75 0 1 1 1.06 1.06l-2.75 2.75 2.75 2.75a.75.75 0 1 1-1.06 1.06l-2.75-2.75-2.75 2.75a.75.75 0 1 1-1.06-1.06l2.75-2.75-2.75-2.75a.75.75 0 0 1 0-1.06Z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.535 8.465a.75.75 0 0 1 1.06 0 5.25 5.25 0 0 1 0 7.424.75.75 0 1 1-1.06-1.06 3.75 3.75 0 0 0 0-5.304.75.75 0 0 1 0-1.06Z" />
                <path d="M21.717 5.283a.75.75 0 0 1 1.06 0 9.75 9.75 0 0 1 0 13.788.75.75 0 1 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"
              }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${msg.role === "user"
                ? "bg-emerald-600 text-white rounded-tr-none"
                : "bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none"
                }`}
            >
              {msg.content}
            </div>
            <span className="mt-1 text-[9px] text-slate-500 px-1">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-1.5 px-2">
            <div className="h-1 w-1 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
            <div className="h-1 w-1 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
            <div className="h-1 w-1 rounded-full bg-emerald-400 animate-bounce" />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-800/50 bg-slate-950/30">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            placeholder="Ask Feddy..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 pr-12 text-xs text-slate-200 transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim()}
            className="absolute right-2 p-1.5 text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-30"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
