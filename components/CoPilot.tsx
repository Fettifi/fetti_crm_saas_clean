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
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setTimeout(() => {
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `I'm analyzing your request regarding "${userMsg.content}". As your Matrix Co-Pilot, I can help you automate follow-ups or analyze lead quality. What would you like to do next?`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
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
        <span className="text-[10px] text-slate-500 font-medium">MATRIX v1.0</span>
      </div>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                msg.role === "user"
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
