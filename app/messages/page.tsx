"use client";

// Phone message queue — every call the AI receptionist takes lands here. Ramon is
// gate-kept (no live transfer), so this is where the detailed messages queue up.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Phone, Check } from "lucide-react";

type Msg = {
  id: string; created_at: string; caller_name?: string; callback_number?: string;
  for_whom?: string; reason?: string; urgency?: string; transcript?: string; status: "new" | "handled";
};

export default function MessagesPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"new" | "all">("new");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/voice/messages");
    if (r.ok) { const j = await r.json(); setMsgs(j.messages || []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  async function mark(id: string, status: "new" | "handled") {
    await fetch("/api/voice/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    load();
  }

  const shown = msgs.filter((m) => (view === "new" ? m.status === "new" : true));
  const urgencyColor = (u?: string) => u === "high" ? "text-red-400 bg-red-500/15" : u === "low" ? "text-slate-400 bg-slate-700/40" : "text-amber-300 bg-amber-500/15";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/leads" className="text-slate-400 hover:text-white text-sm">← CRM</Link>
        <h1 className="text-2xl font-bold mt-2 flex items-center gap-2"><Phone className="w-5 h-5 text-emerald-400" /> Phone messages</h1>
        <p className="text-slate-500 text-sm">Calls answered by the AI receptionist. Ramon is gate-kept — detailed messages queue here.</p>

        <div className="flex items-center gap-2 mt-4">
          {(["new", "all"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${view === v ? "bg-emerald-600 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
              {v === "new" ? "New" : "All"} ({v === "new" ? msgs.filter((m) => m.status === "new").length : msgs.length})
            </button>
          ))}
        </div>

        {loading ? <div className="text-slate-400 text-sm mt-6"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</div> :
          !shown.length ? <div className="text-slate-500 text-sm mt-6">No {view === "new" ? "new " : ""}messages yet.</div> : (
            <div className="space-y-2 mt-4">
              {shown.map((m) => (
                <div key={m.id} className={`bg-slate-900/50 border rounded-xl p-4 ${m.status === "new" ? "border-emerald-700/40" : "border-slate-800"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-semibold">{m.caller_name || "Unknown caller"}</span>
                      {m.callback_number && <a href={`tel:${m.callback_number}`} className="text-emerald-400 text-sm ml-2">{m.callback_number}</a>}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-2 ${urgencyColor(m.urgency)}`}>{m.urgency || "normal"}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-300 text-sm mt-2">{m.reason || "(no reason captured — see transcript)"}</p>
                  <div className="flex items-center gap-3 mt-2">
                    {m.transcript && <button onClick={() => setOpen(open === m.id ? null : m.id)} className="text-[11px] text-slate-400 hover:text-white">{open === m.id ? "hide" : "transcript"}</button>}
                    {m.status === "new"
                      ? <button onClick={() => mark(m.id, "handled")} className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"><Check className="w-3 h-3" /> mark handled</button>
                      : <button onClick={() => mark(m.id, "new")} className="text-[11px] text-slate-500 hover:text-slate-300">reopen</button>}
                  </div>
                  {open === m.id && m.transcript && <pre className="text-[11px] text-slate-400 mt-2 whitespace-pre-wrap bg-slate-950/50 rounded-lg p-3">{m.transcript}</pre>}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
