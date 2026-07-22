"use client";

// A plain, simple task list. Add a task, see it, check it off. No XP, levels,
// streaks, bosses, or leaderboards — just the things that actually need doing.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Check, Loader2, Mic, Trash2, ChevronDown, ChevronRight } from "lucide-react";

type Task = { id: string; title: string; source?: string; due_at?: string | null; cadence?: string; status?: string };

const fmtDue = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const isOverdue = (iso: string) => new Date(iso).getTime() < Date.now();

export default function QuestBoard() {
  const [open, setOpen] = useState<Task[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [dueInput, setDueInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [dictating, setDictating] = useState(false);
  const recRef = useRef<any>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/tasks");
    if (r.ok) { const j = await r.json(); setOpen(j.open || []); setDone(j.done || []); }
  }, []);

  useEffect(() => { (async () => { await load(); setLoading(false); })(); }, [load]);

  async function addTask(e?: React.FormEvent) {
    e?.preventDefault();
    const title = newTask.trim(); if (!title) return;
    setNewTask(""); const due = dueInput; setDueInput("");
    // optimistic
    setOpen((o) => [{ id: `tmp-${Date.now()}`, title, due_at: due || null, source: "manual" }, ...o]);
    await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, due_at: due || undefined }) });
    load();
  }

  async function addTitle(title: string) {
    const t = title.trim(); if (!t) return;
    await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) });
    load();
  }

  async function complete(t: Task) {
    setBusy(t.id);
    setOpen((o) => o.filter((x) => x.id !== t.id));
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, status: "done" }) });
    await load(); setBusy(null);
  }

  async function reopen(t: Task) {
    setBusy(t.id);
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, status: "open" }) });
    await load(); setBusy(null);
  }

  async function setDue(id: string, due: string) {
    setOpen((o) => o.map((t) => t.id === id ? { ...t, due_at: due || null } : t));
    await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, due_at: due || null }) });
    load();
  }

  // Voice dictation: tap the mic, speak, tap again to stop. Saying "next" / "new task"
  // between items files each one as its own task. (Chrome-based desktop app.)
  function toggleDictation() {
    if (dictating) { try { recRef.current?.stop(); } catch { /* */ } setDictating(false); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Dictation needs the desktop app (Chrome)."); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true;
    let finals = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + " "; else interim += r[0].transcript;
      }
      const parts = finals.split(/\b(?:next task|new task|add task|next)\b/i);
      while (parts.length > 1) { addTitle(parts.shift()!); finals = parts.join(" "); }
      setNewTask((finals + interim).trim());
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);
    recRef.current = rec; rec.start(); setDictating(true);
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading your tasks…</div>;

  // Overdue first, then dated (soonest first), then undated — newest of the undated on top.
  const sorted = [...open].sort((a, b) => {
    const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return ad - bd;
  });

  return (
    <div className="max-w-2xl">
      {/* Add a task */}
      <form onSubmit={addTask} className="flex flex-wrap gap-2">
        <input
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder={dictating ? "Listening… say \"next\" between tasks" : "Add a task…"}
          className={`flex-1 min-w-[200px] bg-slate-900 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none ${dictating ? "border-red-500/70 focus:border-red-400" : "border-slate-700 focus:border-emerald-500"}`}
        />
        <button type="button" onClick={toggleDictation} title={dictating ? "Stop dictating" : "Dictate tasks"} className={`px-3 rounded-xl border flex items-center ${dictating ? "bg-red-500/20 border-red-500/60 text-red-300 animate-pulse" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500"}`}>
          <Mic className="w-4 h-4" />
        </button>
        <input type="date" value={dueInput} onChange={(e) => setDueInput(e.target.value)} title="Due date (optional)" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none" />
        <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 rounded-xl flex items-center gap-1 text-sm"><Plus className="w-4 h-4" /> Add</button>
      </form>

      {/* Open tasks */}
      <div className="mt-5 space-y-2">
        {sorted.length === 0 && <div className="text-center py-10 text-slate-500">Nothing on your list. Add a task above.</div>}
        {sorted.map((t) => (
          <div key={t.id} className="group flex items-center justify-between gap-3 rounded-xl px-4 py-3 border border-slate-800 bg-slate-900/50 hover:border-emerald-500/40 transition">
            <div className="flex items-start gap-3 min-w-0">
              <button onClick={() => complete(t)} disabled={busy === t.id} className="mt-0.5 w-7 h-7 rounded-lg border-2 border-slate-600 hover:border-emerald-500 hover:bg-emerald-500/20 flex items-center justify-center shrink-0 transition">
                {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Check className="w-4 h-4 text-transparent group-hover:text-emerald-400" />}
              </button>
              <div className="min-w-0">
                <div className="font-medium text-slate-100">{t.title}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <input type="date" value={t.due_at ? t.due_at.slice(0, 10) : ""} onChange={(e) => setDue(t.id, e.target.value)} className="bg-slate-800/60 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 focus:border-emerald-500 focus:outline-none" />
                  {t.due_at && <span className={`text-[11px] ${isOverdue(t.due_at) ? "text-red-400" : "text-slate-400"}`}>{isOverdue(t.due_at) ? "⚠ overdue" : `📅 ${fmtDue(t.due_at)}`}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Done (collapsed) */}
      {done.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
            {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} Done ({done.length})
          </button>
          {showDone && (
            <div className="mt-2 space-y-1.5">
              {done.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg px-4 py-2 border border-slate-800 bg-slate-900/30 opacity-70">
                  <div className="flex items-center gap-3 min-w-0">
                    <button onClick={() => reopen(t)} disabled={busy === t.id} title="Reopen" className="w-6 h-6 rounded-md border-2 border-emerald-500 bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                    <div className="line-through text-slate-500 truncate">{t.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
