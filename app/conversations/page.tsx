"use client";

// Conversations — one screen to see every SMS + email with each lead (in and out)
// and reply by text or email. Reads /api/conversations (timeline built from
// activity_log); sends via the same route. Left = lead list, right = thread + composer.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Mail, Send, RefreshCw, Inbox } from "lucide-react";

type Summary = {
  leadId: string; name: string; email: string | null; phone: string | null; stage: string | null;
  lastChannel: "sms" | "email" | null; lastDirection: "outbound" | "inbound" | null;
  lastBody: string; lastAt: string; needsReply: boolean;
};
type Message = {
  id: string; direction: "outbound" | "inbound"; channel: "sms" | "email"; type: string;
  body: string; subject?: string | null; status?: string | null; at: string;
};
type LeadInfo = { id: string; name: string; email: string | null; phone: string | null; stage: string | null };

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export default function ConversationsPage() {
  const [list, setList] = useState<Summary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [filter, setFilter] = useState<"all" | "needs">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [subject, setSubject] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      if (r.ok) { const j = await r.json(); setList(j.conversations || []); }
    } finally { setLoadingList(false); }
  }, []);

  const loadThread = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoadingThread(true);
    try {
      const r = await fetch(`/api/conversations?leadId=${encodeURIComponent(id)}`);
      if (r.ok) { const j = await r.json(); setLead(j.lead || null); setMessages(j.messages || []); }
    } finally { setLoadingThread(false); }
  }, []);

  useEffect(() => { loadList(); const t = setInterval(loadList, 20000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => {
    if (!activeId) return;
    loadThread(activeId);
    const t = setInterval(() => loadThread(activeId, true), 15000);
    return () => clearInterval(t);
  }, [activeId, loadThread]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Default the composer channel to whatever the lead can actually receive.
  useEffect(() => {
    if (!lead) return;
    if (lead.phone) setChannel("sms"); else if (lead.email) setChannel("email");
  }, [lead]);

  function openLead(id: string) { setActiveId(id); setErr(null); setDraft(""); setSubject(""); }

  async function send() {
    if (!activeId || !draft.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch("/api/conversations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: activeId, channel, body: draft.trim(), subject: subject.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Send failed"); return; }
      setDraft(""); setSubject("");
      await loadThread(activeId, true);
      loadList();
    } catch (e) { setErr(e instanceof Error ? e.message : "Send failed"); }
    finally { setSending(false); }
  }

  const shown = list.filter((c) => (filter === "needs" ? c.needsReply : true));
  const needsCount = list.filter((c) => c.needsReply).length;
  const canSms = !!lead?.phone, canEmail = !!lead?.email;

  return (
    <div className="flex h-[calc(100dvh-53px)] min-h-[460px] bg-slate-950 text-slate-100">
      {/* LEFT — conversation list (hidden on mobile when a thread is open) */}
      <div className={`${activeId ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 shrink-0 border-r border-slate-900/80 flex-col`}>
        <div className="px-4 pt-4 pb-2 border-b border-slate-900/80">
          <h1 className="text-lg font-bold flex items-center gap-2"><Inbox className="w-5 h-5 text-emerald-400" /> Conversations</h1>
          <p className="text-[11px] text-slate-500">Every text &amp; email with your leads, in one place.</p>
          <div className="flex items-center gap-2 mt-3">
            {(["all", "needs"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg ${filter === f ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                {f === "all" ? `All (${list.length})` : `Needs reply (${needsCount})`}
              </button>
            ))}
            <button onClick={() => { loadList(); if (activeId) loadThread(activeId, true); }} className="ml-auto text-slate-500 hover:text-slate-200" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="text-slate-500 text-sm p-4"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</div>
          ) : !shown.length ? (
            <div className="text-slate-500 text-sm p-4">{filter === "needs" ? "No leads waiting on a reply. 🎉" : "No conversations yet. Texts & emails will appear here as they go out."}</div>
          ) : shown.map((c) => (
            <button key={c.leadId} onClick={() => openLead(c.leadId)}
              className={`w-full text-left px-4 py-3 border-b border-slate-900/60 hover:bg-slate-900/60 transition-colors ${activeId === c.leadId ? "bg-slate-900/80" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{c.name}</span>
                {c.needsReply && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-full shrink-0">Reply</span>}
                <span className="ml-auto text-[10px] text-slate-500 shrink-0">{fmtTime(c.lastAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-slate-400">
                {c.lastChannel === "email" ? <Mail className="w-3 h-3 shrink-0" /> : <MessageSquare className="w-3 h-3 shrink-0" />}
                <span className="text-[12px] truncate">{c.lastDirection === "inbound" ? "" : "You: "}{c.lastBody}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT — thread + composer (full-screen on mobile when a thread is open) */}
      <div className={`${activeId ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col`}>
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">Select a conversation to view the thread.</div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-900/80 flex items-center gap-3">
              <button onClick={() => setActiveId(null)} className="md:hidden text-slate-400 hover:text-white text-lg leading-none" aria-label="Back to list">←</button>
              <div className="min-w-0">
                <div className="font-semibold truncate">{lead?.name || "…"}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {lead?.phone || "no phone"} · {lead?.email || "no email"}{lead?.stage ? ` · ${lead.stage}` : ""}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loadingThread ? (
                <div className="text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</div>
              ) : !messages.length ? (
                <div className="text-slate-600 text-sm">No messages yet. Send the first one below.</div>
              ) : messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${m.direction === "outbound" ? "bg-emerald-600/90 text-slate-950" : "bg-slate-800 text-slate-100"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5 opacity-70 text-[10px]">
                      {m.channel === "email" ? <Mail className="w-2.5 h-2.5" /> : <MessageSquare className="w-2.5 h-2.5" />}
                      <span className="uppercase tracking-wide">{m.channel}</span>
                      {m.type && m.type !== "manual" && <span>· {m.type === "ai_reply" ? "🦉 Mark (AI)" : m.type.replace(/_/g, " ")}</span>}
                    </div>
                    {m.subject && <div className="font-semibold text-[13px] mb-0.5">{m.subject}</div>}
                    <div className="text-[13.5px] whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[10px] mt-1 ${m.direction === "outbound" ? "text-emerald-950/70" : "text-slate-500"}`}>
                      {fmtTime(m.at)}{m.direction === "outbound" && m.status ? ` · ${m.status}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={threadEnd} />
            </div>

            {/* Composer */}
            <div className="border-t border-slate-900/80 px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => canSms && setChannel("sms")} disabled={!canSms}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 ${channel === "sms" ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300"} ${!canSms ? "opacity-40 cursor-not-allowed" : "hover:bg-slate-700"}`}>
                  <MessageSquare className="w-3 h-3" /> Text{!canSms ? " (no #)" : ""}
                </button>
                <button onClick={() => canEmail && setChannel("email")} disabled={!canEmail}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 ${channel === "email" ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300"} ${!canEmail ? "opacity-40 cursor-not-allowed" : "hover:bg-slate-700"}`}>
                  <Mail className="w-3 h-3" /> Email{!canEmail ? " (no addr)" : ""}
                </button>
              </div>
              {channel === "email" && (
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (optional)"
                  className="w-full mb-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-600/60" />
              )}
              <div className="flex items-end gap-2">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                  placeholder={channel === "sms" ? "Type a text… (⌘+Enter to send)" : "Type an email… (⌘+Enter to send)"}
                  className="flex-1 resize-none bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-600/60" />
                <button onClick={send} disabled={sending || !draft.trim()}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-semibold rounded-lg px-4 py-2.5 text-sm flex items-center gap-1.5">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                </button>
              </div>
              {err && <div className="text-red-400 text-[11px] mt-2">{err}</div>}
              <div className="text-[10px] text-slate-600 mt-1.5">Replies from the lead land back here automatically (texts now; email replies coming soon).</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
