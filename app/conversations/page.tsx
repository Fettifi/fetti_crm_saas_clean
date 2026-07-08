"use client";

// Conversations — one screen to see every SMS + email with each lead (in and out)
// and reply by text or email. Reads /api/conversations (timeline built from
// activity_log); sends via the same route. Left = lead list, right = thread + composer.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Mail, Send, RefreshCw, Inbox } from "lucide-react";

type Summary = {
  leadId: string; name: string; email: string | null; phone: string | null; stage: string | null;
  tier?: string | null; purpose?: string | null;
  lastChannel: "sms" | "email" | null; lastDirection: "outbound" | "inbound" | null;
  lastBody: string; lastAt: string; needsReply: boolean;
};
type Message = {
  id: string; direction: "outbound" | "inbound"; channel: "sms" | "email"; type: string;
  body: string; subject?: string | null; status?: string | null; at: string;
};
type LeadInfo = {
  id: string; name: string; email: string | null; phone: string | null; stage: string | null;
  tier?: string | null; score?: number | null; purpose?: string | null; state?: string | null;
  facts?: string[]; smsConsent?: boolean; aiCallConsent?: boolean; paused?: boolean;
  appLink?: string | null; fileLink?: string | null; missingDocs?: string[];
};

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
  const [acting, setActing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);
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

  function openLead(id: string) { setActiveId(id); setErr(null); setDraft(""); setSubject(""); setShowFacts(false); setFlash(null); }

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

  async function quickAction(action: "draft" | "send_app_link" | "send_calendar" | "bridge") {
    if (!activeId || acting) return;
    setActing(action); setErr(null); setFlash(null);
    try {
      const r = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: activeId, action }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Action failed"); return; }
      if (action === "draft") { setDraft(j.draft || ""); setFlash("Mark drafted a reply — edit and send."); }
      else if (action === "bridge") setFlash(j.bridged ? "📞 Connected — you accepted the call." : "📞 Whisper sent to your cell — press 1 to call them together.");
      else { setFlash(`Sent via ${j.via}.`); await loadThread(activeId, true); loadList(); }
      setTimeout(() => setFlash(null), 5000);
    } catch { setErr("Action failed"); }
    finally { setActing(null); }
  }

  // Priority queue: needs-reply first, then Tier 1s, then recency.
  const shown = list
    .filter((c) => (filter === "needs" ? c.needsReply : true))
    .sort((a, b) => (Number(b.needsReply) - Number(a.needsReply)) || (Number(a.tier === "Tier 1" ? 0 : 1) - Number(b.tier === "Tier 1" ? 0 : 1)) || (new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()));
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
                {c.tier === "Tier 1" && <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/15 px-1.5 py-0.5 rounded-full shrink-0">T1</span>}
                <span className="ml-auto text-[10px] text-slate-500 shrink-0">{fmtTime(c.lastAt)}</span>
              </div>
              {c.purpose && <div className="text-[10px] text-slate-600 truncate mt-0.5">{c.purpose}{c.stage ? ` · ${c.stage}` : ""}</div>}
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
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate flex items-center gap-2">
                  {lead?.name || "…"}
                  {lead?.tier && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${lead.tier === "Tier 1" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{lead.tier}</span>}
                  {lead?.paused && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300">OPTED OUT</span>}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {[lead?.purpose, lead?.state, lead?.stage].filter(Boolean).join(" · ") || "—"}
                  {lead?.smsConsent === false && lead?.phone ? " · ⚠️ no SMS consent" : ""}
                </div>
              </div>
              {(lead?.facts?.length || lead?.missingDocs?.length) ? (
                <button onClick={() => setShowFacts((v) => !v)} className={`text-[11px] px-2 py-1 rounded-lg shrink-0 ${showFacts ? "bg-emerald-600 text-slate-950 font-semibold" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                  🧠 {lead?.facts?.length || 0} facts{lead?.missingDocs?.length ? ` · ${lead.missingDocs.length} docs open` : ""}
                </button>
              ) : null}
            </div>
            {showFacts && (
              <div className="px-5 py-2.5 border-b border-slate-900/80 bg-slate-900/40 text-[12px] space-y-1 max-h-40 overflow-y-auto">
                {(lead?.facts || []).map((f, i) => <div key={i} className="text-slate-300">• {f}</div>)}
                {(lead?.missingDocs || []).length > 0 && <div className="text-amber-300/90 pt-1">📄 Still missing: {(lead?.missingDocs || []).join("; ")}</div>}
              </div>
            )}

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
              {/* Quick actions — the conversion toolkit */}
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <button onClick={() => quickAction("draft")} disabled={!!acting}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 flex items-center gap-1">
                  {acting === "draft" ? <Loader2 className="w-3 h-3 animate-spin" /> : "✨"} Draft with Mark
                </button>
                <button onClick={() => quickAction("send_app_link")} disabled={!!acting || lead?.paused}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1">
                  {acting === "send_app_link" ? <Loader2 className="w-3 h-3 animate-spin" /> : "📎"} Send app link
                </button>
                <button onClick={() => quickAction("send_calendar")} disabled={!!acting || lead?.paused}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1">
                  {acting === "send_calendar" ? <Loader2 className="w-3 h-3 animate-spin" /> : "📅"} Send calendar
                </button>
                {lead?.phone && (
                  <button onClick={() => quickAction("bridge")} disabled={!!acting}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-40 flex items-center gap-1">
                    {acting === "bridge" ? <Loader2 className="w-3 h-3 animate-spin" /> : "📞"} Call them now
                  </button>
                )}
                {lead?.fileLink && (
                  <a href={lead.fileLink} target="_blank" rel="noreferrer"
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">
                    📂 Their file
                  </a>
                )}
              </div>
              {flash && <div className="text-emerald-300 text-[11px] mb-2 bg-emerald-500/10 rounded-lg px-2.5 py-1.5">{flash}</div>}
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
