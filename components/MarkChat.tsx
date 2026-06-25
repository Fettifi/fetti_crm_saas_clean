"use client";

// Floating "Chat with Mark" widget for the public site (mounted only on non-CRM pages
// via AppChrome). Talks to /api/mark — Mark, Fetti's compliant spokesperson AI. Opens
// with a bot disclosure; keeps SSNs out; nudges toward applying without killing the deal.
import { useEffect, useRef, useState } from "react";
import { X, Send, Loader2, ArrowRight } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };
const GREETING =
  "Hey — I'm Mark, Fetti's AI guide. Ask me anything about financing a home, an investment property, or your business. What are you working on?";

export default function MarkChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/mark", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "Let's keep going — what would you like to know?" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "I hit a snag — tap Apply and we'll pick it right up." }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Chat with Mark"
          className="fixed bottom-4 right-4 z-[90] flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl pl-1.5 pr-4 py-1.5 transition">
          <img src="/mark-owl.png" alt="" className="h-10 w-auto drop-shadow" />
          <span className="text-sm font-semibold">Chat with Mark</span>
        </button>
      )}

      {open && (
        <div className="fixed z-[90] inset-x-0 bottom-0 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]">
          <div className="mx-2 mb-2 sm:mx-0 sm:mb-0 rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col h-[70vh] sm:h-[560px] overflow-hidden">
            <div className="flex items-center gap-2 bg-slate-900 text-white px-3 py-2.5 shrink-0">
              <img src="/mark-owl.png" alt="Mark" className="h-10 w-auto" />
              <div className="leading-tight">
                <div className="text-sm font-bold">Mark</div>
                <div className="text-[10px] text-slate-300">Fetti AI assistant · NMLS #2267023</div>
              </div>
              <button onClick={() => setOpen(false)} className="ml-auto text-slate-300 hover:text-white" aria-label="Close chat"><X className="w-5 h-5" /></button>
            </div>

            <a href="/apply" className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 shrink-0 transition">
              Start my application <ArrowRight className="w-3.5 h-3.5" />
            </a>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
              {msgs.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-emerald-600 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm"}`}>{m.content}</div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-slate-200 p-2 flex items-end gap-2 bg-white shrink-0">
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1} placeholder="Ask Mark anything…"
                className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none max-h-28" />
              <button onClick={send} disabled={busy || !input.trim()} aria-label="Send"
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white p-2.5"><Send className="w-4 h-4" /></button>
            </div>
            <div className="px-3 pb-2 text-[9px] leading-snug text-slate-400 bg-white shrink-0">
              Mark is an AI assistant — not financial or legal advice and not a commitment to lend. Please don&apos;t share SSNs or account numbers here.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
